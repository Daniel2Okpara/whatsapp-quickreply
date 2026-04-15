/**
 * WA QuickReply — Content Script (MVP v2.0)
 * Floating panel with templates, AI replies, and scheduling
 */

(function() {
  'use strict';

  function initializeExtension() {
    // Prevent double injection
    if (window.WAQR_LOADED) return;
    window.WAQR_LOADED = true;

  // ============================================================================
  // 0. STABILITY & CONTEXT CHECK
  // ============================================================================
  function isContextValid() {
    if (!chrome.runtime?.id) {
      console.warn('WA QuickReply: Extension context invalidated. Please refresh the page.');
      // Optionally show a subtle UI indicator
      return false;
    }
    return true;
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
    const BACKEND_URL = 'http://localhost:3000';
    chrome.storage.local.get(['email'], (r) => {
      const email = r && r.email;
      if (!email) return;
      try {
        const url = `${BACKEND_URL}/events?email=${encodeURIComponent(email)}`;
        const es = new EventSource(url);
        es.addEventListener('subscription_update', (ev) => {
          try {
            const data = JSON.parse(ev.data || '{}');
            chrome.storage.local.set({ subscription: data }, () => {
              applyProUI(); // re-apply Pro UI immediately
            });
          } catch (e) {
            console.warn('SSE parse error', e);
          }
        });
        es.onerror = (err) => {
          console.warn('SSE error', err);
          es.close();
          setTimeout(() => setupSSE(), 5000); // reconnect
        };
        window.addEventListener('unload', () => es.close());
      } catch (e) {
        console.warn('SSE connect failed', e);
      }
    });
  })();

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      --waqr-primary: #27a55e;
      --waqr-primary-dark: #0f7a52;
      --waqr-bg: #ffffff;
      --waqr-text: #121212;
      --waqr-text-light: #5e6d79;
      --waqr-border: #d8e7df;
      --waqr-radius: 12px;
      --waqr-pro: linear-gradient(135.22deg, #ff9b05 0%, #ffc640 100%);
    }

    #waqr-panel.pro-theme {
      --waqr-primary: #f59e0b;
      border: 2px solid #f59e0b;
    }

    #waqr-panel.pro-theme #waqr-header {
      background: var(--waqr-pro);
    }

    #waqr-panel.pro-theme .waqr-btn:not(.secondary) {
      background: var(--waqr-pro);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    }
                                                                                                                                                                                                     
    button { cursor: pointer; transition: all 0.2s ease; }
    button:hover { opacity: 0.9; transform: translateY(-1px); }

    #waqr-fab {
      position: fixed;
      left: 0;
      top: 0;
      width: 56px;
      height: 56px;
      background: var(--waqr-primary);
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      border: none;
      pointer-events: auto;
      will-change: transform;
      transform: translate3d(0,0,0);
    }

    #waqr-fab:hover { box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
    #waqr-fab.dragging { cursor: grabbing; opacity: 0.9; }

    #waqr-shortcut-popup {
      position: fixed;
      bottom: 72px;
      left: 50%;
      transform: translateX(-50%);
      width: 320px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      z-index: 999999;
      pointer-events: auto;
      display: none;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--waqr-border);
      max-height: 220px;
      overflow-y: auto;
    }
    #waqr-shortcut-popup.open { display: flex; }
    .waqr-sc-item {
      padding: 10px 14px;
      cursor: pointer;
      font-size: 13px;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.12s;
    }
    .waqr-sc-item:last-child { border-bottom: none; }
    .waqr-sc-item:hover { background: #edf7f1; }
    .waqr-sc-key { font-weight: 700; color: var(--waqr-primary); font-size: 12px; margin-right: 4px; }
    .waqr-sc-preview { color: #667; font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
  `;
  shadow.appendChild(styleEl);

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
  panel.innerHTML = `
    <div id='waqr-header'>
      <div style="display:flex; align-items:center; gap:8px;">
        <span>WA QuickReply</span>
        <span id="waqr-pro-badge" style="display:none; background:rgba(255,255,255,0.2); padding:2px 6px; border-radius:4px; font-size:10px; font-weight:800; letter-spacing:0.5px;">PRO</span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <button id='waqr-settings' style='background: none; border: none; color: white; font-size: 16px; cursor: pointer; display:flex; align-items:center;'>⚙️</button>
        <a href="https://wa-quickreply-landing.vercel.app/#pricing" target="_blank" id="waqr-upgrade-link" style="color:white; font-size:11px; text-decoration:underline; font-weight:500;">Upgrade to Pro</a>
        <button id='waqr-close' style='background: none; border: none; color: white; font-size: 20px; cursor: pointer; display:flex; align-items:center;'>×</button>
      </div>
    </div>
    <div id='waqr-tabs'>
      <div class='waqr-tab active' data-tab='templates'>Templates</div>
      <div class='waqr-tab' data-tab='ai'>AI Reply</div>
    </div>
    <div id='waqr-content'>
      <div class='waqr-section active' data-section='templates'>
        <div style='font-size: 13px; color: #555; margin-bottom: 8px;'>Save and reuse your best replies</div>
        <div style='display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;'>
          <button class='waqr-btn secondary waqr-category active' data-category='All'>All</button>
          <button class='waqr-btn secondary waqr-category' data-category='Pricing'>Pricing</button>
          <button class='waqr-btn secondary waqr-category' data-category='Follow-ups'>Follow-ups</button>
          <button class='waqr-btn secondary waqr-category' data-category='Greetings'>Greetings</button>
        </div>
        <div id='waqr-recent-templates' style='font-size: 13px; color: #444; margin-bottom: 12px;'>⭐ Recently Used Templates will appear here</div>
        <div id='waqr-templates-list' style='max-height: 140px; overflow-y: auto; margin-bottom: 8px;'></div>
        <textarea class='waqr-input' id='waqr-template-message' placeholder='Template message e.g., "Hi, here are our products: \n1. Product A \n2. Product B"'></textarea>
        <select class='waqr-input' id='waqr-template-category'>
          <option value='Pricing'>Pricing</option>
          <option value='Follow-ups'>Follow-ups</option>
          <option value='Greetings'>Greetings</option>
          <option value='General'>General</option>
        </select>
        <button class='waqr-btn' id='waqr-add-template'>+ Add Template</button>
      </div>
      <div class='waqr-section' data-section='ai'>
        <div style='font-size: 13px; color: #555; margin-bottom: 8px;'>Generate smart responses instantly</div>
        <select class='waqr-input' id='waqr-tone'>
          <option value='professional'>Professional</option>
          <option value='friendly'>Friendly</option>
          <option value='funny'>Funny</option>
          <option value='casual'>Casual</option>
          <option value='formal'>Formal</option>
        </select>
        <button class='waqr-btn' id='waqr-generate'>Generate AI Reply</button>
        <div id='waqr-suggestions' style='margin-top: 12px;'></div>
      </div>
    </div>
      </div>
    </div>
  `;
  shadow.appendChild(panel);

  // Inline Settings Panel
  const settingsPanel = document.createElement('div');
  settingsPanel.id = 'waqr-settings-panel';
  settingsPanel.style.display = 'none';
  settingsPanel.style.position = 'absolute';
  settingsPanel.style.top = '60px';
  settingsPanel.style.right = '10px';
  settingsPanel.style.background = 'white';
  settingsPanel.style.border = '1px solid #ddd';
  settingsPanel.style.borderRadius = '8px';
  settingsPanel.style.padding = '16px';
  settingsPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  settingsPanel.style.zIndex = '1000000';
  settingsPanel.style.width = '250px';
  settingsPanel.innerHTML = `
    <div style="font-weight:600; margin-bottom:12px;">Settings</div>
    <label style="display:block; font-size:13px; margin-bottom:4px;">Email:</label>
    <input type="email" id="waqr-settings-email" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; margin-bottom:12px; box-sizing:border-box;">
    <button id="waqr-settings-save" style="background:#27a55e; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; width:100%;">Save</button>
    <div style="margin-top:12px; font-size:13px; color:#444;">Change email</div>
    <a href="#" id="waqr-change-email-toggle" style="display:block; margin-top:8px; color:#256a45; text-decoration:underline; cursor:pointer;">Change email address</a>
    <div id="waqr-change-email-box" style="display:none; margin-top:8px;">
      <input type="email" id="waqr-change-current" placeholder="Current email" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
      <input type="email" id="waqr-change-new" placeholder="New email" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; margin-bottom:8px; box-sizing:border-box;">
      <button id="waqr-change-email-save" style="background:#256a45; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; width:100%;">Change</button>
      <div id="waqr-change-email-error" style="color:#dc2626; font-size:12px; margin-top:8px; display:none;"></div>
    </div>
  `;
  shadow.appendChild(settingsPanel);

  // Wire settings button
  const settingsBtn = shadow.querySelector('#waqr-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const isVisible = settingsPanel.style.display !== 'none';
      settingsPanel.style.display = isVisible ? 'none' : 'block';
    });
  }

  // Prefill email in settings
  chrome.storage.local.get(['email'], (r) => {
    const email = r && r.email;
    const input = shadow.querySelector('#waqr-settings-email');
    if (input && email) input.value = email;
  });

  // Save email from settings
  const saveBtn = shadow.querySelector('#waqr-settings-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const input = shadow.querySelector('#waqr-settings-email');
      const val = (input.value || '').trim().toLowerCase();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (!ok) { alert('Please enter a valid email address'); return; }
      chrome.storage.local.set({ email: val }, () => {
        settingsPanel.style.display = 'none';
        location.reload(); // reload to reconnect SSE with new email
      });
    });
  }

  // Change email inline flow
  const changeToggle = shadow.querySelector('#waqr-change-email-toggle');
  const changeBox = shadow.querySelector('#waqr-change-email-box');
  if (changeToggle && changeBox) {
    changeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      changeBox.style.display = changeBox.style.display === 'none' ? 'block' : 'none';
    });

    const changeSave = shadow.querySelector('#waqr-change-email-save');
    const changeErr = shadow.querySelector('#waqr-change-email-error');
    changeSave.addEventListener('click', async () => {
      const cur = (shadow.querySelector('#waqr-change-current').value || '').trim().toLowerCase();
      const nw = (shadow.querySelector('#waqr-change-new').value || '').trim().toLowerCase();
      changeErr.style.display = 'none';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cur) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nw)) {
        changeErr.textContent = 'Please enter valid emails'; changeErr.style.display = 'block'; return;
      }
      if (cur === nw) { changeErr.textContent = 'New email must be different'; changeErr.style.display = 'block'; return; }

      // Call backend to update email
      try {
        const resp = await fetch('https://wa-quickreply-server.onrender.com/user/update-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentEmail: cur, newEmail: nw })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          changeErr.textContent = data.error || data.message || `Failed (${resp.status})`;
          changeErr.style.display = 'block';
          return;
        }

        // Success: update storage and UI
        chrome.storage.local.set({ email: nw }, () => {
          shadow.querySelector('#waqr-settings-email').value = nw;
          changeBox.style.display = 'none';
          settingsPanel.style.display = 'none';
          showToast('Email updated');
          // Update upgrade link param
          const upgradeLink = shadow.querySelector('#waqr-upgrade-link');
          if (upgradeLink) upgradeLink.href = 'https://wa-quickreply-landing.vercel.app/#pricing?email=' + encodeURIComponent(nw);
        });
      } catch (err) {
        changeErr.textContent = 'Server error'; changeErr.style.display = 'block';
      }
    });
  }

  // Prefill upgrade link with stored email. Email management moved into settings.
  (function setEmailDisplayAndUpgrade() {
    chrome.storage.local.get(['email'], (r) => {
      const email = (r && r.email) ? r.email : null;
      const upgradeLink = shadow.querySelector('#waqr-upgrade-link');
      if (upgradeLink) {
        const base = 'https://wa-quickreply-landing.vercel.app/#pricing';
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
      console.warn('[WAQR] applyProUI failed', e?.message || e);
    }
  }

  chrome.storage.local.get(['subscription'], (res) => {
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
  chrome.storage.local.get(['fabPosition'], (result) => {
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
        chrome.storage.local.get(['templates'], (result) => {
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

     chrome.runtime.sendMessage({ type: 'AI_IMPROVE', text: originalText }, (response) => {
        clearTimeout(failsafe);
        improveBtn.classList.remove('loading');
        improveBtn.innerHTML = '<span>✨</span> Improve';
        improveBtn.style.background = '#25D366';

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
        } else {
           showToast('❌ Failed to improve message');
        }
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
        chrome.storage.local.set({ fabPosition });
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
    if (panel.style.display === 'flex') positionPanel();
  }

  // ============================================================================
  // 5. TEMPLATES MANAGEMENT
  // ============================================================================

  function loadTemplates(category = 'All') {
    if (!isContextValid()) return;
    chrome.storage.local.get(['templates'], (result) => {
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
          chrome.storage.local.set({ templates: updated });
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
          chrome.storage.local.set({ templates: filtered }, () => {
            loadTemplates(category);
            showToast('Template removed');
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

    chrome.storage.local.get(['templates'], (result) => {
      const templates = result.templates || [];
      if (editingId) {
        const updated = templates.map(t =>
          t.id === editingId ? { ...t, name: autoName, message, category } : t
        );
        chrome.storage.local.set({ templates: updated }, () => {
          shadow.getElementById('waqr-template-message').value = '';
          shadow.getElementById('waqr-add-template').textContent = '+ Add Template';
          delete shadow.getElementById('waqr-add-template').dataset.editing;
          
          shadow.querySelectorAll('.waqr-category').forEach(btn => btn.classList.remove('active'));
          const targetBtn = Array.from(shadow.querySelectorAll('.waqr-category'))
            .find(b => b.dataset.category === category) || shadow.querySelector('.waqr-category[data-category="All"]');
          if (targetBtn) targetBtn.classList.add('active');

          loadTemplates(category);
          showToast('Template updated!');
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
        chrome.storage.local.set({ templates }, () => {
          shadow.getElementById('waqr-template-message').value = '';

          // Switch UI tab automatically to the category saved
          shadow.querySelectorAll('.waqr-category').forEach(btn => btn.classList.remove('active'));
          const targetBtn = Array.from(shadow.querySelectorAll('.waqr-category'))
            .find(b => b.dataset.category === category) || shadow.querySelector('.waqr-category[data-category="All"]');
          if (targetBtn) targetBtn.classList.add('active');

          loadTemplates(category);
          showToast('Template added!');
        });
      }
    });
  });

  function getLast15Messages() {
    const results = [];

    // Core scrape strategy: Select the bubble wrappers explicitly
    const bubbles = Array.from(document.querySelectorAll('div[class*="message-in"], div[class*="message-out"]'));
    
    if (bubbles.length > 0) {
      bubbles.forEach(bubble => {
        // Find text block inside bubble
        const textEl = bubble.querySelector('.copyable-text span.selectable-text') || 
                       bubble.querySelector('.copyable-text') ||
                       bubble.querySelector('span.selectable-text') ||
                       bubble.querySelector('span[dir="ltr"]');
                       
        if (!textEl || !textEl.innerText.trim()) return;

        // Try getting timestamp if present
        const timeEl = bubble.querySelector('[data-testid="msg-meta"]') || 
                       bubble.querySelector('span[aria-label]');
        const timestamp = timeEl ? timeEl.innerText.trim() : '';

        const isIn = bubble.className.includes('message-in');
        
        results.push({ text: textEl.innerText.trim(), direction: isIn ? 'in' : 'out', timestamp });
      });
    }
    
    // Very barebones fallback
    if (results.length === 0) {
       const main = document.querySelector('#main');
       if (main) {
         const allText = Array.from(main.querySelectorAll('span[dir="ltr"], div.copyable-text span'))
           .map(node => node.textContent.trim())
           .filter(t => t.length > 1);
         
         allText.slice(-15).forEach(txt => {
           results.push({ text: txt, direction: 'in', timestamp: '' }); // Assume in for AI context
         });
       }
    }

    if (results.length === 0) {
       const spans = document.querySelectorAll('span[dir="ltr"]');
       spans.forEach(span => {
         const row = span.closest('[class*="message-"]');
         if (row && span.innerText.trim()) {
            const isIn = row.className.includes('message-in');
            results.push({ text: span.innerText.trim(), direction: isIn ? 'in' : 'out', timestamp: '' });
         }
       });
    }

    return results.slice(-15);
  }

  function getConversationContext() {
    const messages = getLast15Messages();
    return messages.map(m => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      content: m.text,
      meta: m.timestamp
    }));
  }

  // ============================================================================
  // 6. AI REPLY GENERATION
  // ============================================================================

  shadow.getElementById('waqr-generate').addEventListener('click', () => {
    const tone = shadow.getElementById('waqr-tone').value;
    const context = getConversationContext();
    const timeOfDay = getTimeOfDay();

    if (!context || context.length < 1) {
      showToast('No recent chat messages found.');
      return;
    }

    const btn = shadow.getElementById('waqr-generate');
    btn.classList.add('generate');
    btn.innerHTML = '⌛ Generating...';
    btn.disabled = true;

    chrome.runtime.sendMessage({ type: 'AI_GENERATE', history: context, personality: tone, timeOfDay }, (response) => {
      btn.classList.remove('generate');
      btn.innerHTML = 'Generate AI Reply';
      btn.disabled = false;

      if (response.error) {
        showToast('⚠️ ' + response.error);
      } else if (response.suggestion) {
        displaySuggestions([response.suggestion]);
        showToast('✅ Suggestions ready!');
      } else {
        showToast('AI could not create a reply right now.');
      }
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
        <button class="waqr-btn secondary" style="margin-bottom:0; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px; padding:6px;">
          <span>📋</span> [ Insert ]
        </button>
      `;

      div.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        insertMessage(suggestion);
        showToast('✅ Inserted!');
      });

      // Also allow clicking the box itself
      div.addEventListener('click', () => insertMessage(suggestion));
      
      container.appendChild(div);
    });
  }

// End of Templates Management logic purge (V13.0)

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

// Legacy Shortcut system removed (V13.2)


  function insertMessage(message, autoSend = false) {
    const input = findMessageInput();

    if (!input) {
      showToast('Could not find WhatsApp message box. Click inside the chat first.');
      return false;
    }

    // Focus the WA input
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

    // Notify WhatsApp's Lexical state
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

  // ============================================================================
  // 9. INITIALIZATION & SUBSCRIPTION
  // ============================================================================

  function updateTierUI() {
    if (!isContextValid()) {
      const panel = shadow.getElementById('waqr-panel');
      if (panel) {
        panel.style.border = '2px solid #ff4d4d';
        panel.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #ff4d4d; font-weight: bold;">
            <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
            Extension Updated<br>Please refresh WhatsApp to continue.
            <button onclick="window.location.reload()" style="margin-top: 15px; padding: 8px 16px; background: #ff4d4d; color: white; border: none; border-radius: 6px; cursor: pointer;">Refresh Now</button>
          </div>
        `;
      }
      return;
    }
    chrome.storage.local.get(['subscription'], (data) => {
      const tier = data.subscription?.tier || 'free';
      const panel = shadow.getElementById('waqr-panel');
      const proBadge = shadow.getElementById('waqr-pro-badge');
      const upgradeLink = shadow.getElementById('waqr-upgrade-link');

      if (tier === 'pro') {
        panel.classList.add('pro-theme');
        proBadge.style.display = 'inline-block';
        upgradeLink.style.display = 'none';
      } else {
        panel.classList.remove('pro-theme');
        proBadge.style.display = 'none';
        upgradeLink.style.display = 'inline-block';
      }
    });
  }

  loadTemplates();
  updateFabPosition();
  updateTierUI();
  
  // Listen for storage changes (e.g. user upgrades)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.subscription) updateTierUI();
  });

  function getCurrentChatName() {
    // Probe 1: Primary data-testid (Standard)
    const testIdEl = document.querySelector('[data-testid="conversation-info-header-chat-title"]');
    if (testIdEl && testIdEl.textContent.trim()) return testIdEl.textContent.trim();

    // Probe 2: Header title attribute (Common for individuals)
    const headerTitle = document.querySelector('#main header span[title]');
    if (headerTitle && headerTitle.getAttribute('title')) return headerTitle.getAttribute('title').trim();

    // Probe 3: Sidebar active selection (Best fallback)
    const activeSidebar = document.querySelector('[aria-selected="true"]') || 
                          document.querySelector('[data-testid="list-item-active"]') ||
                          document.querySelector('div[role="row"]._ak_8');
    
    if (activeSidebar) {
      const sidebarTitle = activeSidebar.querySelector('span[title]') || activeSidebar.querySelector('div[title]');
      if (sidebarTitle && sidebarTitle.getAttribute('title')) return sidebarTitle.getAttribute('title').trim();
    }

    // Probe 4: Aria-label on the entire header
    const ariaHeader = document.querySelector('header [aria-label]');
    if (ariaHeader && ariaHeader.getAttribute('aria-label')) {
       const label = ariaHeader.getAttribute('aria-label').trim()
                                .replace('Chat info', '')
                                .replace('Conversation info', '')
                                .replace('Contact info', '').trim();
       if (label && label.length > 1) return label;
    }

    // Probe 5: Deep-scrape spans in header (last resort)
    const headerSpans = document.querySelectorAll('#main header span');
    for (const span of headerSpans) {
      const txt = span.textContent.trim();
      // Heuristic: Names usually don't have ":" or "/" and aren't numbers
      if (txt.length > 2 && !txt.includes(':') && !txt.includes('/') && !/[\d]/.test(txt)) {
        return txt;
      }
    }

    console.warn('[WAQR] 🔎 getCurrentChatName: No title found after deep-probing.');
    return null;
  }

  function getActiveChatMetadata() {
     console.log('[WAQR] 🔍 Starting GLOBAL JID Hunter (V7.3)...');
     
     // 1. Gather ALL Candidate JIDs from the entire page
     const allElements = document.querySelectorAll('*');
     const candidates = [];
     const viewportWidth = window.innerWidth;
     const viewportHeight = window.innerHeight;

     console.log(`[WAQR] 📊 Scanning ${allElements.length} elements for JIDs...`);

     for (const el of allElements) {
        let rawId = null;
        
        // Scan common attributes
        const did = el.getAttribute('data-id') || '';
        if (did.includes('@c.us') || did.includes('@g.us')) rawId = did;
        
        if (!rawId) {
           // Scan every single attribute as a backup
           for (const attr of el.attributes) {
              if (attr.value.includes('@c.us') || attr.value.includes('@g.us')) {
                 rawId = attr.value;
                 break;
              }
           }
        }

        if (rawId) {
           const rect = el.getBoundingClientRect();
           // Is it visible?
           if (rect.width > 0 && rect.height > 0) {
              const centerX = rect.left + (rect.width / 2);
              const centerY = rect.top + (rect.height / 2);
              
              // Score based on location (Favor Center-Right for Main Chat)
              // Sidebar is usually 0 -> 400px. Main is > 400px.
              let score = 0;
              if (centerX > 400) score += 100; // Big boost for being in main pane
              if (centerX > viewportWidth / 2) score += 50; // Extra boost for being right-aligned
              
              candidates.push({
                 id: rawId,
                 score: score,
                 rect: rect,
                 centerX: centerX
              });
           }
        }
     }

     if (candidates.length === 0) {
        console.error('[WAQR] ❌ JID Hunter found ZERO candidates on the entire page.');
        return { phone: null, chatName: getCurrentChatName(), type: 'none' };
     }

     // 2. Sort by Score (Primary) then Center-X (Secondary)
     candidates.sort((a, b) => b.score - a.score || b.centerX - a.centerX);
     
     console.group(`[WAQR] 🏹 JID Hunter found ${candidates.length} candidates. Top Picks:`);
     candidates.slice(0, 5).forEach((c, i) => console.log(`#${i+1}: Score=${c.score} ID=${c.id}`));
     console.groupEnd();

     const bestPick = candidates[0].id;
     console.log(`[WAQR] 🎯 JID Hunter selected: "${bestPick}"`);
     
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

  function getSidebar() {
    // Probe 1: Standard ID
    let el = document.querySelector('#side');
    if (el) return el;

    // Probe 2: TestID
    el = document.querySelector('[data-testid="side"]');
    if (el) return el;

    return null;
  }



  function logAllTextboxes() {
    // Nuclear Debugging: Log every single textbox on the screen to help the developer identify the name
    const editables = document.querySelectorAll('[contenteditable="true"]');
    console.group(`[WAQR] 📊 DOM Scanner: Found ${editables.length} textboxes.`);
    editables.forEach((el, index) => {
      console.log(`[WAQR] #${index}: id="${el.id}" label="${el.getAttribute('aria-label')}" testid="${el.getAttribute('data-testid')}" parent="${el.parentElement.className}"`);
    });
    console.groupEnd();
  }

  function clickSendButton() {
    const sendBtn = document.querySelector('span[data-testid="send"]')?.closest('button');
    if (sendBtn) sendBtn.click();
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function copyToClipboard(text) {
     // V9.0 - Robust Copy Fallback
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
     } catch (err) {
        console.error('[WAQR] Copy fallback failed:', err);
     }
     
     // Last resort modern API
     navigator.clipboard.writeText(text).then(() => {
        showToast('✅ Message copied to clipboard!');
     }).catch(() => {
        showToast('❌ Copy failed. Please copy manually.');
     });
     return false;
  }

  // --- Message Listeners (V13.0) ---
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
      }
      sendResponse({ success: true });
      return false;
    }
  });

  // Manual Scan Event Listener
  setTimeout(() => {
    const scanBtn = shadow.getElementById('waqr-manual-scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        showToast('Scanning DOM... check console (F12)');
        logAllTextboxes();
      });
    }
  }, 1000);

  console.log('WA QuickReply loaded successfully');
  }

  // Check for email and load extension or show onboarding
  chrome.storage.local.get(['email'], (res) => {
    const email = res && res.email;
    if (!email) {
      // Show beautiful onboarding modal at right-bottom corner
      const hostEl = document.createElement('div');
      hostEl.id = 'waqr-onboarding-host';
      hostEl.setAttribute('style', 'position: fixed; bottom: 24px; right: 24px; z-index: 999999; pointer-events: auto;');
      document.documentElement.appendChild(hostEl);

      const shadow = hostEl.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        
        .onboarding-modal {
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
          padding: 32px;
          max-width: 380px;
          width: 100%;
          animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes slideUp {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        .onboarding-header {
          display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
        }
        
        .onboarding-logo {
          width: 48px; height: 48px; border-radius: 12px;
          background: linear-gradient(135deg, #27a55e 0%, #0f7a52 100%);
          display: flex; align-items: center; justify-content: center;
          font-weight: bold; color: white; font-size: 24px;
        }
        
        .onboarding-title {
          font-size: 18px; font-weight: 700; color: #0f172a;
        }
        
        .onboarding-subtitle {
          font-size: 14px; color: #64748b; margin-bottom: 24px; line-height: 1.5;
        }
        
        .onboarding-input-group { margin-bottom: 20px; }
        
        .onboarding-input {
          width: 100%; padding: 12px 16px; font-size: 14px;
          border: 1.5px solid #e2e8f0; border-radius: 10px;
          background: white; color: #1e293b;
          transition: all 0.2s;
        }
        
        .onboarding-input:focus {
          outline: none; border-color: #27a55e; box-shadow: 0 0 0 3px rgba(39, 165, 94, 0.1);
        }
        
        .onboarding-input::placeholder { color: #94a3b8; }
        
        .onboarding-btn {
          width: 100%; padding: 12px 16px; font-size: 15px; font-weight: 600;
          background: linear-gradient(135deg, #27a55e 0%, #0f7a52 100%);
          color: white; border: none; border-radius: 10px;
          cursor: pointer; transition: all 0.3s;
          box-shadow: 0 4px 12px rgba(39, 165, 94, 0.2);
        }
        
        .onboarding-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(39, 165, 94, 0.3); }
        .onboarding-btn:active { transform: translateY(0); }
        
        .onboarding-error {
          color: #dc2626; font-size: 13px; margin-top: 8px; display: none;
        }
      `;
      shadow.appendChild(styleEl);

      const modal = document.createElement('div');
      modal.className = 'onboarding-modal';
      modal.innerHTML = `
        <div class="onboarding-header">
          <div class="onboarding-logo">✓</div>
          <div>
            <div class="onboarding-title">WA QuickReply</div>
            <div style="font-size: 12px; color: #94a3b8;">Activate to get started</div>
          </div>
        </div>
        
        <div class="onboarding-subtitle">
          Enter your email to unlock templates, AI replies, and Pro features.
        </div>
        
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
        chrome.storage.local.set({ email: val }, () => {
          initializeExtension();
          setTimeout(() => hostEl.remove(), 300);
        });
      });

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btn.click();
        if (error.style.display === 'block') error.style.display = 'none';
      });

      setTimeout(() => input.focus(), 100);
    } else {
      // Email exists, load the full extension
      initializeExtension();
    }
  });
})();
