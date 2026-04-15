const SERVER = 'https://wa-quickreply-server.onrender.com';

document.getElementById('save-email').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const email = (document.getElementById('email').value || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = 'Enter a valid email';
    return;
  }
  status.textContent = 'Saving...';
  chrome.storage.local.set({ email }, async () => {
    status.textContent = 'Saved as ' + email + '. Refresh WhatsApp to apply.';
    try {
      const sresp = await fetch(`${SERVER}/user-status?email=${encodeURIComponent(email)}`);
      if (sresp.ok) {
        const sdata = await sresp.json();
        chrome.storage.local.set({ subscription: sdata.subscription || { tier: sdata.plan || 'free', status: sdata.status || '' } });
      }
    } catch (e) {}
  });
});

document.getElementById('connect').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const status = document.getElementById('status');
  if (!token) return status.textContent = 'Enter a token';
  status.textContent = 'Connecting...';
  try {
    const resp = await fetch(`${SERVER}/auth/handshake/${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error('Invalid token');
    const data = await resp.json();
    const email = data.email;
    if (email) {
      // store email in extension
      chrome.storage.local.set({ email }, () => {
        status.textContent = 'Connected as ' + email + '. Refresh WhatsApp to apply.';
      });
      try {
        const sresp = await fetch(`${SERVER}/user-status?email=${encodeURIComponent(email)}`);
        if (sresp.ok) {
          const sdata = await sresp.json();
          chrome.storage.local.set({ subscription: sdata.subscription || { tier: sdata.plan || 'free', status: sdata.status || '' } });
        }
      } catch (e) {}
    }
  } catch (err) {
    status.textContent = 'Connect failed: ' + (err.message || 'error');
  }
});
