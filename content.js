/**
 * WA QuickReply — Content Script (MVP v2.0)
 * Floating panel with templates, AI replies, and scheduling
 */

(function() {
  'use strict';

  let window_WAQR_LOADED = false;

  // ============================================================================
  // 0. STABILITY & CONTEXT CHECK
  // ============================================================================
  function isContextValid() {
    if (!chrome.runtime?.id) {
      return false;
    }
    return true;
  }

  function storageGet(keys, callback) {
    chrome.runtime.sendMessage({ type: 'GET_STORAGE', keys }, callback);
  }
  
  function storageSet(obj, callback) {
    chrome.runtime.sendMessage({ type: 'SET_STORAGE', obj }, callback);
  }

  // ============================================================================
  // 1. SHADOW DOM SETUP
  // ============================================================================

  const hostEl = document.createElement('div');
  hostEl.id = 'waqr-host';
  hostEl.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 999999; pointer-events: none;');
  document.documentElement.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: 'open' });

  // SSE: connect to backend for real-time subscription updates
  (function setupSSE() {
    const BACKEND_URL = 'https://wa-quickreply-server.onrender.com';
    storageGet(['email'], (r) => {
      const email = r && r.email;
      if (!email) return;
      try {
        const url = `${BACKEND_URL}/events?email=${encodeURIComponent(email)}`;
        const es = new EventSource(url);
        es.addEventListener('subscription_update', (ev) => {
          try {
            const data = JSON.parse(ev.data || '{}');
            storageSet({ subscription: data }, () => {
              applyProUI(); // re-apply Pro UI immediately
            storageGet(['email', 'verified'], (res) => {
              const email = res && res.email;
              const verified = res && res.verified;

              if (!email || !verified) {
                const hostEl = document.createElement('div');
                hostEl.id = 'waqr-blocker-host';
                hostEl.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999999; pointer-events: auto;');
                document.documentElement.appendChild(hostEl);

                const shadow = hostEl.attachShadow({ mode: 'open' });
                const styleEl = document.createElement('style');
                styleEl.textContent = `
                  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
                  .blocker-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); background: rgba(15,23,42,0.9); display:flex; align-items:center; justify-content:center; padding:20px; }
                  .blocker-card { background:#fff; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.15); padding:24px; max-width:320px; width:100%; text-align:center; border: 1px solid #e2e8f0; }
                  .blocker-logo{ width:48px; height:48px; margin:0 auto 16px; border-radius:10px; }
                  .blocker-title{ font-size:18px; font-weight:700; color:#0f172a; margin-bottom:8px; }
                  .blocker-subtitle{ color:#475569; font-size:13px; margin-bottom:16px; line-height:1.5 }
                  .blocker-input{ width:100%; padding:10px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:10px; font-size:14px; box-sizing: border-box; }
                  .blocker-btn{ width:100%; padding:10px; border-radius:8px; background:#25D366; color:#fff; font-weight:600; border:none; cursor:pointer; font-size:14px; transition: background 0.2s; }
                  .blocker-btn:hover { background: #1da851; }
                  .blocker-secondary{ width:100%; padding:10px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; cursor:pointer; font-size:14px; color: #475569; margin-top: 8px; transition: background 0.2s; }
                  .blocker-secondary:hover { background: #f1f5f9; }
                  .blocker-status{ min-height:20px; margin-top:12px; font-size:13px; font-weight: 500; }
                `;
                shadow.appendChild(styleEl);

                const overlay = document.createElement('div');
                overlay.className = 'blocker-overlay';
                const logoUrl = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('icons/icon128.png') : 'icons/icon128.png';
                overlay.innerHTML = `
                  <div class="blocker-card" id="waqr-activate-card">
                    <img src="${logoUrl}" class="blocker-logo" />
                    <div class="blocker-title">WA QuickReply</div>
                    <div class="blocker-subtitle">Input your email for verification.</div>
                    <input id="waqr-activate-email" class="blocker-input" type="email" placeholder="you@example.com" value="${email || ''}" />
                    <button id="waqr-activate-send" class="blocker-btn">Verify Email</button>
                    <div id="waqr-activate-status" class="blocker-status"></div>
                  </div>
                `;
                shadow.appendChild(overlay);

                const emailInput = shadow.querySelector('#waqr-activate-email');
                const sendButton = shadow.querySelector('#waqr-activate-send');
                const statusEl = shadow.querySelector('#waqr-activate-status');
                const cardEl = shadow.querySelector('#waqr-activate-card');

                const updateStatus = (text, isError = false) => { statusEl.textContent = text; statusEl.style.color = isError ? '#dc2626' : '#25D366'; };

                sendButton.addEventListener('click', async () => {
                  const emailValue = (emailInput.value || '').trim().toLowerCase();
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!emailRegex.test(emailValue)) return updateStatus('Please enter a valid email address.', true);

                  sendButton.disabled = true; sendButton.textContent = 'Sending...'; updateStatus('');
                  try {
                    const resp = await fetch(`${BACKEND_URL}/auth/resend-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailValue }) });
                    const result = await resp.json().catch(() => ({}));
                    if (!resp.ok) { updateStatus(result.error || 'Unable to send verification link.', true); sendButton.disabled = false; sendButton.textContent = 'Verify Email'; return; }

                    chrome.storage.local.set({ email: emailValue, verified: false }, () => {
                      // Update UI to show the email has been sent
                      cardEl.innerHTML = `
                        <img src="${logoUrl}" class="blocker-logo" />
                        <div class="blocker-title">Link Sent!</div>
                        <div class="blocker-subtitle" style="font-size: 14px; color: #334155;">A verification link has been sent to <b>${emailValue}</b>.</div>
                        <div class="blocker-subtitle" style="font-size: 13px; color: #64748b; margin-top: 10px;">Once verified, return back to the extension on WhatsApp.</div>
                        <button id="waqr-activate-open-gmail" class="blocker-secondary">Open Gmail</button>
                        <div id="waqr-activate-status" class="blocker-status" style="color: #25D366;">Waiting for verification...</div>
                      `;
                      const newStatusEl = shadow.querySelector('#waqr-activate-status');
                      shadow.querySelector('#waqr-activate-open-gmail').addEventListener('click', () => { window.open('https://mail.google.com', '_blank'); });

                      pollVerificationStatus(emailValue, async () => {
                        newStatusEl.textContent = 'Verified! Unlocking...';
                        await chrome.storage.local.set({ verified: true });
                        setTimeout(() => { hostEl.remove(); initializeExtension(); }, 900);
                      }, (message) => { newStatusEl.textContent = message; });
                    });
                  } catch (err) {
                    updateStatus('Network error. Please try again.', true); sendButton.disabled = false; sendButton.textContent = 'Verify Email';
                  }
                });
              } else {
                initializeExtension();
              }
            });

            function pollVerificationStatus(email, onVerified, onUpdate) {
              let attempts = 0; const maxAttempts = 24; const delay = 3000;
              const interval = setInterval(async () => {
                attempts += 1; if (attempts > maxAttempts) { clearInterval(interval); onUpdate('Still waiting for verification. Please check your inbox.'); return; }
                try {
                  const resp = await fetch(`${BACKEND_URL}/auth/verification-status?email=${encodeURIComponent(email)}`);
                  if (!resp.ok) return;
                  const data = await resp.json();
                  if (data.verified) { clearInterval(interval); onVerified(data); }
                  else { onUpdate('Waiting for verification...'); }
                } catch (err) { /* ignore, retry */ }
              }, delay);
            }
      transition: background 0.12s;
    }
    .waqr-sc-item:last-child { border-bottom: none; }
    .waqr-sc-item:hover { background: #edf7f1; }
    .waqr-sc-key { font-weight: 700; color: var(--waqr-primary); font-size: 12px; margin-right: 4px; }
    .waqr-sc-preview { color: #667; font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    @keyframes waqr-pop {
      0% { transform: scale(0.9); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes waqr-bounce {
      0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
      40% {transform: translateY(-10px);}
      60% {transform: translateY(-5px);}
    }

    #waqr-panel {
      position: fixed;
      width: 340px;
      max-height: 420px;
      background: var(--waqr-bg);
      border-radius: var(--waqr-radius);
      box-shadow: 0 10px 26px rgba(0,0,0,0.28);
      z-index: 999998;
      pointer-events: auto;
      display: none;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(32, 168, 99, 0.22);
    }

    #waqr-content {
      flex: 1;
      overflow-y: auto;
      max-height: 320px;
      padding-right: 4px;
    }

    #waqr-header {
      background: var(--waqr-primary);
      color: white;
      padding: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    #waqr-tabs {
      display: flex;
      background: #f8f9fa;
      border-bottom: 1px solid var(--waqr-border);
    }

    .waqr-tab {
      flex: 1;
      padding: 12px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 14px;
      font-weight: 500;
    }

    .waqr-tab.active {
      background: var(--waqr-bg);
      border-bottom: 2px solid var(--waqr-primary);
      color: var(--waqr-primary);
    }

    #waqr-content {
      flex: 1;
      overflow-y: auto;
      max-height: 450px;
    }

    .waqr-section {
      display: none;
      padding: 16px;
    }

    .waqr-section.active { display: block; }

    .waqr-input {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--waqr-border);
      border-radius: 8px;
      margin-bottom: 12px;
      font-size: 14px;
      box-sizing: border-box;
      font-family: inherit;
    }

    textarea.waqr-input {
      min-height: 100px;
      resize: vertical;
      line-height: 1.5;
    }

    .waqr-btn {
      background: var(--waqr-primary);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
      margin-bottom: 8px;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .waqr-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 14px rgba(0,0,0,0.28);
    }

    .waqr-btn.generate {
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.5); }
      50% { box-shadow: 0 0 0 8px rgba(37, 211, 102, 0); }
    }

    .waqr-btn.secondary {
      background: #f8f9fa;
      color: var(--waqr-text);
      border: 1px solid var(--waqr-border);
    }

    .waqr-category {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      padding: 8px;
      border-radius: 6px;
    }

    .waqr-category.active {
      background: var(--waqr-primary);
      color: white;
      border: 1px solid var(--waqr-primary-dark);
    }

    .waqr-action-icon {
      width: 22px;
      height: 22px;
      display: grid;
      place-content: center;
      border-radius: 50%;
      background: #e7f3ee;
      border: 1px solid #c6e6d7;
      cursor: pointer;
      font-size: 13px;
      color: #256a45;
    }

    .waqr-template {
      padding: 12px;
      border: 1px solid var(--waqr-border);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .waqr-template:hover { background: #f8f9fa; }

    .waqr-toast {
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--waqr-primary);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      z-index: 1000000;
      opacity: 0;
      transform: translateY(-20px);
      transition: all 0.3s ease;
    }

    .waqr-toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* Improve Button Styles */
    #waqr-improve-btn {
      position: fixed;
      z-index: 1000000;
      background: #25D366;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      display: none;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: auto;
    }
    #waqr-improve-btn:hover {
      transform: scale(1.05);
      background: #20bc5a;
      box-shadow: 0 6px 16px rgba(0,0,0,0.2);
    }
    #waqr-improve-btn.loading {
      opacity: 0.8;
      cursor: wait;
    }
    /* Typing animation similar to WhatsApp three dots */
    .waqr-typing {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      padding: 8px 12px;
      background: #f1f3f2;
      border-radius: 18px;
      max-width: 100%;
    }
    .waqr-typing .dot {
      width: 8px;
      height: 8px;
      background: #6b7280;
      border-radius: 50%;
      opacity: 0.9;
      transform: translateY(0);
      animation: waqr-bounce 1s infinite ease-in-out;
    }
    .waqr-typing .dot.d2 { animation-delay: 0.12s; }
    .waqr-typing .dot.d3 { animation-delay: 0.24s; }
    @keyframes waqr-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.6; }
      40% { transform: translateY(-6px); opacity: 1; }
    }
    #waqr-panel.trial-theme {
      --waqr-primary: #0ea5e9;
      border: 2px solid #0ea5e9;
    }
    #waqr-panel.trial-theme #waqr-header {
      background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
    }

    .waqr-usage-container {
      background: #f1f5f9;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 12px;
      border: 1px solid #e2e8f0;
    }
    .waqr-usage-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #64748b;
      margin-bottom: 4px;
    }
    .waqr-usage-item:last-child { margin-bottom: 0; }
    .waqr-usage-val { font-weight: 700; color: #1e293b; }
    .waqr-usage-bar {
      height: 4px; background: #e2e8f0; border-radius: 2px;
      margin-top: 4px; overflow: hidden;
    }
    .waqr-usage-fill {
      height: 100%; background: var(--waqr-primary);
      transition: width 0.3s ease;
    }

    /* Upgrade Modal */
    .waqr-modal-overlay {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      display: flex; justify-content: center; align-items: center;
      z-index: 2000000; opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }
    .waqr-modal-overlay.active { opacity: 1; pointer-events: auto; }
    .waqr-modal {
      background: white; padding: 32px; border-radius: 20px;
      width: 320px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.3);
      transform: translateY(20px); transition: transform 0.3s;
    }
    .waqr-modal-overlay.active .waqr-modal { transform: translateY(0); }
    .waqr-modal h2 { font-size: 22px; font-weight: 800; margin-bottom: 12px; }
    .waqr-modal p { font-size: 14px; color: #64748b; line-height: 1.5; margin-bottom: 24px; }
    .waqr-modal-btn {
      width: 100%; padding: 14px; border-radius: 12px; font-weight: 700;
      border: none; cursor: pointer; transition: 0.2s;
    }
    .waqr-modal-btn.primary { background: var(--waqr-primary); color: white; margin-bottom: 10px; }
    .waqr-modal-btn.secondary { background: #f1f5f9; color: #64748b; }

    .waqr-set-btn {
      padding: 6px 4px; border: 1.5px solid #e2e8f0; border-radius: 6px;
      background: #f8fafc; color: #64748b; font-size: 11px; font-weight: 500;
      cursor: pointer; transition: all 0.15s; text-align: center;
    }
    .waqr-set-btn:hover { border-color: #27a55e; color: #27a55e; background: #f0fdf4; }
    .waqr-set-btn.active { background: #27a55e; color: white; border-color: #1e9652; font-weight: 600; }

    .waqr-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
    .waqr-toggle input { opacity: 0; width: 0; height: 0; }
    .waqr-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #e2e8f0; border-radius: 24px; transition: 0.3s; }
    .waqr-slider:before { position: absolute; content: ''; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
    .waqr-toggle input:checked + .waqr-slider { background: #27a55e; }
    .waqr-toggle input:checked + .waqr-slider:before { transform: translateX(20px); }
    #waqr-panel.voice-mode {
      border: 2px solid #a855f7;
    }
    #waqr-panel.voice-mode #waqr-header {
      background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%);
    }

    .waqr-transcript-box {
      background: #fdf4ff;
      border: 1px solid #f5d0fe;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 13px;
      line-height: 1.5;
      color: #7e22ce;
      position: relative;
    }
    .waqr-transcript-edit {
      display: none; width: 100%; border: 1px solid #d8b4fe; 
      border-radius: 6px; padding: 8px; font-size: 13px; 
      margin-bottom: 10px; min-height: 80px;
    }

    .waqr-transcribe-btn-chat {
      background: #a855f7; color: white; border: none; 
      border-radius: 20px; padding: 4px 10px; font-size: 11px;
      font-weight: 700; cursor: pointer; display: flex; 
      align-items: center; gap: 4px; margin-top: 6px;
      box-shadow: 0 2px 5px rgba(168, 85, 247, 0.3);
      transition: all 0.2s;
    }
    .waqr-transcribe-btn-chat:hover { transform: scale(1.05); background: #9333ea; }
    .waqr-transcribe-btn-chat.loading { background: #d1d5db; color: #4b5563; cursor: wait; }
  `;
  shadow.appendChild(styleEl);

  // Upgrade Modal
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'waqr-modal-overlay';
  modalOverlay.innerHTML = `
    <div class="waqr-modal">
      <h2>Upgrade to Pro 🚀</h2>
      <p id="waqr-modal-msg">You’ve reached today’s limit. Upgrade to continue instantly 🚀</p>
      <button class="waqr-modal-btn primary" id="waqr-modal-upgrade">Upgrade Now</button>
      <button class="waqr-modal-btn secondary" id="waqr-modal-close">Maybe Later</button>
    </div>
  `;
  shadow.appendChild(modalOverlay);

  // ============================================================================
  // 2. UI COMPONENTS
  // ============================================================================

  // Floating Action Button
  const fab = document.createElement('div');
  fab.id = 'waqr-fab';
  fab.innerHTML = '💬';
  fab.title = 'WA QuickReply';
  shadow.appendChild(fab);

  // Main Panel
  const panel = document.createElement('div');
  panel.id = 'waqr-panel';
  const iconUrl = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('icons/icon128.png') : 'icons/icon128.png';
  panel.innerHTML = `
    <div id='waqr-header'>
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
        <img src="${iconUrl}" alt="WA QuickReply" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
        <span style="font-size:15px; font-weight:700; white-space:nowrap;">WA QuickReply</span>
        <span id="waqr-pro-badge" style="display:none; background:rgba(255,255,255,0.2); padding:2px 6px; border-radius:4px; font-size:10px; font-weight:800; letter-spacing:0.5px;">PRO</span>
        <span id="waqr-trial-badge" style="display:none; background:rgba(255,255,255,0.2); padding:2px 6px; border-radius:4px; font-size:10px; font-weight:800; letter-spacing:0.5px;">TRIAL</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
        <button id='waqr-settings' title='Settings' style='background: none; border: none; color: white; font-size: 16px; cursor: pointer; display:flex; align-items:center; padding:4px; border-radius:6px; transition: background 0.2s;' onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='none'">⚙️</button>
        <a href="https://www.wa-quick-reply.com/#pricing" target="_blank" id="waqr-upgrade-link" style="color:white; font-size:11px; text-decoration:underline; font-weight:500; white-space:nowrap;">Upgrade</a>
        <button id='waqr-close' style='background: none; border: none; color: white; font-size: 20px; cursor: pointer; display:flex; align-items:center; padding:4px;'>×</button>
      </div>
    </div>
    <div id='waqr-tabs'>
      <div class='waqr-tab active' data-tab='templates'>Templates</div>
      <div class='waqr-tab' data-tab='ai'>AI Reply</div>
    </div>
    <div id='waqr-content'>
      <div class='waqr-section active' data-section='templates'>
        <div class="waqr-usage-container" id="waqr-usage-templates" style="display:none;">
          <div class="waqr-usage-item">
            <span>Improve Used</span>
            <span class="waqr-usage-val"><span id="waqr-usage-improve-count">0</span>/10</span>
          </div>
          <div class="waqr-usage-bar"><div class="waqr-usage-fill" id="waqr-usage-improve-fill" style="width: 0%;"></div></div>
        </div>
        <div style='font-size: 13px; color: #555; margin-bottom: 8px;'>Save and reuse your best replies</div>
        <div style='display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;'>
          <button class='waqr-btn secondary waqr-category active' data-category='All'>All</button>
          <button class='waqr-btn secondary waqr-category' data-category='Pricing'>Pricing</button>
          <button class='waqr-btn secondary waqr-category' data-category='Follow-ups'>Follow-ups</button>
          <button class='waqr-btn secondary waqr-category' data-category='Greetings'>Greetings</button>
        </div>
        <div id='waqr-recent-templates' style='font-size: 13px; color: #444; margin-bottom: 12px;'>⭐ Suggested templates appear here</div>
        <div id='waqr-templates-list' style='max-height: 140px; overflow-y: auto; margin-bottom: 8px;'></div>
        <textarea class='waqr-input' id='waqr-template-message' placeholder='Template message...'></textarea>
        <select class='waqr-input' id='waqr-template-category'>
          <option value='Pricing'>Pricing</option>
          <option value='Follow-ups'>Follow-ups</option>
          <option value='Greetings'>Greetings</option>
          <option value='General'>General</option>
        </select>
        <button class='waqr-btn' id='waqr-add-template'>+ Add Template</button>
      </div>
      <div class='waqr-section' data-section='ai'>
        <div class="waqr-usage-container" id="waqr-usage-ai" style="display:none;">
          <div class="waqr-usage-item">
            <span>AI Replies Used</span>
            <span class="waqr-usage-val"><span id="waqr-usage-ai-count">0</span>/10</span>
          </div>
          <div class="waqr-usage-bar"><div class="waqr-usage-fill" id="waqr-usage-ai-fill" style="width: 0%;"></div></div>
          <div id="waqr-trial-countdown" style="font-size:10px; color:#94a3b8; margin-top:6px; display:none;"></div>
        </div>

      <div class='waqr-section' data-section='ai'>
        <div class="waqr-usage-container" id="waqr-usage-ai" style="display:none;">
          <div class="waqr-usage-item">
            <span>AI Replies Used</span>
            <span class="waqr-usage-val"><span id="waqr-usage-ai-count">0</span>/10</span>
          </div>
          <div class="waqr-usage-bar"><div class="waqr-usage-fill" id="waqr-usage-ai-fill" style="width: 0%;"></div></div>
          <div id="waqr-trial-countdown" style="font-size:10px; color:#94a3b8; margin-top:6px; display:none;"></div>
        </div>

        <div style='font-size: 13px; color: #555; margin-bottom: 4px;'>Generate smart responses instantly</div>
        <div style='font-size: 11px; color: #94a3b8; margin-bottom: 12px;'>Tone &amp; style controlled in ⚙️ Settings</div>
        <button class='waqr-btn' id='waqr-generate'>✨ Generate AI Reply</button>
        <button class='waqr-btn' id='waqr-start-trial' style='display:none; background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); margin-top: 8px;'>🎁 Start 3-Day Free Trial</button>
        <div id='waqr-suggestions' style='margin-top: 12px;'></div>
      </div>
    </div>
  `;
  shadow.appendChild(panel);

  // ============================================================================
  // ONBOARDING WALKTHROUGH
  // ============================================================================
  const onboardingEl = document.createElement('div');
  onboardingEl.id = 'waqr-onboarding';
  onboardingEl.style.cssText = `
    display:none; position:fixed; top:0; left:0; width:100vw; height:100vh;
    background:rgba(0,0,0,0.5); z-index:2000000; pointer-events:auto;
    align-items:center; justify-content:center;
  `;
  onboardingEl.innerHTML = `
    <div style="background:white; padding:24px; border-radius:16px; width:320px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.3); animation: waqr-pop 0.3s ease-out;">
      <div style="font-size:40px; margin-bottom:16px;">🚀</div>
      <h2 style="font-size:20px; margin-bottom:8px; color:#1e293b;">Welcome to WA QuickReply!</h2>
      <p style="font-size:14px; color:#64748b; margin-bottom:20px; line-height:1.5;">Start replying 10x faster with AI and custom templates. Try using shortcuts like <b>/price</b> or <b>/follow</b> in your chat!</p>
      <button class="waqr-btn" id="waqr-onboarding-next" style="width:100%;">Got it, let's go!</button>
    </div>
  `;
  shadow.appendChild(onboardingEl);

  storageGet(['onboarding_seen'], (r) => {
    if (!r || !r.onboarding_seen) {
      setTimeout(() => { onboardingEl.style.display = 'flex'; }, 2000);
    }
  });

  onboardingEl.querySelector('#waqr-onboarding-next').onclick = () => {
    onboardingEl.style.display = 'none';
    storageSet({ onboarding_seen: true });
    // Show a small hint near the FAB
    showHint(fab, 'Click here to open your panel 💬');
  };

  function showHint(target, text) {
    const hint = document.createElement('div');
    hint.style.cssText = `
      position:fixed; background:#27a55e; color:white; padding:8px 12px;
      border-radius:8px; font-size:12px; font-weight:600; z-index:2000001;
      pointer-events:none; white-space:nowrap; box-shadow:0 4px 12px rgba(39,165,94,0.3);
      animation: waqr-bounce 2s infinite;
    `;
    hint.textContent = text;
    const rect = target.getBoundingClientRect();
    hint.style.left = (rect.left - 20) + 'px';
    hint.style.top = (rect.top - 40) + 'px';
    shadow.appendChild(hint);
    setTimeout(() => { hint.remove(); }, 6000);
  }

  // ============================================================================
  // SETTINGS PANEL — 6-control design
  // ============================================================================
  const settingsPanel = document.createElement('div');
  settingsPanel.id = 'waqr-settings-panel';
  settingsPanel.style.cssText = `
    display:none; position:fixed;
    background:white; border:1px solid #e2e8f0; border-radius:12px;
    padding:12px; box-shadow:0 12px 48px rgba(0,0,0,0.22);
    z-index:1000001; width:260px; max-height:80vh; overflow-y:auto;
    pointer-events:auto;
  `;
  settingsPanel.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#0f172a;display:flex;justify-content:space-between;align-items:center;">
      <span>⚙️ Settings</span>
      <button id="waqr-settings-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;">×</button>
    </div>

    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Default Tone</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;" id="waqr-set-tone">
      <button class="waqr-set-btn small" data-group="tone" data-value="casual">Casual</button>
      <button class="waqr-set-btn small" data-group="tone" data-value="professional">Professional</button>
      <button class="waqr-set-btn small" data-group="tone" data-value="friendly">Friendly</button>
      <button class="waqr-set-btn small" data-group="tone" data-value="direct">Direct</button>
    </div>

    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Reply Style</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px;">
      <button class="waqr-set-btn small" data-group="replyStyle" data-value="short">Short</button>
      <button class="waqr-set-btn small" data-group="replyStyle" data-value="balanced">Balanced</button>
      <button class="waqr-set-btn small" data-group="replyStyle" data-value="detailed">Detailed</button>
    </div>

    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Emoji Usage</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:12px;">
      <button class="waqr-set-btn small" data-group="emojiUsage" data-value="none">None</button>
      <button class="waqr-set-btn small" data-group="emojiUsage" data-value="minimal">Minimal</button>
      <button class="waqr-set-btn small" data-group="emojiUsage" data-value="natural">Natural</button>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:6px;">
      <div>
        <div style="font-size:12px;font-weight:600;color:#1e293b;display:flex;align-items:center;gap:4px;">Auto Follow-ups <span style="background:var(--waqr-pro);color:white;padding:1px 4px;border-radius:3px;font-size:8px;font-weight:800;">PRO</span></div>
        <div style="font-size:10px;color:#94a3b8;">Suggest when to check in</div>
      </div>
      <label class="waqr-toggle"><input type="checkbox" id="waqr-set-followup" checked><span class="waqr-slider"></span></label>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:12px;">
      <div>
        <div style="font-size:12px;font-weight:600;color:#1e293b;display:flex;align-items:center;gap:4px;">Style Learning <span style="background:var(--waqr-pro);color:white;padding:1px 4px;border-radius:3px;font-size:8px;font-weight:800;">PRO</span></div>
        <div style="font-size:10px;color:#94a3b8;">Match how you write</div>
      </div>
      <label class="waqr-toggle"><input type="checkbox" id="waqr-set-learning" checked><span class="waqr-slider"></span></label>
    </div>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Account</div>
    <div id="waqr-email-display" style="font-size:11px;color:#64748b;margin-bottom:6px;"></div>
    <a href="#" id="waqr-change-email-toggle" style="display:block;font-size:12px;color:#27a55e;text-decoration:none;font-weight:600;margin-bottom:6px;">Change email address →</a>
    <div id="waqr-change-email-box" style="display:none;">
      <input type="email" id="waqr-change-current" placeholder="Current email" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;box-sizing:border-box;font-size:13px;">
      <input type="email" id="waqr-change-new" placeholder="New email" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;box-sizing:border-box;font-size:13px;">
      <button id="waqr-change-email-save" style="background:#27a55e;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;width:100%;font-size:13px;font-weight:600;">Change Email</button>
      <div id="waqr-change-email-error" style="color:#dc2626;font-size:12px;margin-top:6px;display:none;"></div>
    </div>
  `;
  shadow.appendChild(settingsPanel);

  // Load saved settings into the panel UI
  function loadSettingsUI() {
    storageGet(['waqrSettings', 'email', 'plan'], (r) => {
      const s = r.waqrSettings || {};
      const plan = r.plan || 'free';
      const isFree = plan === 'free';
      
      const emailDisplay = shadow.getElementById('waqr-email-display');
      if (emailDisplay) emailDisplay.textContent = r.email || '';

      const toneDefault      = s.tone       || 'casual';
      const styleDefault     = s.replyStyle || 'balanced';
      const emojiDefault     = s.emojiUsage || 'natural';

      settingsPanel.querySelectorAll('[data-group="tone"]').forEach(b =>
        b.classList.toggle('active', b.dataset.value === toneDefault));
      settingsPanel.querySelectorAll('[data-group="replyStyle"]').forEach(b =>
        b.classList.toggle('active', b.dataset.value === styleDefault));
      settingsPanel.querySelectorAll('[data-group="emojiUsage"]').forEach(b =>
        b.classList.toggle('active', b.dataset.value === emojiDefault));

      const fuEl = shadow.getElementById('waqr-set-followup');
      if (fuEl) {
        fuEl.checked = isFree ? false : (s.followUp !== 'disabled');
        fuEl.disabled = isFree;
      }
      const learnEl = shadow.getElementById('waqr-set-learning');
      if (learnEl) {
        learnEl.checked = isFree ? false : (s.styleLearning !== 'off');
        learnEl.disabled = isFree;
      }
    });
  }

  // Wire settings button
  const settingsBtn = shadow.querySelector('#waqr-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = settingsPanel.style.display !== 'none';
      if (isVisible) {
        settingsPanel.style.display = 'none';
      } else {
        // Compute position from the panel's current location
        const panelRect = panel.getBoundingClientRect();
        const spWidth = 264;
        let spLeft = panelRect.right - spWidth;
        if (spLeft < 8) spLeft = 8;
        settingsPanel.style.top  = (panelRect.top + 54) + 'px';
        settingsPanel.style.left = spLeft + 'px';
        settingsPanel.style.right = 'auto';
        settingsPanel.style.display = 'block';
        loadSettingsUI();
      }
    });
  }

  // Wire settings close button
  const settingsCloseBtn = shadow.querySelector('#waqr-settings-close');
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.style.display = 'none';
    });
  }

  // Segmented buttons — save immediately
  settingsPanel.querySelectorAll('.waqr-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      settingsPanel.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      storageGet(['waqrSettings'], (r) => {
        const s = r.waqrSettings || {};
        s[group] = btn.dataset.value;
        storageSet({ waqrSettings: s });
      });
    });
  });

  // Toggle: Follow-ups
  const fuToggle = shadow.getElementById('waqr-set-followup');
  if (fuToggle) {
    fuToggle.addEventListener('change', () => {
      storageGet(['waqrSettings'], (r) => {
        const s = r.waqrSettings || {};
        s.followUp = fuToggle.checked ? 'auto' : 'disabled';
        storageSet({ waqrSettings: s });
      });
    });
  }

  // Toggle: Style Learning
  const learnToggle = shadow.getElementById('waqr-set-learning');
  if (learnToggle) {
    learnToggle.addEventListener('change', () => {
      storageGet(['waqrSettings'], (r) => {
        const s = r.waqrSettings || {};
        s.styleLearning = learnToggle.checked ? 'on' : 'off';
        storageSet({ waqrSettings: s });
      });
    });
  }

  // Change email flow
  const changeToggle = shadow.querySelector('#waqr-change-email-toggle');
  const changeBox    = shadow.querySelector('#waqr-change-email-box');
  if (changeToggle && changeBox) {
    changeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      changeBox.style.display = changeBox.style.display === 'none' ? 'block' : 'none';
    });

    const changeSave = shadow.querySelector('#waqr-change-email-save');
    const changeErr  = shadow.querySelector('#waqr-change-email-error');
    changeSave.addEventListener('click', async () => {
      const cur = (shadow.querySelector('#waqr-change-current').value || '').trim().toLowerCase();
      const nw  = (shadow.querySelector('#waqr-change-new').value  || '').trim().toLowerCase();
      changeErr.style.display = 'none';
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!valid.test(cur) || !valid.test(nw)) {
        changeErr.textContent = 'Please enter valid emails'; changeErr.style.display = 'block'; return;
      }
      if (cur === nw) { changeErr.textContent = 'New email must be different'; changeErr.style.display = 'block'; return; }
      try {
        const resp = await fetch('https://wa-quickreply-server.onrender.com/user/update-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentEmail: cur, newEmail: nw })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) { changeErr.textContent = data.error || `Failed (${resp.status})`; changeErr.style.display = 'block'; return; }
        storageSet({ email: nw }, () => {
          changeBox.style.display = 'none';
          settingsPanel.style.display = 'none';
          showToast('Email updated ✅');
          const upgradeLink = shadow.querySelector('#waqr-upgrade-link');
          if (upgradeLink) upgradeLink.href = 'https://www.wa-quick-reply.com/#pricing?email=' + encodeURIComponent(nw);
          const emailDisplay = shadow.getElementById('waqr-email-display');
          if (emailDisplay) emailDisplay.textContent = nw;
        });
      } catch (err) {
        changeErr.textContent = 'Server error'; changeErr.style.display = 'block';
      }
    });
  }

  // Prefill upgrade link with stored email
  (function setEmailDisplayAndUpgrade() {
    storageGet(['email'], (r) => {
      const email = (r && r.email) ? r.email : null;
      const upgradeLink = shadow.querySelector('#waqr-upgrade-link');
      if (upgradeLink) {
        const base = 'https://www.wa-quick-reply.com/#pricing';
        upgradeLink.href = email ? (base + '?email=' + encodeURIComponent(email)) : base;
      }
    });
  })();

  // Apply plan-based UI (Pro vs Free). Reads subscription from chrome.storage and updates visuals.
  function applyProUI() {
    try {
      const badge = shadow.querySelector('#waqr-pro-badge');
      if (badge) badge.style.display = 'inline-block';
      panel.classList.add('pro-theme');
      fab.style.boxShadow = '0 8px 26px rgba(245,158,11,0.18)';
      // global flag for other modules
      window.WAQR_IS_PRO = true;
    } catch (e) {
    }
  }

  storageGet(['subscription'], (res) => {
    const sub = res && res.subscription ? res.subscription : {};
    const tier = (sub.tier || '').toLowerCase();
    const plan = (sub.plan || '').toLowerCase();
    const status = (sub.subscriptionStatus || '').toLowerCase();
    const isPro = tier === 'pro' || plan === 'pro' || (status === 'active' && (plan === 'pro' || tier === 'pro'));
    if (isPro) applyProUI();
  });

  // React to subscription changes to instantly apply Pro UI
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.subscription) {
      const sub = changes.subscription.newValue || {};
      const tier = (sub.tier || '').toLowerCase();
      const plan = (sub.plan || '').toLowerCase();
      const status = (sub.subscriptionStatus || '').toLowerCase();
      const isPro = tier === 'pro' || plan === 'pro' || (status === 'active' && (plan === 'pro' || tier === 'pro'));
      if (isPro) applyProUI();
    }
  });

  // Toast notifications
  const toast = document.createElement('div');
  toast.id = 'waqr-toast';
  toast.className = 'waqr-toast';
  shadow.appendChild(toast);

  // Shortcut autocomplete popup
  const scPopup = document.createElement('div');
  scPopup.id = 'waqr-shortcut-popup';
  shadow.appendChild(scPopup);

  // V10.0 - Improve Button
  const improveBtn = document.createElement('button');
  improveBtn.id = 'waqr-improve-btn';
  improveBtn.innerHTML = '<span>✨</span> Improve';
  shadow.appendChild(improveBtn);

  // ============================================================================
  // 3. STATE MANAGEMENT
  // ============================================================================

  let currentTab = 'templates';
  let fabPosition = { x: window.innerWidth - 76, y: window.innerHeight - 136 };
  let activeInput = null;
  let shortcutActive = false;
  let lastShortcutRange = null;

  function getTimeOfDay() {
    const hours = new Date().getHours();
    if (hours >= 5 && hours < 12) return 'Morning';
    if (hours >= 12 && hours < 18) return 'Afternoon';
    if (hours >= 18 && hours < 22) return 'Evening';
    return 'Night';
  }

  function updateImproveButtonPosition() {
    if (!activeInput) {
      improveBtn.style.display = 'none';
      return;
    }

    const rect = activeInput.getBoundingClientRect();
    const text = activeInput.innerText.trim();

    // V14.1 - Relaxed check: Only hide if empty. Show if focused or recently focused.
    if (text.length > 0) {
       improveBtn.style.display = 'flex';
       improveBtn.style.top = (rect.top - 44) + 'px'; // 44px above
       improveBtn.style.left = (rect.right - 100) + 'px'; // Near top-right
    } else {
       improveBtn.style.display = 'none';
    }
  }

  // Load saved position
  storageGet(['fabPosition'], (result) => {
    if (result.fabPosition) {
      fabPosition = result.fabPosition;
    }
    updateFabPosition();
  });

  function updateFabPosition() {
    fab.style.transform = `translate3d(${fabPosition.x}px, ${fabPosition.y}px, 0)`;
  }

  function positionPanel() {
    const panelWidth  = 340; // max width
    const gap = 12;

    // Place ABOVE the FAB strictly by pinning the bottom edge
    let left = fabPosition.x - panelWidth + 56; // right-align with FAB
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));

    panel.style.left = left + 'px';
    panel.style.top  = 'auto'; // ensure top is auto
    panel.style.bottom = (window.innerHeight - fabPosition.y + gap) + 'px';
  }

  // V10.0 - Tracking active input
  function attachInputListeners(el) {
    if (el.dataset.waqrChecked) return;
    el.dataset.waqrChecked = 'true';

    el.addEventListener('focus', () => {
      activeInput = el;
      updateImproveButtonPosition();
    });

    el.addEventListener('blur', () => {
      setTimeout(() => { // Small delay to allow click on the button itself
        if (document.activeElement !== improveBtn) {
          updateImproveButtonPosition();
        }
      }, 200);
    });

    el.addEventListener('input', () => {
      activeInput = el;
      updateImproveButtonPosition();
      debouncedHandleShortcut(el);
    });
  }

  // --- Shortcut Logic (V12.0) ---
  let debounceTimer;
  function debouncedHandleShortcut(el) {
     clearTimeout(debounceTimer);
     debounceTimer = setTimeout(() => handleShortcut(el), 250);
  }

  function handleShortcut(el) {
     const text = el.innerText || '';
     const match = text.match(/\/([a-zA-Z0-9]*)$/); // V12.0 standard trigger: /
     
     if (match && document.activeElement === el) {
        // V14.0 - Snapshot Selection before showing popup
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
           lastShortcutRange = sel.getRangeAt(0).cloneRange();
        }

        const query = match[1].toLowerCase();
        storageGet(['templates'], (result) => {
           const templates = (result.templates || []).filter(t => 
              t.category.toLowerCase().includes(query) || 
              t.message.toLowerCase().includes(query)
           ).slice(0, 5);

           if (templates.length > 0) {
              showShortcutPopup(templates, match[0].length);
           } else {
              hideShortcutPopup();
           }
        });
     } else {
        hideShortcutPopup();
     }
  }

  function showShortcutPopup(items, matchLen) {
     scPopup.innerHTML = '';
      items.forEach(item => {
         const div = document.createElement('div');
         div.className = 'waqr-sc-item';
         div.innerHTML = `<div class='waqr-sc-preview' style="font-size: 14px; color: #111; white-space: normal; overflow: visible;">${item.message.slice(0, 80)}${item.message.length > 80 ? '…' : ''}</div>`;
         div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            insertTemplateSurgical(item.message, matchLen);
            hideShortcutPopup();
         });
        scPopup.appendChild(div);
     });
     scPopup.classList.add('open');
     shortcutActive = true;
  }

   function hideShortcutPopup() {
      scPopup.classList.remove('open');
      shortcutActive = false;
   }

   // V15.2: Dismiss shortcut popup automatically when clicking outside
   document.addEventListener('mousedown', (e) => {
      if (shortcutActive && scPopup.classList.contains('open') && !scPopup.contains(e.target)) {
         hideShortcutPopup();
      }
   }, true);

  function insertTemplateSurgical(message, shortcutLen) {
     if (!activeInput) return;
     
     // Because we intercepted 'mousedown', the cursor is perfectly placed exactly where you were typing!
     // We simply highlight backwards by `shortcutLen` characters to select the trigger (e.g. `/pr`)
     const selection = window.getSelection();
     if (selection.rangeCount > 0) {
         const range = selection.getRangeAt(0);
         const node = range.startContainer;
         const offset = range.startOffset;
         
         range.setStart(node, Math.max(0, offset - shortcutLen));
         selection.removeAllRanges();
         selection.addRange(range);
     }

     // Now paste the new message squarely over the highlighted `/pr` trigger
     const dt = new DataTransfer();
     dt.setData('text/plain', message);
     activeInput.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

     activeInput.dispatchEvent(new InputEvent("input", { bubbles: true }));

     hideShortcutPopup();
  }

  const inputObserver = new MutationObserver(() => {
    const inputs = document.querySelectorAll('div[contenteditable="true"]');
    inputs.forEach(attachInputListeners);
  });
  inputObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', updateImproveButtonPosition, true);
  window.addEventListener('resize', updateImproveButtonPosition);

  let capturedSelection = '';

  improveBtn.addEventListener('mousedown', (e) => {
     // V15.0: Prevent focus loss from activeInput to read highlighted text
     e.preventDefault(); 
     const sel = window.getSelection();
     capturedSelection = sel ? sel.toString().trim() : '';
  });

  improveBtn.addEventListener('click', async () => {
     if (!activeInput || improveBtn.classList.contains('loading')) return;

     let isPartial = true;
     let originalText = capturedSelection;

     if (!originalText) {
         originalText = activeInput.innerText.trim();
         isPartial = false;
     }

     if (!originalText) return;

     // Save exactly what is highlighted to replace it later
     const selRange = window.getSelection().rangeCount > 0 ? window.getSelection().getRangeAt(0).cloneRange() : null;

     improveBtn.classList.add('loading');
     improveBtn.innerHTML = '<span>⏳</span> Improving...';
     improveBtn.style.background = '#005a31';

     const failsafe = setTimeout(() => {
        if (improveBtn.classList.contains('loading')) {
           improveBtn.classList.remove('loading');
           improveBtn.innerHTML = '<span>✨</span> Improve';
           improveBtn.style.background = '#25D366';
           showToast('❌ Failed to improve message');
        }
     }, 15000);

     storageGet(['waqrSettings', 'plan'], (res) => {
        const settings = res.waqrSettings || {};
        const isProOrTrial = res.plan === 'pro' || res.plan === 'trial';
        let styleProfile = null;
        
        if (settings.styleLearning !== 'off' && isProOrTrial) {
           styleProfile = captureStyleProfile();
        }

        chrome.runtime.sendMessage({ 
           type: 'AI_IMPROVE', 
           payload: {
              text: originalText,
              messages: getLastMessages(10),
              timeContext: new Date().toLocaleString(),
              tone: settings.tone || 'friendly',
              styleExamples: styleProfile ? styleProfile.join(' | ') : ''
           }
        }, (response) => {
        clearTimeout(failsafe);
        improveBtn.classList.remove('loading');
        improveBtn.innerHTML = '<span>✨</span> Improve';
        improveBtn.style.background = '#25D366';

        if (response && response.limitReached) {
          showUpgradeModal(response.message);
          syncPlanState();
          return;
        }

        if (response?.error) {
           showToast('❌ Failed to improve message');
        } else if (response?.improvedText || response?.suggestion) {
           const finalMsg = response.improvedText || response.suggestion;
           
           activeInput.focus();
           
           // Bulletproof Partial Replacement (V15.0)
           if (isPartial && selRange) {
               const sel = window.getSelection();
               sel.removeAllRanges();
               sel.addRange(selRange);
           } else {
               document.execCommand('selectAll', false, null);
           }
           
           const dt = new DataTransfer();
           dt.setData('text/plain', finalMsg);
           activeInput.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
           
           activeInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
           showToast('✅ Message improved');
           updateImproveButtonPosition();
           syncPlanState();
        } else {
           showToast('❌ Failed to improve message');
        }
     });
   });
});

  // ============================================================================
  // 4. EVENT HANDLERS
  // ============================================================================

  // FAB drag — instant, no lag
  let isDragging = false;
  let didDrag   = false;
  let dragStart = { x: 0, y: 0 };

  fab.addEventListener('mousedown', (e) => {
    isDragging = true;
    didDrag    = false;
    dragStart.x = e.clientX - fabPosition.x;
    dragStart.y = e.clientY - fabPosition.y;
    fab.classList.add('dragging');
    e.preventDefault();
  });

  // passive:true lets the browser skip the cancelable check — no delay
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    let x = e.clientX - dragStart.x;
    let y = e.clientY - dragStart.y;
    
    // Only count as a drag if moved more than 3 pixels
    if (!didDrag && (Math.abs(e.clientX - (dragStart.x + fabPosition.x)) > 3 || Math.abs(e.clientY - (dragStart.y + fabPosition.y)) > 3)) {
      didDrag = true;
    }

    if (didDrag) {
      x = Math.max(0, Math.min(x, window.innerWidth  - 56));
      y = Math.max(0, Math.min(y, window.innerHeight - 56));
      fabPosition = { x, y };

      updateFabPosition();

      // Keep panel glued above FAB while dragging
      if (panel.style.display === 'flex') {
        positionPanel();
      }
    }
  }, { passive: true });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      fab.classList.remove('dragging');
      if (didDrag) {
        storageSet({ fabPosition });
        // Don't reset didDrag here, so the click event can catch it and ignore it
      }
    }
  });

  // FAB click to toggle panel  — only if we didn't drag
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (didDrag) { didDrag = false; return; } // ignore click after drag
    if (panel.style.display === 'flex') {
      panel.style.display = 'none';
    } else {
      panel.style.display = 'flex';
      positionPanel();
    }
  });

  // Close panel
  shadow.getElementById('waqr-close').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Tab switching
  shadow.querySelectorAll('.waqr-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  function switchTab(tabName) {
    currentTab = tabName;

    shadow.querySelectorAll('.waqr-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    shadow.querySelectorAll('.waqr-section').forEach(s => {
      s.classList.toggle('active', s.dataset.section === tabName);
    });

    if (tabName === 'templates') loadTemplates();
  }

  // ============================================================================
  // 5. TEMPLATES MANAGEMENT
  // ============================================================================

  async function syncTemplatesToServer(templates) {
    if (!isContextValid()) return;
    storageGet(['jwtToken'], (res) => {
      if (!res.jwtToken) return;
      chrome.runtime.sendMessage({ 
        type: 'SYNC_TEMPLATES', 
        templates: templates.map(t => ({ id: t.id, text: t.message, category: t.category }))
      });
    });
  }

  function loadTemplatesFromCloud() {
    if (!isContextValid()) return;
    chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' }, (res) => {
      if (res && res.templates) {
        const mapped = res.templates.map(t => ({
          id: t.id || Date.now().toString(),
          name: t.text.length > 28 ? t.text.slice(0, 28).trim() + '…' : t.text,
          message: t.text,
          category: t.category || 'General',
          usedCount: 0,
          lastUsed: null
        }));
        if (mapped.length > 0) {
          storageSet({ templates: mapped }, () => {
            loadTemplates();
          });
        }
      }
    });
  }

  function loadTemplates(category = 'All') {
    if (!isContextValid()) return;
    storageGet(['templates'], (result) => {
      const templates = result.templates || [];
      const list = shadow.getElementById('waqr-templates-list');
      const recent = shadow.getElementById('waqr-recent-templates');
      list.innerHTML = '';

      const sorted = templates.slice().sort((a,b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      const recentText = sorted.slice(0, 4).map(t => t.name).join(' ◦ ');
      recent.textContent = recentText ? `⭐ Recently used: ${recentText}` : '⭐ Recently Used Templates will appear here';

      let visible = sorted;
      if (category && category !== 'All') {
        visible = sorted.filter(t => t.category === category);
      }

      if (visible.length === 0) {
        list.innerHTML = '<div style="font-size: 13px; color:#777">No templates in this category yet.</div>';
        return;
      }

      visible.forEach((template) => {
        const div = document.createElement('div');
        div.className = 'waqr-template';
        div.innerHTML = `
          <div style='display:flex; justify-content:space-between; align-items:center;'>
            <div>
              <div style='font-weight: 600;'>${template.name}</div>
              <div style='font-size: 11px; color: #6a7c8f;'>${template.category}</div>
            </div>
            <div style='display:flex; gap:6px;'>
              <span class='waqr-action-icon' data-action='edit-template' data-id='${template.id}' title='Edit template'>✎</span>
              <span class='waqr-action-icon' data-action='delete-template' data-id='${template.id}' title='Delete template'>🗑</span>
            </div>
          </div>
          <div style='font-size: 13px; color: var(--waqr-text-light); margin-top: 6px;'>${template.message}</div>
        `;

        div.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return; // ignore feature icon clicks
          insertMessage(template.message);
          template.usedCount = (template.usedCount || 0) + 1;
          template.lastUsed = Date.now();
          const updated = templates.map(t => t.id === template.id ? template : t);
          storageSet({ templates: updated });
        });

        div.querySelector('[data-action="edit-template"]').addEventListener('click', (e) => {
          e.stopPropagation();
          shadow.getElementById('waqr-template-message').value = template.message;
          shadow.getElementById('waqr-template-category').value = template.category;
          shadow.getElementById('waqr-add-template').textContent = 'Save Template';
          shadow.getElementById('waqr-add-template').dataset.editing = template.id;
        });

        div.querySelector('[data-action="delete-template"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const filtered = templates.filter(t => t.id !== template.id);
          storageSet({ templates: filtered }, () => {
            loadTemplates(category);
            showToast('Template removed');
            syncTemplatesToServer(filtered);
          });
        });

        list.appendChild(div);
      });
    });
  }

  // Smart Auto-numbering for Template Editor
  shadow.getElementById('waqr-template-message').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      
      const beforeCursor = value.substring(0, start);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      
      const match = currentLine.match(/^(\d+)\.\s/);
      if (match) {
        e.preventDefault();
        const nextNum = parseInt(match[1]) + 1;
        const insert = `\n${nextNum}. `;
        textarea.value = value.substring(0, start) + insert + value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
      }
    }
  });

  shadow.querySelectorAll('.waqr-category').forEach(cat => {
    cat.addEventListener('click', () => {
      shadow.querySelectorAll('.waqr-category').forEach(btn => btn.classList.remove('active'));
      cat.classList.add('active');
      loadTemplates(cat.dataset.category);
    });
  });

  shadow.getElementById('waqr-add-template').addEventListener('click', () => {
    const message  = shadow.getElementById('waqr-template-message').value.trim();
    const category = shadow.getElementById('waqr-template-category').value;
    if (!message) {
      showToast('Please enter a template message');
      return;
    }
    // Auto-generate a short name from the first 28 chars of the message
    const autoName = message.length > 28 ? message.slice(0, 28).trim() + '…' : message;

    const editingId = shadow.getElementById('waqr-add-template').dataset.editing;

    storageGet(['templates'], (result) => {
      const templates = result.templates || [];
      if (editingId) {
        const updated = templates.map(t =>
          t.id === editingId ? { ...t, name: autoName, message, category } : t
        );
        storageSet({ templates: updated }, () => {
          shadow.getElementById('waqr-template-message').value = '';
          shadow.getElementById('waqr-add-template').textContent = '+ Add Template';
          delete shadow.getElementById('waqr-add-template').dataset.editing;
          
          shadow.querySelectorAll('.waqr-category').forEach(btn => btn.classList.remove('active'));
          const targetBtn = Array.from(shadow.querySelectorAll('.waqr-category'))
            .find(b => b.dataset.category === category) || shadow.querySelector('.waqr-category[data-category="All"]');
          if (targetBtn) targetBtn.classList.add('active');

          loadTemplates(category);
          showToast('Template updated!');
          syncTemplatesToServer(updated);
        });
      } else {
        templates.push({
          id: Date.now().toString(),
          name: autoName,
          message,
          category,
          usedCount: 0,
          lastUsed: null
        });
        storageSet({ templates }, () => {
          shadow.getElementById('waqr-template-message').value = '';

          // Switch UI tab automatically to the category saved
          shadow.querySelectorAll('.waqr-category').forEach(btn => btn.classList.remove('active'));
          const targetBtn = Array.from(shadow.querySelectorAll('.waqr-category'))
            .find(b => b.dataset.category === category) || shadow.querySelector('.waqr-category[data-category="All"]');
          if (targetBtn) targetBtn.classList.add('active');

          loadTemplates(category);
          showToast('Template added!');
          syncTemplatesToServer(templates);
        });
      }
    });
  });

  function getLastMessages(count = 20) {
    // ABSOLUTE SCRAPER: Targets the precise metadata structure WhatsApp uses for every message
    const nodes = document.querySelectorAll('div.copyable-text[data-pre-plain-text]');
    const history = [];
    const recentNodes = Array.from(nodes).slice(-count);

    recentNodes.forEach(node => {
      // 1. Determine Ownership (Us vs Them)
      const container = node.closest('.message-in, .message-out, [data-id]');
      let isOut = false;
      if (container) {
          if (container.classList.contains('message-out')) isOut = true;
          else if (container.getAttribute('data-id')?.includes('true_')) isOut = true;
      }

      // 2. Extract Text
      const textEl = node.querySelector('span.selectable-text') || node.querySelector('span[dir="ltr"]') || node.querySelector('span') || node;
      const text = textEl.innerText || textEl.textContent || '';
      
      // 3. Extract Timestamp Context
      const timestamp = node.getAttribute('data-pre-plain-text') || '';

      if (text.trim() && text.trim().length > 1) {
        history.push({
          role: isOut ? 'assistant' : 'user', // "assistant" is us replying, "user" is the other person
          content: text.trim(),
          timestamp: timestamp.trim()
        });
      }
    });

    return history;
  }

  function captureStyleProfile() {
    const nodes = document.querySelectorAll('div.copyable-text[data-pre-plain-text]');
    const myMessages = [];
    
    // Reverse scan to get latest and stop at 50
    for (let i = nodes.length - 1; i >= 0 && myMessages.length < 50; i--) {
      const node = nodes[i];
      const container = node.closest('.message-in, .message-out, [data-id]');
      let isOut = false;
      if (container) {
          if (container.classList.contains('message-out')) isOut = true;
          else if (container.getAttribute('data-id')?.includes('true_')) isOut = true;
      }
      
      if (isOut) {
        const textEl = node.querySelector('span.selectable-text') || node.querySelector('span[dir="ltr"]') || node;
        const text = (textEl.innerText || textEl.textContent || '').trim();
        if (text.length > 5) myMessages.push(text);
      }
    }

    if (myMessages.length === 0) return null;

    return {
      samples: myMessages,
      avgLength: myMessages.reduce((acc, m) => acc + m.length, 0) / myMessages.length,
      emojiFrequency: myMessages.filter(m => /[\u{1F300}-\u{1F9FF}]/u.test(m)).length / myMessages.length
    };
  }

  // ============================================================================
  // 6. PLAN & USAGE SYNC
  // ============================================================================
  function syncPlanState() {
    if (!isContextValid()) return;
    chrome.runtime.sendMessage({ type: 'GET_PLAN_STATE' }, (state) => {
      if (!state) return;
      updateUIForPlan(state);
    });
  }

  function updateUIForPlan(state) {
    const { plan, usage, trialEnd } = state;
    const isPro = plan === 'pro';
    const isTrial = plan === 'trial';
    const isFree = plan === 'free' || !plan;

    // Badges & Links
    shadow.getElementById('waqr-pro-badge').style.display = isPro ? 'inline-block' : 'none';
    shadow.getElementById('waqr-trial-badge').style.display = isTrial ? 'inline-block' : 'none';
    shadow.getElementById('waqr-upgrade-link').style.display = isPro ? 'none' : 'inline-block';

    // Trial Button Logic
    const trialBtn = shadow.getElementById('waqr-start-trial');
    if (trialBtn) {
      trialBtn.style.display = (isFree && !state.trialUsed) ? 'block' : 'none';
    }

    // Theme
    panel.classList.toggle('pro-theme', isPro);
    panel.classList.toggle('trial-theme', isTrial);

    // Usage Counters
    if (isFree || isTrial) {
      shadow.getElementById('waqr-usage-templates').style.display = 'block';
      shadow.getElementById('waqr-usage-ai').style.display = 'block';
      
      const aiCount = (usage?.free_aiReply || 0) + (usage?.aiReply && !usage?.pro_aiReply ? usage.aiReply : 0);
      const improveCount = (usage?.free_improve || 0) + (usage?.improve && !usage?.pro_improve ? usage.improve : 0);

      shadow.getElementById('waqr-usage-ai-count').textContent = aiCount;
      shadow.getElementById('waqr-usage-ai-fill').style.width = (aiCount * 10) + '%';
      shadow.getElementById('waqr-usage-improve-count').textContent = improveCount;
      shadow.getElementById('waqr-usage-improve-fill').style.width = (improveCount * 10) + '%';

      if (isTrial && trialEnd) {
        const left = new Date(trialEnd) - new Date();
        const days = Math.ceil(left / (1000 * 60 * 60 * 24));
        const countdown = shadow.getElementById('waqr-trial-countdown');
        countdown.style.display = 'block';
        countdown.textContent = `🎁 Free Trial: ${days} day${days !== 1 ? 's' : ''} left`;
      }
    } else {
      shadow.getElementById('waqr-usage-templates').style.display = 'none';
      shadow.getElementById('waqr-usage-ai').style.display = 'none';
    }
  }

  function showUpgradeModal(msg) {
    if (msg) shadow.getElementById('waqr-modal-msg').textContent = msg;
    modalOverlay.classList.add('active');
  }

  shadow.getElementById('waqr-modal-close').addEventListener('click', () => {
    modalOverlay.classList.remove('active');
  });

  shadow.getElementById('waqr-modal-upgrade').addEventListener('click', () => {
    window.open('https://www.wa-quick-reply.com/#pricing', '_blank');
    modalOverlay.classList.remove('active');
  });

  // Trial Button Wire
  shadow.getElementById('waqr-start-trial').addEventListener('click', () => {
    storageGet(['email'], (res) => {
      const email = res.email;
      if (!email) {
        showToast('⚠️ Please activate with your email first.');
        return;
      }
      // Paddle Checkout URL with email prefilled
      // Note: In a real app, this should link to your checkout page or trigger Paddle.js
      const checkoutUrl = `https://www.wa-quick-reply.com/#pricing?email=${encodeURIComponent(email)}&trial=true`;
      window.open(checkoutUrl, '_blank');
      showToast('🚀 Opening secure checkout...');
    });
  });

  // Call sync on open
  fab.addEventListener('click', syncPlanState);

  // ============================================================================
  // 7. AI REPLY GENERATION
  // ============================================================================

  shadow.getElementById('waqr-generate').addEventListener('click', async () => {
    const history = getLastMessages(20);
    if (!history || history.length === 0) {
      showToast('⚠️ No recent chat messages found.');
      return;
    }

    const lastMsg = history[history.length - 1];
    let isFollowUp = false;
    
    if (lastMsg.role === 'assistant') {
      isFollowUp = true;
    }

    const genBtn = shadow.getElementById('waqr-generate');
    genBtn.innerHTML = '✨ Thinking...';
    genBtn.disabled = true;

    storageGet(['waqrSettings', 'plan'], (res) => {
      const settings = res.waqrSettings || {};
      const plan = res.plan || 'free';
      const isProOrTrial = plan === 'pro' || plan === 'trial';
      
      // FEATURE LOCK: Block Auto Follow-Up for free users
      if (isFollowUp && !isProOrTrial) {
        genBtn.innerHTML = '✨ Generate AI Reply';
        genBtn.disabled = false;
        showUpgradeModal('🔒 Auto Follow-Up is a Pro feature. Upgrade to unlock unlimited follow-ups!');
        return;
      }

      if (isFollowUp) showToast('⌛ Generating a smart follow-up...');

      // FEATURE LOCK: Disable Style Learning for free users
      let styleProfile = null;
      if (settings.styleLearning !== 'off' && isProOrTrial) {
        styleProfile = captureStyleProfile();
      }

      chrome.runtime.sendMessage({
        type: 'AI_GENERATE',
        history: {
          messages: history,
          mode: isFollowUp ? 'follow_up' : 'reply',
          timestampContext: new Date().toLocaleString(),
          tone: settings.tone || 'friendly',
          replyStyle: settings.replyStyle || 'balanced',
          emojiUsage: settings.emojiUsage || 'natural',
          styleProfile: styleProfile
        }
      }, (response) => {
        genBtn.innerHTML = '✨ Generate AI Reply';
        genBtn.disabled = false;
        if (response && response.suggestion) {
          displaySuggestions([response.suggestion]);
          showToast('✅ Reply ready!');
          syncPlanState();
        } else {
          showToast('⚠️ ' + (response?.error || 'Generation failed.'));
        }
      });
    });
  });

  function displaySuggestions(suggestions) {
    const container = shadow.getElementById('waqr-suggestions');
    container.innerHTML = `<div style="font-size:11px; color:#666; font-weight:600; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Recent Suggestions</div>`;

    suggestions.forEach(suggestion => {
      const div = document.createElement('div');
      div.className = 'waqr-template';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.gap = '8px';
      
      div.innerHTML = `
        <div style="font-size:13px; line-height:1.4; color:#121212;">${suggestion}</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <button class="waqr-btn secondary insert-btn" style="margin-bottom:0; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px; padding:6px; flex:1;">
            <span>📋</span> [ Insert ]
          </button>
          <div style="display:flex; gap:4px; margin-left:8px;">
            <button class="waqr-btn secondary feedback-btn" data-fb="positive" style="padding:4px 8px; margin:0; font-size:12px; border-radius:4px;" title="Helpful">👍</button>
            <button class="waqr-btn secondary feedback-btn" data-fb="negative" style="padding:4px 8px; margin:0; font-size:12px; border-radius:4px;" title="Not Helpful">👎</button>
          </div>
        </div>
      `;

      div.querySelector('.insert-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        insertMessage(suggestion);
        showToast('✅ Inserted!');
      });

      div.querySelectorAll('.feedback-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const feedback = btn.getAttribute('data-fb');
          chrome.runtime.sendMessage({ type: 'SUBMIT_FEEDBACK', suggestion, feedback });
          
          btn.parentElement.innerHTML = '<span style="font-size:10px; color:#10b981;">Thanks!</span>';
        });
      });

      div.addEventListener('click', () => insertMessage(suggestion));
      
      container.appendChild(div);
    });
  }

  // ============================================================================
  // 8. UTILITY FUNCTIONS
  // ============================================================================

  function findMessageInput() {
    return document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
      document.querySelector('div[title="Type a message"]') ||
      document.querySelector('footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('input[type="text"]') ||
      document.querySelector('input[type="search"]');
  }

  function clickSendButton() {
    const sendButton = document.querySelector('button[data-testid="compose-btn-send"]') || document.querySelector('[data-icon="send"]');
    if (sendButton) {
      sendButton.click();
      return true;
    }

    const input = findMessageInput();
    if (input) {
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      input.dispatchEvent(enterEvent);
      return true;
    }

    return false;
  }

  function insertMessage(message, autoSend = false) {
    const input = findMessageInput();

    if (!input) {
      showToast('Could not find WhatsApp message box. Click inside the chat first.');
      return false;
    }

    input.focus();

    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      const clear = () => {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input); 
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      };

      clear();
      setTimeout(() => {
        clear();
        const ok = document.execCommand('insertText', false, message);
        if (!ok) {
          const dt = new DataTransfer();
          dt.setData('text/plain', message);
          input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 10);
    } else if ('value' in input) {
      input.value = message;
    } else {
      input.textContent = message;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));

    showToast('Message inserted! ✅');
    panel.style.display = 'none';

    if (autoSend) {
      setTimeout(() => {
        const sendBtn = document.querySelector('button[data-testid="compose-btn-send"]') ||
                        document.querySelector('[data-icon="send"]');
        if (sendBtn) {
          sendBtn.click();
        } else {
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
          }));
        }
      }, 250);
    }

    return true;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ============================================================================
  // 9. INITIALIZATION
  // ============================================================================

  function initializeComponents() {
    if (!isContextValid()) {
      const p = shadow.getElementById('waqr-panel');
      if (p) {
        p.style.border = '2px solid #ff4d4d';
        p.innerHTML = `<div style="padding:20px;text-align:center;color:#ff4d4d;font-weight:700;">⚠️ Extension Updated<br>Please refresh WhatsApp.</div>`;
      }
      return;
    }
    loadTemplates();
    updateFabPosition();
    syncPlanState();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.plan || changes.usage || changes.subscription)) {
      syncPlanState();
    }
  });

  initializeComponents();

  // ============================================================================
  // TOOLTIP ONBOARDING SYSTEM (Phase 6)
  // ============================================================================
  const TOOLTIP_STEPS = [
    {
      id: 'tooltip_templates',
      targetSelector: '.waqr-tab[data-tab="templates"]',
      title: '📋 Smart Templates',
      body: 'Save your best replies and reuse them in one click. Try typing <b>/price</b> in any chat!',
      position: 'below'
    },
    {
      id: 'tooltip_ai',
      targetSelector: '.waqr-tab[data-tab="ai"]',
      title: '✨ AI Reply',
      body: 'Let AI read the chat and write the perfect reply for you. Works with any tone.',
      position: 'below'
    },
    {
      id: 'tooltip_improve',
      targetSelector: '#waqr-improve-btn',
      title: '⚡ Improve Message',
      body: 'Type a rough draft, then click <b>Improve</b> to make it sound polished and professional.',
      position: 'above'
    }
  ];

  const tooltipStyleEl = document.createElement('style');
  tooltipStyleEl.textContent = `
    .waqr-tooltip {
      position: fixed; background: #1e293b; color: white; padding: 12px 16px;
      border-radius: 12px; width: 220px; z-index: 3000000; pointer-events: auto;
      box-shadow: 0 8px 28px rgba(0,0,0,0.35); border: 1px solid #334155;
      animation: waqr-tooltip-in 0.25s ease-out;
    }
    @keyframes waqr-tooltip-in {
      from { opacity: 0; transform: scale(0.9) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .waqr-tooltip::before {
      content: ''; position: absolute; left: 20px;
      border: 7px solid transparent;
    }
    .waqr-tooltip.pos-above::before { bottom: -14px; border-top-color: #1e293b; }
    .waqr-tooltip.pos-below::before { top: -14px; border-bottom-color: #1e293b; }
    .waqr-tooltip-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
    .waqr-tooltip-body { font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .waqr-tooltip-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
    .waqr-tooltip-dismiss { font-size: 11px; color: #64748b; cursor: pointer; text-decoration: underline; }
    .waqr-tooltip-dismiss:hover { color: #94a3b8; }
    .waqr-tooltip-next { background: #25D366; color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
  `;
  shadow.appendChild(tooltipStyleEl);

  let currentTooltipEl = null;

  function showTooltipStep(stepIndex) {
    if (currentTooltipEl) currentTooltipEl.remove();
    if (stepIndex >= TOOLTIP_STEPS.length) return;

    const step = TOOLTIP_STEPS[stepIndex];
    const target = shadow.querySelector(step.targetSelector);
    if (!target) { showTooltipStep(stepIndex + 1); return; }

    const rect = target.getBoundingClientRect();
    if (!rect || rect.width === 0) { showTooltipStep(stepIndex + 1); return; }

    const tip = document.createElement('div');
    tip.className = `waqr-tooltip pos-${step.position}`;
    const isLast = stepIndex === TOOLTIP_STEPS.length - 1;
    tip.innerHTML = `
      <div class="waqr-tooltip-title">${step.title}</div>
      <div class="waqr-tooltip-body">${step.body}</div>
      <div class="waqr-tooltip-footer">
        <span class="waqr-tooltip-dismiss">Skip all</span>
        <button class="waqr-tooltip-next">${isLast ? 'Got it! 🎉' : 'Next →'}</button>
      </div>
    `;

    if (step.position === 'below') {
      tip.style.top = (rect.bottom + 8) + 'px';
      tip.style.left = rect.left + 'px';
    } else {
      tip.style.top = (rect.top - 130) + 'px';
      tip.style.left = rect.left + 'px';
    }

    tip.querySelector('.waqr-tooltip-next').addEventListener('click', () => {
      tip.remove();
      currentTooltipEl = null;
      if (isLast) {
        storageSet({ tooltips_seen: true });
      } else {
        showTooltipStep(stepIndex + 1);
      }
    });

    tip.querySelector('.waqr-tooltip-dismiss').addEventListener('click', () => {
      tip.remove();
      currentTooltipEl = null;
      storageSet({ tooltips_seen: true });
    });

    shadow.appendChild(tip);
    currentTooltipEl = tip;
  }

  // Show tooltips only for first-time users, after a short delay
  storageGet(['tooltips_seen', 'onboarding_seen'], (r) => {
    if (!r || !r.tooltips_seen) {
      setTimeout(() => {
        if (panel.style.display === 'flex') {
          showTooltipStep(0);
        } else {
          const fabClickOnce = () => {
            setTimeout(() => showTooltipStep(0), 600);
            fab.removeEventListener('click', fabClickOnce);
          };
          fab.addEventListener('click', fabClickOnce);
        }
      }, 3000);
    }
  });

  function getCurrentChatName() {
    const testIdEl = document.querySelector('[data-testid="conversation-info-header-chat-title"]');
    if (testIdEl && testIdEl.textContent.trim()) return testIdEl.textContent.trim();
    const headerTitle = document.querySelector('#main header span[title]');
    if (headerTitle && headerTitle.getAttribute('title')) return headerTitle.getAttribute('title').trim();
    const activeSidebar = document.querySelector('[aria-selected="true"]') || 
                          document.querySelector('[data-testid="list-item-active"]') ||
                          document.querySelector('div[role="row"]._ak_8');
    
    if (activeSidebar) {
      const sidebarTitle = activeSidebar.querySelector('span[title]') || activeSidebar.querySelector('div[title]');
      if (sidebarTitle && sidebarTitle.getAttribute('title')) return sidebarTitle.getAttribute('title').trim();
    }
    const ariaHeader = document.querySelector('header [aria-label]');
    if (ariaHeader && ariaHeader.getAttribute('aria-label')) {
       const label = ariaHeader.getAttribute('aria-label').trim()
                                .replace('Chat info', '')
                                .replace('Conversation info', '')
                                .replace('Contact info', '').trim();
       if (label && label.length > 1) return label;
    }
    const headerSpans = document.querySelectorAll('#main header span');
    for (const span of headerSpans) {
      const txt = span.textContent.trim();
      if (txt.length > 2 && !txt.includes(':') && !txt.includes('/') && !/[\d]/.test(txt)) {
        return txt;
      }
    }
    return null;
  }

  function getActiveChatMetadata() {
     const allElements = document.querySelectorAll('*');
     const candidates = [];
     const viewportWidth = window.innerWidth;

     for (const el of allElements) {
        let rawId = null;
        const did = el.getAttribute('data-id') || '';
        if (did.includes('@c.us') || did.includes('@g.us')) rawId = did;
        
        if (!rawId) {
           for (const attr of el.attributes) {
              if (attr.value.includes('@c.us') || attr.value.includes('@g.us')) {
                 rawId = attr.value;
                 break;
              }
           }
        }

        if (rawId) {
           const rect = el.getBoundingClientRect();
           if (rect.width > 0 && rect.height > 0) {
              const centerX = rect.left + (rect.width / 2);
              let score = 0;
              if (centerX > 400) score += 100;
              if (centerX > viewportWidth / 2) score += 50;
              
              candidates.push({
                 id: rawId,
                 score: score,
                 centerX: centerX
              });
           }
        }
     }

     if (candidates.length === 0) {
        return { phone: null, chatName: getCurrentChatName(), type: 'none' };
     }

     candidates.sort((a, b) => b.score - a.score || b.centerX - a.centerX);
     const bestPick = candidates[0].id;
     return parseChatId(bestPick);
  }

  function parseChatId(rawId) {
     const phoneMatch = rawId.match(/(\d+)@c\.us/);
     if (phoneMatch) {
        return { phone: phoneMatch[1], chatName: getCurrentChatName(), type: 'personal' };
     }
     if (rawId.includes('@g.us')) {
        return { phone: null, chatName: getCurrentChatName(), type: 'group' };
     }
     return { phone: null, chatName: getCurrentChatName(), type: 'other' };
  }

  function copyToClipboard(text) {
     try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (success) {
           showToast('✅ Message copied to clipboard!');
           return true;
        }
      } catch (err) {}
     
     navigator.clipboard.writeText(text).then(() => {
        showToast('✅ Message copied to clipboard!');
     }).catch(() => {
        showToast('❌ Copy failed. Please copy manually.');
     });
     return false;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'COPY_TEXT') {
       copyToClipboard(request.text);
       sendResponse({ success: true });
       return false;
    }

    if (request.type === 'TOGGLE_PANEL') {
      if (panel.style.display === 'flex') {
        panel.style.display = 'none';
      } else {
        panel.style.display = 'flex';
        positionPanel();
        syncPlanState();
      }
      sendResponse({ success: true });
      return false;
    }
  });

  function initializeExtension() {
    if (window.WAQR_LOADED) return;
    window.WAQR_LOADED = true;

    loadTemplates();
    loadTemplatesFromCloud();
    updateFabPosition();
    syncPlanState();
  }

  storageGet(['email'], (res) => {
    const email = res && res.email;
    if (!email) {
      const hostEl = document.createElement('div');
      hostEl.id = 'waqr-onboarding-host';
      hostEl.setAttribute('style', 'position: fixed; bottom: 24px; right: 24px; z-index: 999999; pointer-events: auto;');
      document.documentElement.appendChild(hostEl);

      const shadow = hostEl.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .onboarding-modal { background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); padding: 32px; max-width: 380px; width: 100%; animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes slideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .onboarding-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .onboarding-title { font-size: 18px; font-weight: 700; color: #0f172a; }
        .onboarding-subtitle { font-size: 14px; color: #64748b; margin-bottom: 24px; line-height: 1.5; }
        .onboarding-input-group { margin-bottom: 20px; }
        .onboarding-input { width: 100%; padding: 12px 16px; font-size: 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; background: white; color: #1e293b; transition: all 0.2s; }
        .onboarding-input:focus { outline: none; border-color: #27a55e; box-shadow: 0 0 0 3px rgba(39, 165, 94, 0.1); }
        .onboarding-btn { width: 100%; padding: 12px 16px; font-size: 15px; font-weight: 600; background: linear-gradient(135deg, #27a55e 0%, #0f7a52 100%); color: white; border: none; border-radius: 10px; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(39, 165, 94, 0.2); }
        .onboarding-error { color: #dc2626; font-size: 13px; margin-top: 8px; display: none; }
      `;
      shadow.appendChild(styleEl);

      const modal = document.createElement('div');
      modal.className = 'onboarding-modal';
      const onboardIconUrl = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('icons/icon128.png') : 'icons/icon128.png';
      modal.innerHTML = `
        <div class="onboarding-header">
          <img src="${onboardIconUrl}" alt="WA QuickReply" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0;" />
          <div>
            <div class="onboarding-title">WA QuickReply</div>
            <div style="font-size: 12px; color: #94a3b8;">Activate to get started</div>
          </div>
        </div>
        <div class="onboarding-subtitle">Enter your email to unlock templates, AI replies.</div>
        <div class="onboarding-input-group">
          <input type="email" class="onboarding-input" id="onboard-email" placeholder="you@example.com" autocomplete="email">
          <div class="onboarding-error" id="onboard-error"></div>
        </div>
        <button class="onboarding-btn" id="onboard-activate">Activate Extension</button>
      `;
      shadow.appendChild(modal);

      const input = shadow.querySelector('#onboard-email');
      const btn = shadow.querySelector('#onboard-activate');
      const error = shadow.querySelector('#onboard-error');

      btn.addEventListener('click', () => {
        const val = (input.value || '').trim().toLowerCase();
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
        if (!ok) {
          error.textContent = 'Please enter a valid email';
          error.style.display = 'block';
          input.focus();
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Activating...';
        storageSet({ email: val }, () => {
          btn.textContent = 'Success! ✅';
          btn.style.background = '#059669';
          
          // Small delay for visual confirmation before initializing and removing
          setTimeout(() => {
            initializeExtension();
            if (hostEl && hostEl.parentNode) {
              hostEl.remove();
            }
          }, 1200);
        });
      });

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btn.click();
        if (error.style.display === 'block') error.style.display = 'none';
      });

      setTimeout(() => input.focus(), 100);
    } else {
      initializeExtension();
    }
  });
})();
