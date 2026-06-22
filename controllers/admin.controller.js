const User = require('../models/user.model');
const WebhookLog = require('../models/webhook.model');
const Device = require('../models/device.model');
const paddleController = require('./paddle.controller');
const querystring = require('querystring');

exports.cancelSubscription = async (req, res) => {
  try {
    const { email, subscriptionId } = req.body || {};
    if (!email && !subscriptionId) return res.status(400).json({ error: 'email_or_subscriptionId_required' });

    let user = null;
    if (email) user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user && subscriptionId) user = await User.findOne({ subscriptionId: subscriptionId });
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const oldPlan = user.plan;
    user.plan = 'free';
    user.subscriptionStatus = 'cancelled';
    user.subscriptionId = null;
    user.isPro = false;
    // Mark as manually changed by admin to prevent webhook override
    user.planChangedManuallyAt = new Date();
    user.planChangedBy = 'admin';
    await user.save();

    console.log(`[Admin] Subscription cancelled: ${user.email} (${oldPlan} -> free)`);

    // Real-time sync: Notify extension and admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        plan: 'free',
        subscriptionStatus: 'cancelled',
        subscriptionId: null,
        isPro: false
      });
      eventsService.broadcastToAdmins('subscription_changed', {
        userId: user._id,
        email: user.email,
        oldPlan,
        newPlan: 'free',
        action: 'cancelled'
      });
    } catch (e) {
      console.warn('[Warning] Failed to broadcast subscription cancellation:', e.message);
    }

    return res.json({ success: true, message: 'subscription_cancelled' });
  } catch (err) {
    console.error('[Admin] cancelSubscription error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;
    
    // Optional filters
    const { verified, plan, search } = req.query;
    const filter = {};
    
    if (verified !== undefined) {
      filter.verified = verified === 'true';
    }
    
    if (plan) {
      filter.plan = plan;
    }
    
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    console.log(`[Admin][LIST_USERS] Query with filter:`, JSON.stringify(filter));

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Add device count to each user
    const usersWithDeviceCount = users.map(user => ({
      ...user,
      deviceCount: user.devices ? user.devices.length : 0,
      activeDeviceCount: user.devices ? user.devices.filter(d => d.isActive).length : 0
    }));

    console.log(`[Admin][LIST_USERS] Returning ${users.length} users out of ${total} total`);

    return res.json({ 
      users: usersWithDeviceCount,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('[Admin][LIST_USERS] listUsers error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.getUser = async (req, res) => {
  try {
    const email = (req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });
    const user = await User.findOne({ email }).select('-password');
    if (!user) return res.status(404).json({ error: 'not_found' });
    
    // Add device count to user data
    const userWithDeviceCount = {
      ...user.toObject(),
      deviceCount: user.devices ? user.devices.length : 0,
      activeDeviceCount: user.devices ? user.devices.filter(d => d.isActive).length : 0
    };
    
    console.log(`[Admin][GET_USER] Returning user: ${email} with ${userWithDeviceCount.deviceCount} devices`);
    
    return res.json({ user: userWithDeviceCount });
  } catch (err) {
    console.error('[Admin][GET_USER] getUser error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.simulateWebhook = async (req, res) => {
  try {
    const { alert_name, email, subscription_id } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email_required' });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
       const crypto = require('crypto');
       user = new User({ 
         email: email.toLowerCase(), 
         password: crypto.randomBytes(8).toString('hex'),
         verified: true,
         role: 'user'
       });
    }

    const oldPlan = user.plan;

    // Check if plan was manually changed by admin recently (within last 24 hours)
    // If so, skip webhook simulation to prevent override
    const manualChangeThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    if (user.planChangedManuallyAt && user.planChangedBy === 'admin' && user.planChangedManuallyAt > manualChangeThreshold) {
      console.log(`[Admin] Skipping webhook simulation for ${user.email} - plan was manually changed by admin less than 24 hours ago`);
      return res.json({ success: true, user, skipped: true, reason: 'manual_override' });
    }

    if (alert_name === 'subscription_created' || alert_name === 'upgrade') {
      user.plan = 'pro';
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscription_id || `manual_${Date.now()}`;
      user.isPro = true;
      user.planChangedManuallyAt = null;
      user.planChangedBy = 'webhook';
    } else if (alert_name === 'subscription_activated' || alert_name === 'trial') {
      user.plan = 'trial';
      user.trialUsed = true;
      user.subscriptionStatus = 'active';
      user.subscriptionId = subscription_id || `manual_${Date.now()}`;
      
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 3);
      user.trialEndsAt = trialEnds;
      user.trialEnd = trialEnds;
      user.planChangedManuallyAt = null;
      user.planChangedBy = 'webhook';
    } else if (alert_name === 'subscription_cancelled' || alert_name === 'cancel' || alert_name === 'downgrade') {
      user.plan = 'free';
      user.subscriptionStatus = 'cancelled';
      user.subscriptionId = null;
      user.isPro = false;
      user.planChangedManuallyAt = new Date();
      user.planChangedBy = 'admin';
    }

    await user.save();

    console.log(`[Admin] Webhook simulated: ${user.email} (${oldPlan} -> ${user.plan}, ${alert_name})`);

    // Real-time sync: Notify extension and admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, { 
        email: user.email, 
        plan: user.plan, 
        subscriptionId: user.subscriptionId, 
        subscriptionStatus: user.subscriptionStatus,
        isPro: user.isPro || user.plan === 'pro',
        trialEndsAt: user.trialEndsAt
      });
      
      eventsService.broadcastToAdmins('subscription_changed', {
        userId: user._id,
        email: user.email,
        oldPlan,
        newPlan: user.plan,
        action: alert_name
      });
      
      const { userCache } = require('./user.controller');
      if (userCache) userCache.del(user.email);
    } catch (e) {
      console.warn('[Warning] Failed to broadcast webhook simulation:', e.message);
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error('[Admin] simulateWebhook error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  // Prevent self-deletion
  if (req.user && req.user._id.toString() === userId.toString()) {
    return res.status(403).json({ error: 'Cannot delete your own administrative account.' });
  }

  try {
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
};

exports.promoteUser = async (req, res) => {
  const { email, secret } = req.body;
  if (!email || !secret) return res.status(400).json({ error: 'Email and secret required' });
  
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error('[Admin Security] ADMIN_SECRET not configured in environment variables.');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (secret === adminSecret) {
    try {
      const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { isAdmin: true }, { new: true });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({ message: 'User promoted correctly', user });
    } catch (e) {
      return res.status(500).json({ error: 'Database update failed' });
    }
  }
  return res.status(401).json({ error: 'Invalid secret' });
};

exports.updateAdmin = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: 'User context is missing' });
    }
    
    const { email, password } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ error: 'Admin user not found in DB' });
    }
    
    // Prevent email change to superadmin account
    const superAdminEmail = 'okparadaniel79@gmail.com';
    if (email && email.toLowerCase() === superAdminEmail && user.email !== superAdminEmail) {
      return res.status(403).json({ error: 'Cannot use the reserved super admin email' });
    }

    if (email) {
      const emailTaken = await User.findOne({ email: email.toLowerCase() });
      if (emailTaken && emailTaken._id.toString() !== user._id.toString()) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      user.email = email.toLowerCase();
    }
    if (password) {
      user.password = password; // Will be hashed by pre-save hook
    }
    
    await user.save();
    
    console.log(`[Admin] Admin account updated: ${user.email}`);
    
    return res.json({ success: true, message: 'Account updated successfully' });
  } catch (err) {
    console.error('[Admin] updateAdmin error:', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.listWebhookLogs = async (req, res) => {
  try {
    const { limit = 100, skip = 0 } = req.query;
    const logs = await WebhookLog.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .skip(parseInt(skip, 10));
    const total = await WebhookLog.countDocuments();
    return res.json({ logs, total });
  } catch (err) {
    console.error('[Admin] listWebhookLogs error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.getFeedbackStats = async (req, res) => {
  try {
    const AIFeedback = require('../models/feedback.model');
    const stats = await AIFeedback.aggregate([
      {
        $group: {
          _id: '$feedback',
          count: { $sum: 1 }
        }
      }
    ]);

    const formattedStats = {
      up: stats.find(s => s._id === 'up')?.count || 0,
      down: stats.find(s => s._id === 'down')?.count || 0
    };

    const recentFeedback = await AIFeedback.find()
      .sort({ createdAt: -1 })
      .limit(10);

    return res.json({ stats: formattedStats, recentFeedback });
  } catch (err) {
    console.error('[Admin] getFeedbackStats error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.requestAccess = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.role === 'admin' || user.role === 'super_admin' || user.isAdmin) {
      return res.status(400).json({ error: 'You are already an admin.' });
    }
    
    user.adminStatus = 'pending';
    user.adminRequestedAt = new Date();
    await user.save();
    
    // Notify super admins via SSE
    try {
      const eventsService = require('../services/events.service');
      eventsService.broadcastToAdmins('admin_approval', {
        type: 'request',
        userId: user._id,
        email: user.email,
        adminStatus: 'pending'
      });
    } catch (e) {}

    return res.json({ success: true, message: 'Admin request submitted. Pending review.' });
  } catch (err) {
    console.error('[Admin] requestAccess error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.getPendingRequests = async (req, res) => {
  try {
    const requests = await User.find({ adminStatus: 'pending' })
      .select('_id email adminStatus adminRequestedAt role')
      .sort({ adminRequestedAt: -1 })
      .lean();
    return res.json({ requests });
  } catch (err) {
    console.error('[Admin] getPendingRequests error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.role = 'admin';
    user.isAdmin = true;
    user.adminStatus = 'approved';
    await user.save();
    
    // Notify user via SSE
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        isAdmin: true,
        role: 'admin',
        adminStatus: 'approved'
      });
      // Also broadcast updates to all admins
      eventsService.broadcastToAdmins('admin_approval', {
        type: 'approve',
        userId: user._id,
        email: user.email,
        role: 'admin',
        adminStatus: 'approved'
      });
    } catch (e) {}

    return res.json({ success: true, message: 'Admin access approved.' });
  } catch (err) {
    console.error('[Admin] approveRequest error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.adminStatus = 'rejected';
    await user.save();
    
    // Notify admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.broadcastToAdmins('admin_approval', {
        type: 'reject',
        userId: user._id,
        email: user.email,
        adminStatus: 'rejected'
      });
    } catch (e) {}

    return res.json({ success: true, message: 'Admin access rejected.' });
  } catch (err) {
    console.error('[Admin] rejectRequest error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.promoteSuperAdmin = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.role = 'super_admin';
    user.isAdmin = true;
    user.adminStatus = 'approved';
    await user.save();
    
    try {
      const eventsService = require('../services/events.service');
      eventsService.broadcastToAdmins('admin_approval', {
        type: 'promote',
        userId: user._id,
        email: user.email,
        role: 'super_admin'
      });
    } catch (e) {}

    return res.json({ success: true, message: 'User promoted to Super Admin.' });
  } catch (err) {
    console.error('[Admin] promoteSuperAdmin error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.demoteAdmin = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    
    const superAdminEmail = 'okparadaniel79@gmail.com';
    const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID;
    
    // Prevent self-demotion
    if (req.user && req.user.id.toString() === userId.toString()) {
      return res.status(403).json({ error: 'You cannot demote yourself.' });
    }
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // CRITICAL: Prevent demoting the primary Super Admin by email
    if (user.email === superAdminEmail) {
      return res.status(403).json({ 
        error: 'forbidden',
        message: 'Cannot demote the primary Super Admin. This account is protected by system rules.' 
      });
    }
    
    // Prevent demoting via environment variable ID if set
    if (SUPER_ADMIN_ID && user._id.toString() === SUPER_ADMIN_ID) {
      return res.status(403).json({ 
        error: 'forbidden',
        message: 'Cannot demote protected super admin account.' 
      });
    }

    user.role = 'user';
    user.isAdmin = false;
    user.adminStatus = 'none';
    await user.save();
    
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        isAdmin: false,
        role: 'user',
        adminStatus: 'none'
      });
      eventsService.broadcastToAdmins('admin_approval', {
        type: 'demote',
        userId: user._id,
        email: user.email,
        role: 'user',
        adminStatus: 'none'
      });
    } catch (e) {}

    return res.json({ success: true, message: 'Admin demoted to regular user.' });
  } catch (err) {
    console.error('[Admin] demoteAdmin error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.seedSuperAdmin = async () => {
  try {
    const email = 'okparadaniel79@gmail.com';
    let user = await User.findOne({ email });
    if (!user) {
      const bcrypt = require('bcryptjs');
      const crypto = require('crypto');
      const password = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123';
      user = new User({
        email,
        password,
        verified: true,
        isAdmin: true,
        role: 'super_admin',
        adminStatus: 'approved'
      });
      await user.save();
      console.log(`[Admin Seeding]: Super Admin ${email} created.`);
    } else {
      let modified = false;
      if (user.role !== 'super_admin') {
        user.role = 'super_admin';
        modified = true;
      }
      if (!user.isAdmin) {
        user.isAdmin = true;
        modified = true;
      }
      if (user.adminStatus !== 'approved') {
        user.adminStatus = 'approved';
        modified = true;
      }
      if (!user.verified) {
        user.verified = true;
        modified = true;
      }
      if (modified) {
        await user.save();
        console.log(`[Admin Seeding]: Super Admin ${email} fields updated.`);
      } else {
        console.log(`[Admin Seeding]: Super Admin ${email} is already properly seeded.`);
      }
    }
  } catch (err) {
    console.error('[Admin Seeding] Error seeding Super Admin:', err);
  }
};

exports.upgradePlan = async (req, res) => {
  try {
    const { email, plan, subscriptionId } = req.body;
    if (!email || !plan) return res.status(400).json({ error: 'email and plan required' });
    
    if (!['free', 'pro', 'trial'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be free, pro, or trial' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const oldPlan = user.plan;
    user.plan = plan;
    user.subscriptionStatus = plan === 'free' ? 'inactive' : 'active';
    user.isPro = plan === 'pro';
    
    if (subscriptionId) {
      user.subscriptionId = subscriptionId;
    }
    
    if (plan === 'trial' && !user.trialUsed) {
      user.trialUsed = true;
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 3);
      user.trialEndsAt = trialEnds;
    }

    await user.save();

    console.log(`[Admin] Plan upgraded: ${user.email} (${oldPlan} -> ${plan})`);

    // Real-time sync
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        plan: user.plan,
        isPro: user.isPro,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionId: user.subscriptionId,
        trialEndsAt: user.trialEndsAt
      });
      
      eventsService.broadcastToAdmins('subscription_changed', {
        userId: user._id,
        email: user.email,
        oldPlan,
        newPlan: plan,
        action: 'admin_upgrade'
      });
      
      const { userCache } = require('./user.controller');
      if (userCache) userCache.del(user.email);
    } catch (e) {
      console.warn('[Warning] Failed to broadcast plan upgrade:', e.message);
    }

    return res.json({ success: true, message: `Plan updated to ${plan}`, user });
  } catch (err) {
    console.error('[Admin] upgradePlan error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.downgradeplan = async (req, res) => {
  try {
    const { email, plan } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const oldPlan = user.plan;
    user.plan = plan || 'free';
    user.subscriptionStatus = 'inactive';
    user.subscriptionId = null;
    user.isPro = false;

    await user.save();

    console.log(`[Admin] Plan downgraded: ${user.email} (${oldPlan} -> ${user.plan})`);

    // Real-time sync
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        plan: user.plan,
        isPro: false,
        subscriptionStatus: 'inactive'
      });
      
      eventsService.broadcastToAdmins('subscription_changed', {
        userId: user._id,
        email: user.email,
        oldPlan,
        newPlan: user.plan,
        action: 'admin_downgrade'
      });
      
      const { userCache } = require('./user.controller');
      if (userCache) userCache.del(user.email);
    } catch (e) {
      console.warn('[Warning] Failed to broadcast plan downgrade:', e.message);
    }

    return res.json({ success: true, message: `Plan downgraded to ${user.plan}`, user });
  } catch (err) {
    console.error('[Admin] downgradeplan error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.clearDevices = async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'DELETE_ALL_DEVICES') {
      return res.status(400).json({ error: 'Confirmation required. Send confirm: "DELETE_ALL_DEVICES" to proceed.' });
    }

    const result = await Device.deleteMany({});
    console.log(`[Admin] Cleared ${result.deletedCount} devices from database`);

    return res.json({ 
      success: true, 
      message: `Successfully cleared ${result.deletedCount} devices`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('[Admin] clearDevices error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.listDevices = async (req, res) => {
  try {
    const { limit = 100, skip = 0 } = req.query;
    const devices = await Device.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .skip(parseInt(skip, 10))
      .lean();
    const total = await Device.countDocuments();
    return res.json({ devices, total });
  } catch (err) {
    console.error('[Admin] listDevices error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const result = await Device.deleteOne({ deviceId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    console.log(`[Admin] Deleted device: ${deviceId}`);

    return res.json({ 
      success: true, 
      message: `Device deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('[Admin] deleteDevice error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.deleteMultipleDevices = async (req, res) => {
  try {
    const { deviceIds } = req.body;
    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'deviceIds array required' });
    }

    const result = await Device.deleteMany({ deviceId: { $in: deviceIds } });
    console.log(`[Admin] Deleted ${result.deletedCount} devices`);

    return res.json({ 
      success: true, 
      message: `Successfully deleted ${result.deletedCount} devices`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('[Admin] deleteMultipleDevices error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};

exports.deleteMultipleUsers = async (req, res) => {
  try {
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'user_ids_required' });
    }
    
    console.log(`[Admin] Deleting ${userIds.length} users:`, userIds);
    
    const result = await User.deleteMany({ _id: { $in: userIds } });
    
    console.log(`[Admin] Successfully deleted ${result.deletedCount} users`);
    
    return res.json({ 
      success: true, 
      message: `Successfully deleted ${result.deletedCount} users`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('[Admin] deleteMultipleUsers error', err);
    return res.status(500).json({ error: 'server_error', details: err.message });
  }
};
