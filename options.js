document.getElementById('connect').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const status = document.getElementById('status');
  if (!token) return status.textContent = 'Enter a token';
  status.textContent = 'Connecting...';
  try {
    const SERVER = 'https://wa-quickreply-server.onrender.com';
    const resp = await fetch(`${SERVER}/auth/handshake/${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error('Invalid token');
    const data = await resp.json();
    const email = data.email;
    if (email) {
      // store email in extension (via chrome.storage)
      chrome.storage.local.set({ userEmail: email }, () => {
        status.textContent = 'Connected as ' + email + '. Refresh WhatsApp to apply.';
      });
      // attempt to fetch user-status and persist subscription
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
