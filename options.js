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
      endpoint = `${SERVER}/auth/request-email-change`;
      body = { newEmail: email };
      headers['Authorization'] = `Bearer ${data.jwtToken}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    const respData = await resp.json().catch(() => ({}));

    if (resp.ok) {
      if (!data.jwtToken) {
        status.textContent = 'Verification email sent to ' + email + '. Check your inbox. Waiting for verification...';
        
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          if (attempts > 60) { // 5 minutes max
            clearInterval(pollInterval);
            status.textContent = 'Verification timed out. Please try again.';
            return;
          }
          try {
            const statResp = await fetch(`${SERVER}/auth/verification-status?email=${encodeURIComponent(email)}`);
            if (statResp.ok) {
              const statData = await statResp.json();
              if (statData.verified) {
                clearInterval(pollInterval);
                status.innerHTML = '<span style="color:#25D366;font-weight:bold;">Email verified! Unlocking extension...</span>';
                
                chrome.storage.local.set({ 
                  email: statData.email, 
                  userId: statData._id,
                  jwtToken: statData.accessToken,
                  plan: statData.plan || 'free',
                  isPro: !!statData.isPro
                }, () => {
                  setTimeout(() => {
                    status.textContent = 'Connected as ' + statData.email + '. Refresh WhatsApp to apply.';
                    document.getElementById('token').value = '';
                  }, 1500);
                });
              }
            }
          } catch (e) {
            // ignore network errors during polling
          }
        }, 5000);
      } else {
         status.textContent = 'Email updated to ' + email + ' successfully!';
         chrome.storage.local.set({ email: email });
         if (respData.accessToken) {
            chrome.storage.local.set({ jwtToken: respData.accessToken });
         }
      }
    } else {
      status.textContent = 'Error: ' + (respData.error || 'Failed to send email');
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
