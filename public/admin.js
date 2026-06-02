async function apiFetch(path, opts = {}) {
  const token = document.getElementById('admin-secret').value.trim();
  if (!token) throw new Error('JWT token required');
  const headers = Object.assign({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await fetch(path, Object.assign({ headers }, opts));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `request failed: ${res.status}`);
  }
  return res.json();
}

function renderStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.style.color = isError ? '#b91c1c' : '#0f5132';
}

function getJWTPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch (e) {
    return null;
  }
}

let eventSource = null;
function setupRealtimeEvents(token) {
  if (eventSource) {
    eventSource.close();
  }
  
  eventSource = new EventSource(`/admin-events?token=${encodeURIComponent(token)}`);
  
  eventSource.onopen = () => {
    console.log('[SSE]: Admin real-time sync connected.');
  };
  
  eventSource.onerror = (e) => {
    console.error('[SSE]: Connection error', e);
  };
  
  eventSource.addEventListener('new_user', (e) => {
    try {
      const u = JSON.parse(e.data);
      console.log('[SSE]: New user registered:', u);
      if (!window.__ADMIN_USERS) window.__ADMIN_USERS = [];
      if (!window.__ADMIN_USERS.some(x => x.email === u.email)) {
        window.__ADMIN_USERS.unshift(u);
        
        // Update metrics
        const totalEl = document.getElementById('metric-total-users');
        if (totalEl) totalEl.textContent = parseInt(totalEl.textContent, 10) + 1;
        
        renderPage(1);
      }
    } catch (err) {
      console.error(err);
    }
  });

  eventSource.addEventListener('plan_change', (e) => {
    try {
      const data = JSON.parse(e.data);
      console.log('[SSE]: Plan change:', data);
      if (!window.__ADMIN_USERS) return;
      const user = window.__ADMIN_USERS.find(x => x.email === data.email);
      if (user) {
        user.plan = data.plan;
        user.subscriptionStatus = data.subscriptionStatus;
        user.subscriptionId = data.subscriptionId;
        renderPage(1);
      }
    } catch (err) {
      console.error(err);
    }
  });

  eventSource.addEventListener('admin_approval', (e) => {
    try {
      const data = JSON.parse(e.data);
      console.log('[SSE]: Admin approval event:', data);
      loadPendingRequests();
      // Fetch users list quietly
      apiFetch('/admin/users').then(data => {
        window.__ADMIN_USERS = data.users || [];
        renderPage(1);
      }).catch(() => {});
    } catch (err) {
      console.error(err);
    }
  });
}

async function loadPendingRequests() {
  const requestsWrap = document.getElementById('requests-wrap');
  if (!requestsWrap) return;
  
  try {
    const data = await apiFetch('/admin/pending-requests');
    const requests = data.requests || [];
    
    if (requests.length === 0) {
      requestsWrap.innerHTML = '<p>No pending admin requests.</p>';
      requestsWrap.style.display = 'block';
      return;
    }
    
    const rows = requests.map(r => `
      <tr>
        <td>${r.email || ''}</td>
        <td>${r.role || 'user'}</td>
        <td>${r.adminRequestedAt ? new Date(r.adminRequestedAt).toLocaleString() : ''}</td>
        <td>
          <button class="approve-btn action-btn" data-id="${r._id}" style="background-color: #10b981; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px; margin-right: 4px;">Approve</button>
          <button class="reject-btn action-btn" data-id="${r._id}" style="background-color: #ef4444; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px;">Reject</button>
        </td>
      </tr>
    `).join('');
    
    requestsWrap.innerHTML = `
      <h2 style="margin-top: 20px;">Pending Admin Requests</h2>
      <table>
        <thead><tr><th>Email</th><th>Current Role</th><th>Requested At</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    requestsWrap.style.display = 'block';
    
    // Wire up buttons
    requestsWrap.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.id;
        try {
          renderStatus('Approving request...', false);
          await apiFetch('/admin/approve-request', {
            method: 'POST',
            body: JSON.stringify({ userId })
          });
          renderStatus('Request approved successfully!', false);
          loadPendingRequests();
          document.getElementById('load-users').click();
        } catch (err) {
          renderStatus(err.message || 'Approval failed', true);
        }
      });
    });
    
    requestsWrap.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.id;
        try {
          renderStatus('Rejecting request...', false);
          await apiFetch('/admin/reject-request', {
            method: 'POST',
            body: JSON.stringify({ userId })
          });
          renderStatus('Request rejected successfully!', false);
          loadPendingRequests();
        } catch (err) {
          renderStatus(err.message || 'Rejection failed', true);
        }
      });
    });
  } catch (err) {
    requestsWrap.style.display = 'none';
  }
}

function renderUsers(users) {
  const wrap = document.getElementById('users-wrap');
  if (!users || users.length === 0) {
    wrap.innerHTML = '<p>No users found.</p>';
    return;
  }

  const token = document.getElementById('admin-secret').value.trim();
  const payload = getJWTPayload(token);
  const isSuperAdmin = payload && payload.role === 'super_admin';

  const rows = users.map(u => {
    let actionButtons = `
      <button class="view" data-email="${u.email}">View</button>
      <button class="cancel" data-email="${u.email}">Cancel</button>
    `;
    
    if (isSuperAdmin && u._id !== payload.id) {
      if (u.role === 'admin') {
        actionButtons += `
          <button class="promote" data-id="${u._id}" style="background-color: #6366f1; color: white;">Make Super Admin</button>
          <button class="demote" data-id="${u._id}" style="background-color: #f59e0b; color: white;">Demote</button>
        `;
      } else if (u.role === 'user') {
        actionButtons += `
          <button class="approve-btn-row" data-id="${u._id}" style="background-color: #10b981; color: white;">Approve Admin</button>
        `;
      }
      actionButtons += `
        <button class="delete-user" data-id="${u._id}" style="background-color: #dc2626; color: white;">Delete</button>
      `;
    }

    return `
      <tr>
        <td>${u.email || ''}</td>
        <td>${u.plan || 'free'}</td>
        <td>${u.role || 'user'}</td>
        <td>${u.adminStatus || 'none'}</td>
        <td>${new Date(u.createdAt || Date.now()).toLocaleString()}</td>
        <td><div style="display: flex; gap: 4px; flex-wrap: wrap;">${actionButtons}</div></td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Email</th><th>Plan</th><th>Role</th><th>Admin Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  wrap.querySelectorAll('button.view').forEach(b => b.addEventListener('click', async (ev) => {
    const email = ev.currentTarget.dataset.email;
    try {
      renderStatus('Loading user...', false);
      const data = await apiFetch(`/admin/user/${encodeURIComponent(email)}`);
      renderStatus('Loaded user: ' + data.user.email, false);
      alert(JSON.stringify(data.user, null, 2));
    } catch (err) {
      renderStatus(err.message || 'Failed to load user', true);
    }
  }));

  wrap.querySelectorAll('button.cancel').forEach(b => b.addEventListener('click', async (ev) => {
    const email = ev.currentTarget.dataset.email;
    if (!confirm('Cancel subscription for ' + email + '?')) return;
    try {
      renderStatus('Cancelling...', false);
      const data = await apiFetch('/admin/cancel-subscription', { method: 'POST', body: JSON.stringify({ email }) });
      renderStatus('Cancelled: ' + (data.message || 'ok'), false);
      document.getElementById('load-users').click();
    } catch (err) {
      renderStatus(err.message || 'Cancel failed', true);
    }
  }));

  wrap.querySelectorAll('button.promote').forEach(b => b.addEventListener('click', async (ev) => {
    const userId = ev.currentTarget.dataset.id;
    if (!confirm('Promote this user to Super Admin?')) return;
    try {
      renderStatus('Promoting...', false);
      await apiFetch('/admin/promote-super-admin', { method: 'POST', body: JSON.stringify({ userId }) });
      renderStatus('Promoted successfully!', false);
      document.getElementById('load-users').click();
    } catch (err) {
      renderStatus(err.message || 'Promotion failed', true);
    }
  }));

  wrap.querySelectorAll('button.demote').forEach(b => b.addEventListener('click', async (ev) => {
    const userId = ev.currentTarget.dataset.id;
    if (!confirm('Demote this admin back to a regular user?')) return;
    try {
      renderStatus('Demoting...', false);
      await apiFetch('/admin/demote-admin', { method: 'POST', body: JSON.stringify({ userId }) });
      renderStatus('Demoted successfully!', false);
      document.getElementById('load-users').click();
    } catch (err) {
      renderStatus(err.message || 'Demotion failed', true);
    }
  }));

  wrap.querySelectorAll('button.approve-btn-row').forEach(b => b.addEventListener('click', async (ev) => {
    const userId = ev.currentTarget.dataset.id;
    try {
      renderStatus('Approving...', false);
      await apiFetch('/admin/approve-request', { method: 'POST', body: JSON.stringify({ userId }) });
      renderStatus('Approved successfully!', false);
      document.getElementById('load-users').click();
    } catch (err) {
      renderStatus(err.message || 'Approval failed', true);
    }
  }));

  wrap.querySelectorAll('button.delete-user').forEach(b => b.addEventListener('click', async (ev) => {
    const userId = ev.currentTarget.dataset.id;
    if (!confirm('Are you absolutely sure you want to permanently delete this user? This action cannot be undone!')) return;
    try {
      renderStatus('Deleting...', false);
      await apiFetch('/admin/delete-user', { method: 'POST', body: JSON.stringify({ userId }) });
      renderStatus('User deleted successfully!', false);
      document.getElementById('load-users').click();
    } catch (err) {
      renderStatus(err.message || 'Delete failed', true);
    }
  }));
}

document.getElementById('load-users').addEventListener('click', async () => {
  const token = document.getElementById('admin-secret').value.trim();
  if (!token) {
    renderStatus('JWT token required', true);
    return;
  }
  
  try {
    renderStatus('Loading users...', false);
    
    // Connect to real-time events if not already done
    setupRealtimeEvents(token);
    
    // Load pending approval requests
    loadPendingRequests();

    const data = await apiFetch('/admin/users');
    window.__ADMIN_USERS = data.users || [];
    
    // Calculate Metrics
    let verifiedCount = 0;
    let proCount = 0;
    let trialCount = 0;
    let freeCount = 0;
    let totalAi = 0;
    let growth = 0;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    window.__ADMIN_USERS.forEach(u => {
      if (u.verified) verifiedCount++;
      if (u.plan === 'pro') proCount++;
      else if (u.plan === 'trial') trialCount++;
      else freeCount++;
      
      totalAi += (u.creditsUsed || 0);
      
      const createdTime = new Date(u.createdAt).getTime();
      if (now - createdTime < oneDay) {
        growth++;
      }
    });

    // Update DOM
    document.getElementById('metric-total-users').textContent = window.__ADMIN_USERS.length;
    document.getElementById('metric-verified-users').textContent = verifiedCount;
    document.getElementById('metric-pro-users').textContent = proCount;
    document.getElementById('metric-trial-users').textContent = trialCount;
    document.getElementById('metric-free-users').textContent = freeCount;
    document.getElementById('metric-total-ai').textContent = totalAi;
    document.getElementById('metric-growth').textContent = '+' + growth;

    renderPage(1);
    renderStatus('Loaded ' + (data.users?.length || 0) + ' users', false);
  } catch (err) {
    renderStatus(err.message || 'Failed to load users', true);
  }
});

// Search handling
document.getElementById('search').addEventListener('input', (e) => {
  const q = (e.target.value || '').toLowerCase().trim();
  const all = window.__ADMIN_USERS || [];
  const filtered = all.filter(u => 
    (u.email || '').toLowerCase().includes(q) || 
    (u.plan || '').toLowerCase().includes(q) || 
    (u.role || '').toLowerCase().includes(q) ||
    (u.adminStatus || '').toLowerCase().includes(q)
  );
  window.__ADMIN_FILTERED = filtered;
  renderPage(1);
});

// Pagination + render helpers
function renderPage(page = 1, perPage = 20) {
  const list = (window.__ADMIN_FILTERED || window.__ADMIN_USERS || []);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage;
  const slice = list.slice(start, start + perPage);
  renderUsers(slice);
  renderPagination(page, pages);
}

function renderPagination(active, pages) {
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class='page-btn' data-page='${i}' ${i===active?"style='font-weight:700'":""}>${i}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('button.page-btn').forEach(b => b.addEventListener('click', (ev) => {
    const p = parseInt(ev.currentTarget.dataset.page, 10);
    renderPage(p);
  }));
}

// Export CSV
document.getElementById('export-csv').addEventListener('click', () => {
  const list = (window.__ADMIN_FILTERED || window.__ADMIN_USERS || []);
  if (!list || list.length === 0) return alert('No users to export');
  const rows = [ ['email','plan','role','adminStatus','subscriptionStatus','subscriptionId','createdAt'] ];
  list.forEach(u => rows.push([u.email||'', u.plan||'', u.role||'', u.adminStatus||'', u.subscriptionStatus||'', u.subscriptionId||'', u.createdAt||'']));
  const csv = rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'waqr-users.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
