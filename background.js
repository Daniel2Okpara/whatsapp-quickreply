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
    
    // Check if user can use AI
    // V12.0: UNLIMITED TESTING MODE
    /*
    if (subscription.tier === 'free') {
      const canUse = await checkUsageLimit('ai');
      if (!canUse) {
        return sendResponse({ error: 'Daily AI limit reached (5/day). Upgrade to Pro for unlimited.', limitReached: true });
      }
    }
    */
    
    console.log('[WAQR] Sending AI request:', { contextLength: context?.length, personality, url: `${BACKEND_URL}/generate-replies` });

    // Use fetchWithTimeout for consistent timeout handling
    const headers = { 'Content-Type': 'application/json' };
    if (data.jwtToken) headers['Authorization'] = `Bearer ${data.jwtToken}`;

    const response = await fetchWithTimeout(`${BACKEND_URL}/generate-replies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transcript: context, personality, apiKey: data.apiKey || null })
    }, 20000);

    console.log('[WAQR] AI response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[WAQR] AI error body:', error);
      throw new Error(error.error || error.message || `Server returned ${response.status}`);
    }

    const result = await response.json();
    console.log('[WAQR] AI result:', result);

    // Update usage if free tier
    if (subscription.tier === 'free') {
      await incrementUsage('ai');
    }
    
    const suggestion = result.replies?.[0] || result.suggestions?.[0] || result.text || result.reply || '';
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
