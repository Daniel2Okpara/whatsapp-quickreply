// ============================================================================
// 1. CONFIGURATION & STATE
// ============================================================================

const CONFIG = {
  API_URL: 'https://wa-quickreply-server.onrender.com', 
};

let authToken = localStorage.getItem('admin_token') || '';
let currentUser = JSON.parse(localStorage.getItem('admin_user') || '{}');

// Helper: is the logged-in user a superadmin?
function isSuperAdmin() {
  return currentUser && currentUser.role === 'super_admin';
}
let currentPageView = 'dashboard';
let allUsers = [];
let allLogs = [];
let searchQuery = '';
let currentTheme = localStorage.getItem('theme') || 'dark';
let notifications = [];

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

function logout() {
  authToken = '';
  currentUser = {};
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  showAuthPage();
}

// ============================================================================
// 2. AUTHENTICATION & CORE UI
// ============================================================================

function showAuthPage() {
  const container = document.querySelector('.admin-container');
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="margin: 0 auto 16px; width: 80px; height: 80px; border-radius: 50%; overflow: hidden; background: #10b981; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(16, 185, 129, 0.2);"><img src="logo.png" style="width: 100%; height: 100%; object-fit: contain;"></div>
          <h1 style="font-family: 'Outfit'; font-size: 32px; margin-bottom: 8px; color: #1e293b; letter-spacing: -1px;">WA QuickReply</h1>
          <p style="color: #64748b; font-size: 15px; font-weight: 500;">Project Management Portal</p>
        </div>

        <div id="auth-tabs" style="display: flex; gap: 8px; background: #f1f5f9; padding: 6px; border-radius: 12px; margin-bottom: 32px; border: 1px solid #e2e8f0;">
          <button class="auth-tab active" data-tab="login">Sign In</button>
          <button class="auth-tab" data-tab="signup">Request Admin Access</button>
        </div>

        <form id="login-form">
          <div style="margin-bottom: 24px;">
            <label class="form-label">Email Address</label>
            <input type="email" id="email" required placeholder="admin@example.com" class="form-input">
          </div>
          <div style="margin-bottom: 32px;">
            <label class="form-label">Password</label>
            <input type="password" id="password" required placeholder="••••••••" class="form-input">
          </div>
          <button type="submit" id="login-btn" class="btn-primary" style="width: 100%;">Access Dashboard</button>
        </form>

        <form id="signup-form" style="display: none;">
          <div style="margin-bottom: 16px;">
            <label class="form-label">Email Address</label>
            <input type="email" id="reg-email" required placeholder="admin@example.com" class="form-input">
          </div>
          <div style="margin-bottom: 16px;">
            <label class="form-label">Password</label>
            <input type="password" id="reg-password" required placeholder="••••••••" class="form-input">
          </div>
          <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; margin-bottom:16px;">
            <p style="font-size:12px; color:#92400e; margin:0;">⚠️ After registering, your request will be reviewed by the superadmin. You'll be notified once approved.</p>
          </div>
          <button type="submit" id="signup-btn" class="btn-primary" style="width: 100%;">Request Admin Access</button>
        </form>

        <p id="auth-error" class="error-box" style="display: none;"></p>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const errorEl = document.getElementById('auth-error');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const isLogin = tab.dataset.tab === 'login';
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      loginForm.style.display = isLogin ? 'block' : 'none';
      signupForm.style.display = isLogin ? 'none' : 'block';
      errorEl.style.display = 'none';
    });
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    try {
      btn.textContent = 'Verifying...'; btn.disabled = true;
      const res = await fetch(`${CONFIG.API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');
      authToken = data.accessToken || data.token;
      currentUser = { email: data.email, isAdmin: data.isAdmin, role: data.role || 'user', adminStatus: data.adminStatus || 'none' };
      localStorage.setItem('admin_token', authToken);
      localStorage.setItem('admin_user', JSON.stringify(currentUser));
      // If not admin yet, show pending/request screen
      if (!data.isAdmin) {
        showPendingApprovalScreen();
      } else {
        initDashboard();
      }
    } catch (err) {
      if (err.message.includes('not verified') || err.message.includes('verification')) {
        errorEl.innerHTML = `Please check your email to verify your account before logging in. <br><a href="#" style="color:#10b981; font-size:12px;" onclick="alert('Resend feature coming soon')">Resend link?</a>`;
      } else {
        errorEl.textContent = err.message;
      }
      errorEl.style.display = 'block';
      btn.textContent = 'Access Dashboard'; btn.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signup-btn');
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    try {
      btn.textContent = 'Submitting Request...'; btn.disabled = true;
      
      // Step 1: Register
      const res = await fetch(`${CONFIG.API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Registration failed');

      // Show request submitted confirmation
      signupForm.innerHTML = `
        <div style="text-align:center; padding:20px;">
          <div style="font-size:48px; margin-bottom:16px;">⏳</div>
          <h3 style="color:#0f172a; margin-bottom:8px; font-family:'Outfit';">Request Submitted!</h3>
          <p style="color:#64748b; font-size:14px; margin-bottom:8px;">Account created for <b>${email}</b>.</p>
          <p style="color:#64748b; font-size:13px; margin-bottom:16px;">Please verify your email first, then the superadmin will review and approve your admin access.</p>
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px; margin-bottom:20px; text-align:left;">
            <p style="font-size:12px; color:#166534; margin:0;">📬 Check your inbox for a verification email. Once verified, sign in — your admin request will be automatically submitted for review.</p>
          </div>
          <button onclick="location.reload()" class="btn-primary" style="width:100%;">Return to Sign In</button>
        </div>
      `;
    } catch (err) {
      errorEl.textContent = err.message; errorEl.style.display = 'block';
      btn.textContent = 'Request Admin Access'; btn.disabled = false;
    }
  });
}

// Show pending approval screen for non-admin logged-in users
async function showPendingApprovalScreen() {
  const container = document.querySelector('.admin-container');

  // Auto-submit admin request if not already pending/rejected
  if (currentUser.adminStatus === 'none' || !currentUser.adminStatus) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = authToken ? String(authToken).trim() : '';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${CONFIG.API_URL}/admin/request-access`, {
        method: 'POST',
        headers
      });
      currentUser.adminStatus = 'pending';
      localStorage.setItem('admin_user', JSON.stringify(currentUser));
    } catch(e) {}
  }

  const statusMsg = currentUser.adminStatus === 'rejected'
    ? { icon: '❌', title: 'Request Declined', msg: 'Your admin request was declined. Contact the superadmin for more information.', color: '#ef4444', bg: '#fef2f2', border: '#fecaca' }
    : { icon: '⏳', title: 'Pending Approval', msg: 'Your admin access request has been submitted. The superadmin will review it shortly.', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };

  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="margin: 0 auto 16px; width: 80px; height: 80px; border-radius: 50%; overflow: hidden; background: #10b981; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(16, 185, 129, 0.2);">
            <img src="logo.png" style="width: 100%; height: 100%; object-fit: contain;">
          </div>
          <h1 style="font-family: 'Outfit'; font-size: 28px; margin-bottom: 8px; color: #1e293b; letter-spacing: -1px;">WA QuickReply</h1>
        </div>
        <div style="font-size: 56px; text-align: center; margin-bottom: 16px;">${statusMsg.icon}</div>
        <h2 style="text-align:center; font-family:'Outfit'; font-size:22px; color:#0f172a; margin-bottom:12px;">${statusMsg.title}</h2>
        <div style="background:${statusMsg.bg}; border:1px solid ${statusMsg.border}; border-radius:12px; padding:16px; margin-bottom:24px;">
          <p style="font-size:14px; color:${statusMsg.color}; text-align:center; margin:0;">${statusMsg.msg}</p>
        </div>
        <p style="font-size:12px; color:#94a3b8; text-align:center; margin-bottom:20px;">Signed in as <b>${currentUser.email}</b></p>
        <button onclick="logout()" class="btn-primary" style="width:100%; background:#64748b;">Sign Out</button>
      </div>
    </div>
  `;
}

async function initDashboard() {
  document.documentElement.className = `theme-${currentTheme}`;
  const container = document.querySelector('.admin-container');
  const userInitials = (currentUser.email || 'WA').substring(0, 2).toUpperCase();
  
  container.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div style="width: 40px; height: 40px; min-width: 40px;"><img src="logo.png" style="width: 100%; height: 100%; object-fit: contain;"></div>
        <div class="logo-text">WA QuickReply</div>
      </div>
      
      <div class="sidebar-section">
        <p class="section-label">General Monitoring</p>
        <a href="#" class="nav-item ${currentPageView === 'dashboard' ? 'active' : ''}" data-view="dashboard"><i data-lucide="layout-dashboard"></i> Live Dashboard</a>
        <a href="#" class="nav-item ${currentPageView === 'users' ? 'active' : ''}" data-view="users"><i data-lucide="users"></i> User Management</a>
        <a href="#" class="nav-item ${currentPageView === 'installs' ? 'active' : ''}" data-view="installs"><i data-lucide="download"></i> Install Tracking</a>
        <a href="#" class="nav-item ${currentPageView === 'subscriptions' ? 'active' : ''}" data-view="subscriptions"><i data-lucide="credit-card"></i> Subscriptions</a>
        <a href="#" class="nav-item ${currentPageView === 'logs' ? 'active' : ''}" data-view="logs"><i data-lucide="scroll-text"></i> Webhook Logs</a>
      </div>

      ${isSuperAdmin() ? `
      <div class="sidebar-section">
        <p class="section-label">Super Admin</p>
        <a href="#" class="nav-item ${currentPageView === 'adminManagement' ? 'active' : ''}" data-view="adminManagement" style="position:relative;">
          <i data-lucide="shield-check"></i> Admin Management
          ${(window._pendingAdminCount > 0) ? `<span style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:#ef4444; color:white; font-size:10px; font-weight:800; border-radius:999px; padding:2px 7px;">${window._pendingAdminCount}</span>` : ''}
        </a>
      </div>` : ''}

      <div class="sidebar-section">
        <p class="section-label">Settings</p>
        <a href="#" class="nav-item ${currentPageView === 'settings' ? 'active' : ''}" data-view="settings"><i data-lucide="settings"></i> Control Panel</a>
        <a href="#" class="nav-item" id="refresh-btn"><i data-lucide="refresh-cw"></i> <span id="refresh-text">Sync Data</span></a>
      </div>

      <div class="sidebar-footer">
        <p style="font-size: 10px; color: #64748b; margin-bottom: 12px; padding: 0 16px;">V.1.0.5-STABLE</p>
        <a href="#" class="nav-item" id="logout-btn" style="color: #ef4444;"><i data-lucide="log-out"></i> Sign Out</a>
      </div>
    </aside>

    <div class="main-layout">
      <header class="top-header">
        <div class="search-bar">
          <i data-lucide="search"></i>
          <input type="text" id="global-search" placeholder="Search by email or ID..." value="${searchQuery}">
        </div>
        <div class="header-right">
          <div class="theme-switch">
            <div class="theme-btn ${currentTheme === 'light' ? 'active' : ''}" data-theme="light"><i data-lucide="sun"></i></div>
            <div class="theme-btn ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark"><i data-lucide="moon"></i></div>
          </div>
          <div class="header-icon" id="notif-btn" style="position: relative;">
            <i data-lucide="bell"></i>
            ${notifications.length > 0 ? '<span class="notif-badge"></span>' : ''}
          </div>
          <div class="profile-avatar" id="profile-btn">${userInitials}</div>
        </div>
      </header>

      <div class="content-body" id="app-view">
        <div class="page-loading">
           <div class="spinner"></div>
           <p>Updating Real-time Data...</p>
        </div>
      </div>
    </div>
    <div id="action-dropdown" class="dropdown-menu"></div>
    <div id="notif-panel" class="notif-panel"></div>
  `;

  if (window.lucide) lucide.createIcons();
  setupEventListeners();
  loadDataAndRender();

  // Start "Tram Time" Sync (Real-time updates every 15s)
  if (window.adminSyncInterval) clearInterval(window.adminSyncInterval);
  window.adminSyncInterval = setInterval(() => {
    loadDataAndRender(true); // silent refresh
  }, 15000);
}

// ============================================================================
// 3. API & DATA MANAGEMENT
// ============================================================================

async function apiCall(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = authToken ? String(authToken).trim() : '';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${CONFIG.API_URL}${path}`, { ...options, headers });
  if (res.status === 401) { logout(); return; }
  if (res.status === 403) throw new Error('Forbidden: Admin Role Required.');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.details ? `${data.error}: ${data.details}` : (data.error || `API Error: ${res.status}`);
    throw new Error(msg);
  }
  return res.json();
}

let feedbackData = { stats: { up: 0, down: 0 }, recentFeedback: [] };
let pendingAdminRequests = [];
let approvedAdmins = [];
let installStats = { totalInstalls: 0, registeredInstalls: 0, unregisteredInstalls: 0, installsByDate: [] };
let allInstalls = [];

async function loadDataAndRender(silent = false) {
  const viewContainer = document.getElementById('app-view');
  try {
    const calls = [
      apiCall('/admin/users'),
      apiCall('/admin/webhook-logs?limit=50'),
      apiCall('/admin/feedback-stats'),
      apiCall('/admin/install-stats'),
      apiCall('/admin/installs?limit=100')
    ];

    // Only superadmin can fetch pending requests
    if (isSuperAdmin()) {
      calls.push(apiCall('/admin/pending-requests'));
    }

    const results = await Promise.all(calls);
    const [userRes, logRes, feedbackRes, installRes, installListRes] = results;
    allUsers = userRes.users || [];
    allLogs = logRes.logs || [];
    feedbackData = feedbackRes || { stats: { up: 0, down: 0 }, recentFeedback: [] };
    installStats = installRes || { totalInstalls: 0, registeredInstalls: 0, unregisteredInstalls: 0, installsByDate: [] };
    allInstalls = installListRes?.installs || [];
    
    console.log('[DEBUG] Install list response:', installListRes);
    console.log('[DEBUG] All installs count:', allInstalls.length);
    console.log('[DEBUG] Install stats:', installStats);

    if (isSuperAdmin() && results[5]) {
      pendingAdminRequests = results[5].requests || [];
      window._pendingAdminCount = pendingAdminRequests.length;
    }

    // Build approved admins list from all users
    approvedAdmins = allUsers.filter(u => (u.isAdmin || u.role === 'admin' || u.role === 'super_admin') && u.adminStatus !== 'pending');
    
    // Auto-notifications for new users
    const latestUser = allUsers[0];
    if (latestUser && (!notifications.length || notifications[0].id !== latestUser._id)) {
       notifications.unshift({ id: latestUser._id, text: `New User: ${latestUser.email}`, time: new Date() });
       if (notifications.length > 10) notifications.pop();
    }

    // Auto-notification for pending admin requests
    if (isSuperAdmin() && pendingAdminRequests.length > 0) {
      const latestReq = pendingAdminRequests[0];
      if (!notifications.find(n => n.id === `req-${latestReq._id}`)) {
        notifications.unshift({ id: `req-${latestReq._id}`, text: `Admin Request: ${latestReq.email}`, time: new Date() });
        if (notifications.length > 10) notifications.pop();
      }
    }

    renderCurrentView();
  } catch (err) {
    const isForbidden = err.message.toLowerCase().includes('forbidden');
    viewContainer.innerHTML = `
      <div class="error-state">
        <h2>${isForbidden ? 'Access Denied' : 'Sync Error'}</h2>
        <p>${err.message}</p>
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
           <button onclick="logout()" class="btn-primary" style="background: #64748b;">Return to Sign In</button>
           <button onclick="location.reload()" class="btn-primary">Retry Sync</button>
        </div>
      </div>
    `;
  }
}

window.rescueAdmin = async () => {
    const secret = prompt('Enter Admin Secret to restore your privileges:');
    if (!secret) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/admin/promote-rescue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, secret })
        });
        if (!res.ok) throw new Error('Invalid Secret');
        alert('Admin role restored! Refreshing portal...');
        initDashboard();
    } catch (e) { alert('Failed: ' + e.message); }
};

function renderCurrentView() {
  const container = document.getElementById('app-view');
  if (currentPageView === 'dashboard') renderDashboardView(container);
  else if (currentPageView === 'users') renderUsersView(container);
  else if (currentPageView === 'installs') renderInstallsView(container);
  else if (currentPageView === 'subscriptions') renderSubscriptionsView(container);
  else if (currentPageView === 'logs') renderLogsView(container);
  else if (currentPageView === 'settings') renderSettingsView(container);
  else if (currentPageView === 'adminManagement') renderAdminManagementView(container);
}

// ============================================================================
// 4. VIEW RENDERERS
// ============================================================================

function renderDashboardView(container) {
  const stats = {
    total: allUsers.length,
    pro: allUsers.filter(u => u.plan === 'pro' && u.subscriptionStatus === 'active').length,
    trials: allUsers.filter(u => u.plan === 'trial').length,
    free: allUsers.filter(u => (!u.plan || u.plan === 'free') && u.subscriptionStatus !== 'active').length
  };

  container.innerHTML = `
    <div class="page-view">
      <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div class="stat-card">
          <p class="stat-label">Total Users</p>
          <h2 class="stat-value">${stats.total}</h2>
          <div class="stat-trend" style="color: #64748b;">All Time</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">Pro Users</p>
          <h2 class="stat-value" style="color: #10b981;">${stats.pro}</h2>
          <div class="stat-trend">⚡ Revenue</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">Trial Users</p>
          <h2 class="stat-value" style="color: #f59e0b;">${stats.trials}</h2>
          <div class="stat-trend">⏳ Active</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">AI Satisfaction</p>
          <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px;">
            <div style="display: flex; align-items: center; gap: 4px; color: #10b981; font-weight: 700;">
               <i data-lucide="thumbs-up" style="width: 16px;"></i> ${feedbackData.stats.up}
            </div>
            <div style="display: flex; align-items: center; gap: 4px; color: #ef4444; font-weight: 700;">
               <i data-lucide="thumbs-down" style="width: 16px;"></i> ${feedbackData.stats.down}
            </div>
          </div>
          <div class="stat-trend">User Feedback</div>
        </div>
      </div>

      <div class="data-card">
         <div class="card-header"><h3 class="card-title"><span class="title-dot"></span> Recent Activity</h3></div>
         ${renderTable(allUsers.slice(0, 10))}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function renderUsersView(container) {
  const filtered = allUsers.filter(u => u.email.toLowerCase().includes(searchQuery.toLowerCase()));
  container.innerHTML = `
    <div class="page-view">
      <div class="data-card">
        <div class="card-header"><h3 class="card-title">User Management</h3></div>
        ${renderTable(filtered)}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  setupTableListeners();
}

function renderSubscriptionsView(container) {
  const subs = allUsers.filter(u => u.subscriptionStatus === 'active' || u.plan === 'pro');
  container.innerHTML = `
    <div class="page-view">
      <div class="data-card">
        <div class="card-header"><h3 class="card-title">Active Subscriptions</h3></div>
        ${subs.length ? renderTable(subs) : '<div style="padding: 40px; text-align: center; color: var(--text-muted);">No active subscriptions found.</div>'}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  setupTableListeners();
}

function renderLogsView(container) {
  container.innerHTML = `
    <div class="page-view">
      <div class="data-card">
        <div class="card-header"><h3 class="card-title">Webhook Logs</h3></div>
        <table>
          <thead><tr><th>Event</th><th>Email</th><th>ID</th><th>Received</th></tr></thead>
          <tbody>
            ${allLogs.map(l => `
              <tr>
                <td><span class="badge ${(l.event || '').includes('success') ? 'badge-pro' : 'badge-free'}">${escapeHTML(l.event || 'Unknown')}</span></td>
                <td>${escapeHTML(l.email || 'N/A')}</td>
                <td style="font-family:monospace; font-size:12px;">${escapeHTML(l.subscriptionId || 'N/A')}</td>
                <td>${new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${!allLogs.length ? '<div style="padding:40px; text-align:center; color: var(--text-muted);">No webhook events recorded.</div>' : ''}
      </div>
    </div>
  `;
}

function renderInstallsView(container) {
  container.innerHTML = `
    <div class="page-view">
      <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 24px;">
        <div class="stat-card">
          <p class="stat-label">Total Installs</p>
          <h2 class="stat-value">${installStats.totalInstalls}</h2>
          <div class="stat-trend" style="color: #64748b;">Chrome Store</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">Registered Users</p>
          <h2 class="stat-value" style="color: #10b981;">${installStats.registeredInstalls}</h2>
          <div class="stat-trend">Linked to accounts</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">Unregistered</p>
          <h2 class="stat-value" style="color: #f59e0b;">${installStats.unregisteredInstalls}</h2>
          <div class="stat-trend">Install only</div>
        </div>
        <div class="stat-card">
          <p class="stat-label">Conversion Rate</p>
          <h2 class="stat-value" style="color: #8b5cf6;">${installStats.totalInstalls > 0 ? Math.round((installStats.registeredInstalls / installStats.totalInstalls) * 100) : 0}%</h2>
          <div class="stat-trend">Install to signup</div>
        </div>
      </div>

      <div class="data-card">
        <div class="card-header"><h3 class="card-title"><span class="title-dot"></span> Chrome Store Install List</h3></div>
        ${allInstalls.length > 0 ? `
          <table>
            <thead><tr><th>Chrome ID</th><th>Email</th><th>Version</th><th>Platform</th><th>Install Date</th><th>Last Active</th><th>Status</th></tr></thead>
            <tbody>
              ${allInstalls.map(install => {
                const userEmail = install.email || (install.userId && install.userId.email) || 'Not registered';
                const isRegistered = install.registered || (install.userId && install.userId.email);
                return `
                  <tr>
                    <td style="font-family:monospace; font-size:12px;">${escapeHTML(install.chromeId || 'N/A')}</td>
                    <td>${isRegistered ? `<strong>${escapeHTML(userEmail)}</strong>` : '<span style="color:#f59e0b;">Not registered</span>'}</td>
                    <td>${escapeHTML(install.version || 'N/A')}</td>
                    <td>${escapeHTML(install.platform || 'N/A')}</td>
                    <td>${new Date(install.installDate).toLocaleDateString()}</td>
                    <td>${new Date(install.lastActive).toLocaleDateString()}</td>
                    <td><span class="badge ${isRegistered ? 'badge-pro' : 'badge-free'}">${isRegistered ? 'Registered' : 'Unregistered'}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        ` : '<div style="padding:40px; text-align:center; color: var(--text-muted);">No installs recorded yet.</div>'}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function renderSettingsView(container) {
  container.innerHTML = `
    <div class="page-view">
      <div style="display: grid; grid-template-columns: 1fr; gap: 24px;">
        <div class="data-card">
          <div class="card-header"><h3 class="card-title">Admin Profile</h3></div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 24px;">Update your administrative credentials.</p>
          
          <form id="admin-update-form" style="display: flex; flex-direction: column; gap: 20px;">
            <div class="setting-item">
              <label>Administrator Email</label>
              <input type="email" id="update-admin-email" value="${currentUser.email}" class="form-input">
            </div>
            <div class="setting-item">
              <label>New Password</label>
              <input type="password" id="update-admin-pass" placeholder="Leave blank to keep current" class="form-input">
            </div>
            <button type="submit" class="btn-primary">Update Credentials</button>
          </form>
        </div>
      </div>
    </div>
  `;
  
  const form = document.getElementById('admin-update-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('update-admin-email').value;
    const password = document.getElementById('update-admin-pass').value;
    try {
      await apiCall('/admin/update-admin', { method: 'POST', body: JSON.stringify({ email, password }) });
      alert('Profile updated successfully! If you changed your email, please re-login.');
      if (email !== currentUser.email) logout();
    } catch (err) { alert('Update Failed: ' + err.message); }
  });
}

function renderAdminManagementView(container) {
  const renderPendingRow = (req) => `
    <tr>
      <td>
        <div style="font-weight:700; font-size:13px;">${escapeHTML(req.email)}</div>
        <div style="font-size:10px; color:#94a3b8; font-family:monospace;">${escapeHTML(req._id)}</div>
      </td>
      <td style="font-size:12px; color:#64748b;">${req.adminRequestedAt ? new Date(req.adminRequestedAt).toLocaleString() : 'N/A'}</td>
      <td><span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a;">Pending</span></td>
      <td style="text-align:right;">
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button onclick="handleAdminAction('${escapeHTML(req._id)}', 'approve')" style="background:#10b981; color:white; border:none; border-radius:8px; padding:6px 14px; font-size:12px; font-weight:700; cursor:pointer;">✓ Approve</button>
          <button onclick="handleAdminAction('${escapeHTML(req._id)}', 'reject')" style="background:#ef4444; color:white; border:none; border-radius:8px; padding:6px 14px; font-size:12px; font-weight:700; cursor:pointer;">✗ Decline</button>
        </div>
      </td>
    </tr>
  `;

  const renderAdminRow = (u) => {
    const isSelf = u.email === currentUser.email;
    const isSuper = u.role === 'super_admin';
    return `
    <tr>
      <td>
        <div style="font-weight:700; font-size:13px;">${escapeHTML(u.email)} ${isSelf ? '<span style="font-size:10px; background:#dbeafe; color:#1d4ed8; border-radius:999px; padding:2px 8px; margin-left:4px;">You</span>' : ''}</div>
        <div style="font-size:10px; color:#94a3b8; font-family:monospace;">${escapeHTML(u._id)}</div>
      </td>
      <td><span class="badge badge-${isSuper ? 'pro' : 'trial'}">${isSuper ? '⭐ Super Admin' : 'Admin'}</span></td>
      <td style="font-size:12px; color:#64748b;">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}</td>
      <td style="text-align:right;">
        ${isSelf || isSuper ? '<span style="font-size:11px; color:#94a3b8;">Protected</span>' : `<button onclick="handleAdminAction('${escapeHTML(u._id)}', 'demote')" style="background:#64748b; color:white; border:none; border-radius:8px; padding:6px 14px; font-size:12px; font-weight:700; cursor:pointer;">Revoke</button>`}
      </td>
    </tr>
  `;};

  container.innerHTML = `
    <div class="page-view">
      <!-- Pending Requests -->
      <div class="data-card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            <span class="title-dot" style="background:#f59e0b;"></span>
            Pending Admin Requests
            ${pendingAdminRequests.length > 0 ? `<span style="background:#ef4444; color:white; font-size:11px; font-weight:800; border-radius:999px; padding:2px 9px; margin-left:8px;">${pendingAdminRequests.length}</span>` : ''}
          </h3>
        </div>
        ${pendingAdminRequests.length > 0 ? `
          <table>
            <thead><tr><th>Email</th><th>Requested At</th><th>Status</th><th style="text-align:right;">Action</th></tr></thead>
            <tbody>${pendingAdminRequests.map(renderPendingRow).join('')}</tbody>
          </table>
        ` : `<div style="padding:40px; text-align:center; color:var(--text-muted); font-size:14px;">🎉 No pending admin requests.</div>`}
      </div>

      <!-- Current Admins -->
      <div class="data-card">
        <div class="card-header">
          <h3 class="card-title"><span class="title-dot"></span> Current Admins</h3>
        </div>
        ${approvedAdmins.length > 0 ? `
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th style="text-align:right;">Action</th></tr></thead>
            <tbody>${approvedAdmins.map(renderAdminRow).join('')}</tbody>
          </table>
        ` : `<div style="padding:40px; text-align:center; color:var(--text-muted); font-size:14px;">No admins found.</div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

window.handleAdminAction = async (userId, action) => {
  const confirmMsgs = {
    approve: 'Approve this admin request?',
    reject: 'Decline this admin request?',
    demote: 'Revoke admin access for this user? They will become a regular user.'
  };
  if (!confirm(confirmMsgs[action] || 'Continue?')) return;

  try {
    let endpoint, payload = { userId };
    if (action === 'approve') endpoint = '/admin/approve-request';
    else if (action === 'reject') endpoint = '/admin/reject-request';
    else if (action === 'demote') endpoint = '/admin/demote-admin';

    await apiCall(endpoint, { method: 'POST', body: JSON.stringify(payload) });

    const actionLabels = { approve: 'APPROVED', reject: 'DECLINED', demote: 'REVOKED' };
    notifications.unshift({ id: Date.now(), text: `Admin ${actionLabels[action]}: ${userId}`, time: new Date() });

    // Refresh data and re-render
    await loadDataAndRender();
    currentPageView = 'adminManagement';
    renderCurrentView();
  } catch (err) {
    alert('Action Failed: ' + err.message);
  }
};

// ============================================================================
// 5. COMPONENTS & HELPERS
// ============================================================================

function renderTable(users) {
  if (!users.length) return '<div style="padding: 32px; text-align: center; color: #94a3b8;">No matching users.</div>';
  return `
    <div style="width: 100%; position: relative;">
      <table>
        <thead><tr><th>Account</th><th>Verified</th><th>Plan</th><th>Subscription</th><th>Last Login</th><th>Joined</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <div style="font-weight: 700; font-size: 13px;">${escapeHTML(u.email)}</div>
                <div style="font-size: 10px; color: #94a3b8; font-family: monospace;">${escapeHTML(u._id)}</div>
              </td>
              <td>
                <div style="display: flex; align-items: center; justify-content: center;">
                  <i data-lucide="${u.verified ? 'shield-check' : 'shield-alert'}" style="color: ${u.verified ? '#10b981' : '#f59e0b'}; width: 18px;"></i>
                </div>
              </td>
              <td><span class="badge badge-${escapeHTML(u.plan || 'free')}">${escapeHTML(u.plan || 'free')}</span></td>
              <td>
                <div style="display:flex; align-items:center; gap:6px;">
                  <div style="width:6px; height:6px; border-radius:50%; background:${u.subscriptionStatus === 'active' ? '#10b981' : '#cbd5e1'}"></div>
                  <span style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: ${u.subscriptionStatus === 'active' ? '#059669' : '#64748b'}">${escapeHTML(u.subscriptionStatus || 'inactive')}</span>
                </div>
              </td>
              <td style="font-size: 12px; color: #475569;">${u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'N/A'}</td>
              <td style="font-size: 12px; color: #475569;">${new Date(u.createdAt || Date.now()).toLocaleDateString()}</td>
              <td><button class="action-trigger" data-user-id="${u._id}"><i data-lucide="more-horizontal"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 6. INTERACTION LOGIC
// ============================================================================

function setupEventListeners() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); currentPageView = item.dataset.view; initDashboard(); });
  });

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => { currentTheme = btn.dataset.theme; localStorage.setItem('theme', currentTheme); initDashboard(); });
  });

  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; if (currentPageView === 'users' || currentPageView === 'dashboard') loadDataAndRender(); });
  }

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('refresh-btn').addEventListener('click', () => {
     document.getElementById('refresh-text').textContent = 'Syncing...';
     loadDataAndRender().finally(() => document.getElementById('refresh-text').textContent = 'Sync Data');
  });

  document.getElementById('notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('notif-panel');
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    renderNotifs();
  });

  document.getElementById('profile-btn').addEventListener('click', () => { currentPageView = 'settings'; initDashboard(); });
  
  document.addEventListener('click', () => {
    document.getElementById('notif-panel').style.display = 'none';
    document.getElementById('action-dropdown').style.display = 'none';
  });
}

function renderNotifs() {
  const panel = document.getElementById('notif-panel');
  if (!notifications.length) { panel.innerHTML = '<div style="padding:16px; text-align:center; color:#64748b; font-size:12px;">No new activity</div>'; return; }
  panel.innerHTML = `
    <div style="padding:12px 18px; font-weight:800; font-size:11px; text-transform:uppercase; border-bottom:1px solid var(--border); color: var(--primary);">Real-time Alerts</div>
    ${notifications.map(n => `
      <div class="notif-item">
        <p style="font-weight:600; font-size:13px; margin-bottom:2px; color: var(--text-main);">${escapeHTML(n.text)}</p>
        <p style="font-size:10px; color:#94a3b8;">${new Date(n.time).toLocaleTimeString()}</p>
      </div>
    `).join('')}
  `;
}

function setupTableListeners() {
  document.querySelectorAll('.action-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = trigger.getBoundingClientRect();
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const scrollX = window.scrollX || document.documentElement.scrollLeft;
      
      // Pass the trigger element's bounding rect and scroll to calculate dynamic position
      showActionDropdown(rect, scrollX, scrollY, trigger.dataset.userId);
    });
  });
}

function showActionDropdown(rect, scrollX, scrollY, userId) {
  const dropdown = document.getElementById('action-dropdown');
  const user = allUsers.find(u => u._id === userId);
  
  dropdown.innerHTML = `
    <div class="dropdown-header">
      <p>Management</p>
      <span>${escapeHTML(user?.email?.split('@')[0])}</span>
    </div>
    <div class="dropdown-item" onclick="handleAction('${escapeHTML(userId)}', 'upgrade')">
      <div class="item-icon icon-pro"><i data-lucide="zap"></i></div>
      <div class="item-text">
        <p>Grant Pro Access</p>
        <span>Promote account immediately</span>
      </div>
    </div>
    <div class="dropdown-item" onclick="handleAction('${userId}', 'trial')">
      <div class="item-icon" style="background:#fef3c7; color:#b45309;"><i data-lucide="gift"></i></div>
      <div class="item-text">
        <p>Activate Trial</p>
        <span>Start 3-day trial manually</span>
      </div>
    </div>
    <div class="dropdown-item" onclick="handleAction('${userId}', 'cancel')">
      <div class="item-icon icon-cancel"><i data-lucide="x-circle"></i></div>
      <div class="item-text">
        <p>Cancel Plan</p>
        <span>Downgrade to free tier</span>
      </div>
    </div>
    <div class="dropdown-divider"></div>
    <div class="dropdown-item danger" onclick="handleAction('${userId}', 'delete')">
      <div class="item-icon icon-delete"><i data-lucide="trash-2"></i></div>
      <div class="item-text">
        <p>Delete User</p>
        <span>Wipe from database</span>
      </div>
    </div>
  `;
  
  // Dynamic positioning guard for screen edges
  const dropWidth = 240;
  const dropHeight = 320; // Estimated height of the dropdown menu
  
  let x = rect.left + scrollX - 180;
  let y = rect.top + scrollY + 40; // Default below the button

  if (x + dropWidth > window.innerWidth) x = window.innerWidth - dropWidth - 20;
  
  // If the dropdown goes below the viewport, position it above the button
  if (rect.top + 40 + dropHeight > window.innerHeight) {
     y = rect.top + scrollY - dropHeight + 10;
  }
  
  dropdown.style.left = x + 'px'; 
  dropdown.style.top = y + 'px';
  dropdown.style.display = 'block';
  dropdown.classList.add('pop-in');
  

  if (window.lucide) lucide.createIcons();
}

window.handleAction = async (userId, action) => {
  const user = allUsers.find(u => u._id === userId);
  if (!user) return;

  const confirmMsg = action === 'upgrade' 
    ? `Grant Pro access to ${user.email}?` 
    : action === 'delete' 
      ? `PERMANENTLY DELETE user ${user.email}? This cannot be undone.`
      : `Cancel subscription for ${user.email}?`;

  if (!confirm(confirmMsg)) return;

  try {
    let endpoint = '';
    let payload = {};
    
    if (action === 'upgrade') {
      endpoint = '/admin/simulate-webhook';
      payload.email = user.email;
      payload.alert_name = 'subscription_created';
    } else if (action === 'trial') {
      endpoint = '/admin/simulate-webhook';
      payload.email = user.email;
      payload.alert_name = 'subscription_activated'; // Logic in controller handles trial if next_bill_date or similar
    } else if (action === 'delete') {
      endpoint = '/admin/delete-user';
      payload.userId = userId;
    } else if (action === 'cancel') {
      endpoint = '/admin/cancel-subscription';
      payload.email = user.email; // Backend expects email or subscriptionId
    }

    await apiCall(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    
    // Success feedback
    notifications.unshift({ 
      id: Date.now(), 
      text: `${action.toUpperCase()} success: ${user.email}`, 
      time: new Date() 
    });
    
    initDashboard(); 
  } catch (err) { 
    alert('Failure: ' + err.message); 
  }
};

window.addEventListener('load', () => { authToken ? initDashboard() : showAuthPage(); });
