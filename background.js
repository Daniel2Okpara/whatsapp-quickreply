// WA QuickReply Background Script

const BACKEND_URL = 'https://wa-quickreply-server.onrender.com';
const FREE_AI_LIMIT = 5;
const PRO_TIER_COST = 500; // .00 in cents

// Initialize storage on install
// Promisified storage helpers
function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

// Fetch with timeout helper for consistent network timeouts
async function fetchWithTimeout(url, options = {}, timeout = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('WA QuickReply extension installed');

  // V11.0: Wake up the server on install/startup
  fetch(`${BACKEND_URL}/health`).catch(() => {});

  // Clear any stored position data to prevent off-screen issues
  chrome.storage.local.remove(['fabPosition', 'panelPosition'], () => {
    console.log('Cleared stored positions');
  });

  const existing = await storageGet(null);
  if (!existing || !existing.templates) {
    await storageSet({
      templates: [],
      usage: { date: new Date().toISOString().split('T')[0], ai: 0 },
      subscription: { tier: 'free', expiresAt: null },
      apiKey: null
    });
  }
});

// Listen for messages from content script
function safeSendResponse(sendResponse, data) {
  try {
    if (sendResponse) sendResponse(data);
  } catch (e) {
    // ignore because context may be destroyed if extension is reloaded
    console.warn('[WAQR] safeSendResponse failed:', e?.message || e);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AI_GENERATE') {
    generateAiReply(request.history, request.personality, (payload) => safeSendResponse(sendResponse, payload));
    return true; 
  }
  
  if (request.type === 'AI_IMPROVE') {
    improveMessage(request.text, (payload) => safeSendResponse(sendResponse, payload));
    return true; 
  }
  
  if (request.type === 'CHECK_USAGE') {
    checkUsageLimit(request.limitType).then(canUse => {
      safeSendResponse(sendResponse, { canUse, type: request.limitType });
    }).catch(err => safeSendResponse(sendResponse, { error: err?.message || 'check_usage_failed' }));
    return true; 
  }
  
  if (request.type === 'GET_SUBSCRIPTION') {
    chrome.storage.local.get('subscription', (data) => {
      safeSendResponse(sendResponse, { subscription: data.subscription || { tier: 'free' } });
    });
    return true;
  }

  // Fallback for unknown messages to avoid hung channels
  return false;
});

async function generateAiReply(context, personality, sendResponse) {
  try {
    const data = await storageGet(['subscription', 'apiKey', 'jwtToken']);
    const subscription = data.subscription || { tier: 'free' };

    // Extract smart settings from context payload
    const mode           = (context && context.mode)           || 'reply';
    const replyStyle     = (context && context.replyStyle)     || 'balanced';
    const emojiUsage     = (context && context.emojiUsage)     || 'natural';
    const followUpEnabled = (context && context.followUpEnabled) !== false;

    // Short-circuit: user disabled follow-ups entirely
    if (mode === 'follow_up' && !followUpEnabled) {
      return sendResponse({ noReply: true });
    }

    const replyStyleMap = {
      short:    'Keep the reply very short and punchy — 1-2 sentences max.',
      balanced: 'Keep the reply concise and natural — 2-4 sentences as needed.',
      detailed: 'Be thorough and complete — explain your point clearly but not excessively.'
    };
    const emojiMap = {
      none:    'Do NOT use any emojis whatsoever.',
      minimal: 'Use at most 1 emoji, only if it fits very naturally.',
      natural: 'Use emojis naturally as a human would in a WhatsApp chat.'
    };

    // Build mode-specific instruction that will be prepended to the conversation
    let modeInstruction;
    if (mode === 'follow_up') {
      modeInstruction =
        `MODE: FOLLOW-UP\n` +
        `The last message in this conversation was sent by ME (assistant). I have not received a reply yet.\n` +
        `Decide whether sending a follow-up makes sense:\n` +
        `- If YES → Write a natural, short, non-pushy follow-up (e.g. "Just checking in 🙂", "Any update on this?", "Let me know when you can").\n` +
        `- If NO (conversation is fully resolved, or a follow-up would feel pushy/awkward) → Reply with ONLY the exact text: NO_REPLY\n\n` +
        `Reply Style: ${replyStyleMap[replyStyle] || replyStyleMap.balanced}\n` +
        `Emoji: ${emojiMap[emojiUsage] || emojiMap.natural}`;
    } else {
      modeInstruction =
        `MODE: REPLY\n` +
        `Reply to the other person's last message as ME.\n` +
        `Reply Style: ${replyStyleMap[replyStyle] || replyStyleMap.balanced}\n` +
        `Emoji: ${emojiMap[emojiUsage] || emojiMap.natural}`;
    }

    // Build augmented messages with instruction prepended
    let endpoint = `${BACKEND_URL}/ai-reply`;
    let body = {};

    if (context && typeof context === 'object' && Array.isArray(context.messages)) {
      const augmentedMessages = [
        { role: 'user', content: modeInstruction },
        ...context.messages
      ];
      body = {
        messages: augmentedMessages,
        styleExamples: context.styleExamples || '',
        tone: context.tone || 'casual',
        timeContext: context.timeContext || 'day',
        apiKey: data.apiKey || null
      };
    } else {
      // Legacy transcript fallback
      endpoint = `${BACKEND_URL}/generate-replies`;
      body = { transcript: context, personality, apiKey: data.apiKey || null };
    }

    console.log('[WAQR] Sending AI request:', endpoint, '| mode:', mode);

    const headers = { 'Content-Type': 'application/json' };
    if (data.jwtToken) headers['Authorization'] = `Bearer ${data.jwtToken}`;

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }, 20000);

    console.log('[WAQR] AI response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[WAQR] AI error body:', error);
      throw new Error(error.error || error.message || `Server returned ${response.status}`);
    }

    const result = await response.json();
    console.log('[WAQR] AI result:', result);

    if (subscription.tier === 'free') await incrementUsage('ai');

    const suggestion = (result.reply || result.replies?.[0] || result.suggestions?.[0] || result.text || '').trim();

    // Handle NO_REPLY signal from AI
    if (suggestion === 'NO_REPLY') {
      return sendResponse({ noReply: true });
    }

    sendResponse({ suggestion: suggestion || 'Could not generate a reply right now.' });
  } catch (error) {
    console.error('[WAQR] AI Error:', error);
    sendResponse({ error: error.message });
  }
}

// Improve a message using AI
async function improveMessage(text, sendResponse) {
  try {
    const data = await storageGet(['subscription', 'apiKey', 'jwtToken']);
    const subscription = data.subscription || { tier: 'free' };
    
    // V12.0: UNLIMITED TESTING MODE
    /*
    if (subscription.tier === 'free') {
      const canUse = await checkUsageLimit('ai');
      if (!canUse) {
        return sendResponse({ error: 'Daily AI limit reached (5/day). Upgrade to Pro for unlimited.', limitReached: true });
      }
    }
    */
    
    console.log('[WAQR] Sending AI Improve request:', { textLength: text?.length, url: `${BACKEND_URL}/improve-message` });

    const headers = { 'Content-Type': 'application/json' };
    if (data.jwtToken) headers['Authorization'] = `Bearer ${data.jwtToken}`;

    const response = await fetchWithTimeout(`${BACKEND_URL}/improve-message`, {
      method: 'POST', headers, body: JSON.stringify({ text, apiKey: data.apiKey || null })
    }, 20000);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || `Server returned ${response.status}`);
    }

    const result = await response.json();
    
    // Update usage if free tier
    if (subscription.tier === 'free') {
      await incrementUsage('ai');
    }
    
    const improvedText = result.improvedText || result.text || result.reply || result.suggestion || '';
    sendResponse({ improvedText });
  } catch (error) {
    console.error('[WAQR] Improve Error:', error);
    sendResponse({ error: error.message });
  }
}

// Check if user has reached daily limit
async function checkUsageLimit(type) {
  // V12.0: ALWAYS ALLOW IN TESTING MODE
  return true;
}

// Increment usage counter
async function incrementUsage(type) {
  const data = await storageGet('usage');
  let usage = data.usage || { date: '', ai: 0 };
  
  const today = new Date().toISOString().split('T')[0];
  if (usage.date !== today) {
    usage = { date: today, ai: 0 };
  }
  
  if (type === 'ai') {
    usage.ai++;
  }
  
  await storageSet({ usage });
}

// Handle notification button clicks (Partially removed as only used by schedules)
chrome.notifications?.onButtonClicked?.addListener(async (notificationId, buttonIndex) => {
  chrome.notifications.clear(notificationId);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('web.whatsapp.com')) {
    // Send message to content script to toggle panel or show alert
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Content script not ready, will load automatically');
      }
    });
  }
});

// Refresh subscription status on startup (if user has a token)
async function refreshSubscription() {
  try {
      const data = await chrome.storage.local.get(['jwtToken','email']);
      const token = data.jwtToken;
      const email = data.email;

    if (token) {
      const resp = await fetch(`${BACKEND_URL}/auth/status`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const body = await resp.json();
      if (body && body.subscription) {
        await chrome.storage.local.set({ subscription: body.subscription });
      }
      return;
    }

    // Fallback: if we have an email (e.g., user gave email during onboarding), query user-status
    if (email) {
      try {
        const resp = await fetch(`${BACKEND_URL}/user-status?email=${encodeURIComponent(email)}`);
        if (resp.ok) {
          const body = await resp.json();
          if (body && (body.plan || body.subscription)) {
            const subscription = body.subscription || { tier: body.plan || 'free', status: body.status || '' };
            await chrome.storage.local.set({ subscription });
          }
        }
      } catch (e) {
        console.warn('[WAQR] fallback user-status failed', e?.message || e);
      }
    }
  } catch (e) {
    console.warn('[WAQR] refreshSubscription failed', e?.message || e);
  }
}

chrome.runtime.onStartup.addListener(() => {
  refreshSubscription();
});

// run once at worker start
refreshSubscription();
// Poll user-status every 15 seconds to detect upgrades
setInterval(() => {
  refreshSubscription();
}, 15000);
