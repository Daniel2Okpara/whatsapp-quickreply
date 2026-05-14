const SERVER = 'https://wa-quickreply-server.onrender.com';

document.getElementById('connect').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const status = document.getElementById('status');
  if (!token) return status.textContent = 'Enter a token';
  
  status.textContent = 'Connecting...';
  
  try {
    const resp = await fetch(`${SERVER}/auth/handshake/${encodeURIComponent(token)}`);
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || 'Invalid token');
    }
    
    const data = await resp.json();
    const { email, _id, accessToken, refreshToken, plan, isPro } = data;
    
    if (email && accessToken) {
      // Store full auth profile
      chrome.storage.local.set({ 
        email, 
        userId: _id,
        jwtToken: accessToken,
        plan: plan || 'free',
        isPro: !!isPro
      }, () => {
        status.textContent = 'Connected as ' + email + '. Refresh WhatsApp to apply.';
      });
    }
  } catch (err) {
    status.textContent = 'Connect failed: ' + (err.message || 'error');
  }
});
