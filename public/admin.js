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
    window.__ADMIN_USERS = data.users || [];
    renderUsers(window.__ADMIN_USERS.slice(0, 20));
    renderStatus('Loaded ' + (data.users?.length || 0) + ' users', false);
  } catch (err) {
    renderStatus(err.message || 'Failed to load users', true);
  }
});

// Search handling
document.getElementById('search').addEventListener('input', (e) => {
  const q = (e.target.value || '').toLowerCase().trim();
  const all = window.__ADMIN_USERS || [];
  const filtered = all.filter(u => (u.email || '').toLowerCase().includes(q) || (u.plan || '').toLowerCase().includes(q) || (u.subscriptionStatus || '').toLowerCase().includes(q));
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
  const rows = [ ['email','plan','subscriptionStatus','subscriptionId','createdAt'] ];
  list.forEach(u => rows.push([u.email||'', u.plan||'', u.subscriptionStatus||'', u.subscriptionId||'', u.createdAt||'']));
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

