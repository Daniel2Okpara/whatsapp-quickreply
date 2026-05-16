const SERVER = 'https://wa-quickreply-server.onrender.com';

document.getElementById('save-email').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const status = document.getElementById('status');
  if (!email) return status.textContent = 'Enter an email';
  
  status.textContent = 'Sending verification link...';
  
  try {
    const data = await new Promise(resolve => chrome.storage.local.get(['jwtToken'], resolve));
    
    let endpoint = `${SERVER}/auth/resend-verification`;
    let body = { email };
    let headers = { 'Content-Type': 'application/json' };
    
    if (data.jwtToken) {
      // User is already logged in, so this is an email change request
      endpoint = `${SERVER}/auth/request-email-change`;
      body = { newEmail: email };
      headers['Authorization'] = `Bearer ${data.jwtToken}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    if (resp.ok) {
      status.textContent = 'Verification email sent to ' + email + '. Please verify then click Connect.';
    } else {
      const data = await resp.json().catch(() => ({}));
      status.textContent = 'Error: ' + (data.error || 'Failed to send email');
    }
  } catch (err) {
    status.textContent = 'Network error: ' + err.message;
  }
});

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
