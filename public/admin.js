async function apiFetch(path, opts = {}) {
  const secret = document.getElementById('admin-secret').value.trim();
  if (!secret) throw new Error('admin secret required');
  const headers = Object.assign({ 'x-admin-secret': secret, 'Content-Type': 'application/json' }, opts.headers || {});
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

function renderUsers(users) {
  const wrap = document.getElementById('users-wrap');
  if (!users || users.length === 0) {
    wrap.innerHTML = '<p>No users found.</p>';
    return;
  }
  const rows = users.map(u => `
    <tr>
      <td>${u.email || ''}</td>
      <td>${u.plan || u.subscription?.tier || 'free'}</td>
      <td>${u.subscriptionStatus || u.subscription?.status || ''}</td>
      <td>${new Date(u.createdAt || u._id?.getTimestamp?.() || Date.now()).toLocaleString()}</td>
      <td>
        <button class="view" data-email="${u.email}">View</button>
        <button class="cancel" data-email="${u.email}">Cancel</button>
      </td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Email</th><th>Plan</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
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
}

document.getElementById('load-users').addEventListener('click', async () => {
  try {
    renderStatus('Loading users...', false);
    const data = await apiFetch('/admin/users');
    renderUsers(data.users || []);
    renderStatus('Loaded ' + (data.users?.length || 0) + ' users', false);
  } catch (err) {
    renderStatus(err.message || 'Failed to load users', true);
  }
});
