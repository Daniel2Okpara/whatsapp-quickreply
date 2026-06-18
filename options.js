const SERVER = 'https://wa-quickreply-server.onrender.com';

document.getElementById('save-email').addEventListener('click', async () => {
  console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Entry');
  const email = document.getElementById('email').value.trim();
  console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Email:', email);
  const status = document.getElementById('status');
  if (!email) return status.textContent = 'Enter an email';
  
  status.textContent = 'Sending verification link...';
  
  try {
    const data = await new Promise(resolve => chrome.storage.local.get(['jwtToken'], resolve));
    console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Storage data keys:', Object.keys(data), 'jwtToken:', !!data.jwtToken);
    
    let endpoint = `${SERVER}/auth/resend-verification`;
    let body = { email };
    let headers = { 'Content-Type': 'application/json' };
    
    const token = (data && data.jwtToken) ? String(data.jwtToken).trim() : '';
    console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Token from storage:', !!token, 'length:', token.length);
    if (token) {
      console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Token found - using email-change endpoint');
      endpoint = `${SERVER}/auth/request-email-change`;
      body = { newEmail: email };
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.log('[AUDIT][OPTIONS][SAVE_EMAIL] No token - using resend-verification endpoint');
    }

    console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Calling endpoint:', endpoint);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include'
    });
    console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Response status:', resp.status);
    
    const respData = await resp.json().catch(() => ({}));
    console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Response data:', respData);

    if (resp.ok) {
      if (!data.jwtToken) {
        console.log('[AUDIT][OPTIONS][SAVE_EMAIL] No existing token - starting verification poll');
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
            console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Polling verification-status - attempt:', attempts);
            const statResp = await fetch(`${SERVER}/auth/verification-status?email=${encodeURIComponent(email)}`, { credentials: 'include' });
            console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Poll response status:', statResp.status);
            if (statResp.ok) {
              const statData = await statResp.json();
              console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Poll response data:', statData, 'verified:', statData.verified);
              if (statData.verified) {
                clearInterval(pollInterval);
                status.innerHTML = '<span style="color:#25D366;font-weight:bold;">Email verified! Unlocking extension...</span>';
                console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Storing tokens from verification-status');
                chrome.storage.local.set({ 
                  email: statData.email, 
                  userId: statData._id,
                  jwtToken: statData.accessToken,
                  refreshToken: statData.refreshToken,
                  plan: statData.plan || 'free',
                  isPro: !!statData.isPro
                }, () => {
                  try { console.log('[Options] Stored jwtToken and refreshToken (verification):', !!statData.accessToken, !!statData.refreshToken); } catch(e){}
                  chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED', keys: ['jwtToken', 'refreshToken'] }, () => {
                    if (chrome.runtime.lastError) {
                      console.warn('[Options] STORAGE_UPDATED send failed:', chrome.runtime.lastError.message);
                    }
                  });
                  setTimeout(() => {
                    status.textContent = 'Connected as ' + statData.email + '. Refresh WhatsApp to apply.';
                    document.getElementById('token').value = '';
                  }, 1500);
                });
              }
            }
          } catch (e) {
            console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Poll error:', e.message);
            // ignore network errors during polling
          }
        }, 5000);
      } else {
        console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Existing token found - email-change successful');
         status.textContent = 'Email updated to ' + email + ' successfully!';
         chrome.storage.local.set({ email: email });
         if (respData.accessToken) {
          console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Storing new accessToken from email-change response');
          chrome.storage.local.set({ jwtToken: respData.accessToken }, () => {
            try { console.log('[Options] Stored jwtToken (resend):', !!respData.accessToken); } catch(e){}
            chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED', keys: ['jwtToken'] }, () => {
              if (chrome.runtime.lastError) {
                console.warn('[Options] STORAGE_UPDATED send failed:', chrome.runtime.lastError.message);
              }
            });
          });
         }
      }
    } else {
      console.log('[AUDIT][OPTIONS][SAVE_EMAIL] Request failed');
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
    const resp = await fetch(`${SERVER}/auth/handshake/${encodeURIComponent(token)}`, { credentials: 'include' });
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
        refreshToken: refreshToken,
        plan: plan || 'free',
        isPro: !!isPro
      }, () => {
        try { console.log('[Options] Stored jwtToken and refreshToken (handshake):', !!accessToken, !!refreshToken); } catch(e){}
        chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED', keys: ['jwtToken', 'refreshToken'] }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Options] STORAGE_UPDATED send failed:', chrome.runtime.lastError.message);
          }
        });
        status.textContent = 'Connected as ' + email + '. Refresh WhatsApp to apply.';
      });
    }
  } catch (err) {
    status.textContent = 'Connect failed: ' + (err.message || 'error');
  }
});

document.getElementById('delete-account').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
    return;
  }
  
  const status = document.getElementById('status');
  status.textContent = 'Deleting account...';
  
  try {
    const data = await new Promise(resolve => chrome.storage.local.get(['jwtToken'], resolve));
    const token = data.jwtToken;
    
    if (!token) {
      status.textContent = 'You must be logged in to delete your account.';
      return;
    }
    
    const resp = await fetch(`${SERVER}/auth/delete-account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });
    
    const respData = await resp.json().catch(() => ({}));
    
    if (resp.ok) {
      // Clear all storage
      chrome.storage.local.clear(() => {
        status.textContent = 'Account deleted successfully.';
        setTimeout(() => {
          status.textContent = 'Extension disconnected. You may now uninstall it.';
        }, 2000);
      });
    } else {
      status.textContent = 'Error: ' + (respData.error || 'Failed to delete account');
    }
  } catch (err) {
    status.textContent = 'Network error: ' + err.message;
  }
});
