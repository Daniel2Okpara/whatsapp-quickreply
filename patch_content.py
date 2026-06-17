import re

with open('content.js', 'r', encoding='utf-8') as f:
    code = f.read()

# We want to replace everything from `storageGet(['email'], (res) => {` at the BOTTOM of the file.
# The `initializeExtension` function is right before it.

search_str = "storageGet(['email'], (res) => {"
split_idx = code.rfind(search_str)  # find the LAST occurrence
if split_idx == -1:
    print("Could not find storageGet section")
    exit(1)

head = code[:split_idx]

tail = """storageGet(['email', 'verified'], (res) => {
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
      const BACKEND_URL = 'https://wa-quickreply-server.onrender.com';

      sendButton.addEventListener('click', async () => {
        const emailValue = (emailInput.value || '').trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailValue)) return updateStatus('Please enter a valid email address.', true);

        sendButton.disabled = true; sendButton.textContent = 'Sending...'; updateStatus('');
        try {
          const resp = await fetch(`${BACKEND_URL}/auth/resend-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailValue }) });
          const result = await resp.json().catch(() => ({}));
          if (!resp.ok) { updateStatus(result.error || 'Unable to send verification link.', true); sendButton.disabled = false; sendButton.textContent = 'Verify Email'; return; }

          storageSet({ email: emailValue, verified: false }, () => {
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
              storageSet({ verified: true }, () => {
                setTimeout(() => { hostEl.remove(); initializeExtension(); }, 900);
              });
            }, (message) => { newStatusEl.textContent = message; });
          });
        } catch (err) {
          updateStatus('Network error. Please try again.', true); sendButton.disabled = false; sendButton.textContent = 'Verify Email';
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
    } else {
      initializeExtension();
    }
  });
})();
"""

with open('content.js', 'w', encoding='utf-8') as f:
    f.write(head + tail)
print("Patched content.js successfully")
