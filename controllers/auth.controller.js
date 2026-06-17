const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const validator = require('validator');
const emailService = require('../services/email.service');
const Install = require('../models/install.model');

// Comprehensive disposable email list
const isDisposableEmail = (email) => {
  const disposableDomains = [
    'yopmail.com', 'mailinator.com', 'tempmail.com', 'guerrillamail.com', 
    '10minutemail.com', 'temp-mail.org', 'tempmail.net', 'dispostable.com', 
    'getnada.com', 'maildrop.cc', 'protonmail.ch', 'proxified.net', 
    'secmail.pro', 'tutanota.com', 'cock.li', 'msgsafe.io', 'mail-temp.com',
    'trashmail.com', 'disposable.com', 'sharklasers.com', 'guerrillamailblock.com',
    'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'spam4.me',
    'grr.la', 'guerrillamail.de'
  ];
  const domain = email.split('@')[1];
  return disposableDomains.some(d => domain.includes(d));
};

// Helper to generate JWTs
// Admin/super_admin tokens last 7 days so dashboard sessions persist.
// Regular user (extension) tokens stay at 15 minutes for security.
const generateToken = (user) => {
  const isAdminUser = user.isAdmin || user.role === 'admin' || user.role === 'super_admin';
  return jwt.sign(
    { id: user._id, isAdmin: user.isAdmin, role: user.role || 'user' },
    process.env.JWT_SECRET || 'super_secret_production_key_2026',
    { expiresIn: isAdminUser ? '7d' : '15m' }
  );
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET || 'refresh_secret_production_key_2026', {
    expiresIn: '7d'
  });
};

const setRefreshTokenCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

exports.register = async (req, res) => {
  try {
    let { email, password, chromeId, deviceId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    email = email.toLowerCase().trim();
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(email)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    let user = await User.findOne({ email });
    const verificationToken = crypto.randomBytes(16).toString('hex');
    let isNewUser = false;
    
    if (user) {
      // User exists - ACCOUNT RECOVERY FLOW
      console.log(`[Auth][REGISTER] Existing user found: ${email} (ID: ${user._id}, verified: ${user.verified})`);
      
      // Link device if provided
      if (deviceId) {
        await linkDeviceToUser(user, deviceId);
      }
      
      // Update last active
      user.lastActive = new Date();
      await user.save();
      
      // ACCOUNT RECOVERY: If user is verified, return account state + tokens
      if (user.verified) {
        console.log(`[Auth][REGISTER] Account recovery for verified user: ${email}`);
        
        const accessToken = generateToken(user);
        const refreshToken = generateRefreshToken(user._id);
        setRefreshTokenCookie(res, refreshToken);
        
        // Link Chrome install if provided
        if (chromeId) {
          try {
            const install = await Install.findOne({ chromeId });
            if (install) {
              install.email = email;
              install.userId = user._id;
              install.registered = true;
              await install.save();
              console.log(`[Auth][REGISTER] Linked Chrome install ${chromeId} to user ${email}`);
            }
          } catch (e) {
            console.error('[Auth][REGISTER] Error linking Chrome install:', e);
          }
        }
        
        return res.status(200).json({
          success: true,
          message: 'Account recovered successfully',
          requiresVerification: false,
          isNewUser: false,
          _id: user._id,
          email: user.email,
          isPro: user.isPro || user.plan === 'pro',
          isAdmin: user.isAdmin,
          role: user.role || 'user',
          adminStatus: user.adminStatus || 'none',
          plan: user.plan,
          trialUsed: !!user.trialUsed,
          trialActive: user.trialActive && user.trialEndsAt && new Date() < user.trialEndsAt,
          trialEndsAt: user.trialEndsAt,
          subscriptionStatus: user.subscriptionStatus || 'inactive',
          subscriptionEndsAt: user.subscriptionEndsAt,
          accountStatus: user.accountStatus || 'active',
          devices: user.devices || [],
          accessToken,
          refreshToken
        });
      }
      
      // User exists but not verified - send new verification email
      user.verificationToken = verificationToken;
      user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.save();
      console.log(`[Auth][REGISTER] Existing unverified user, sending verification: ${email}`);
    } else {
      // New user - create account
      isNewUser = true;
      const adminCount = await User.countDocuments({ isAdmin: true });
      const isAdmin = adminCount === 0;

      user = await User.create({ 
        email, 
        password: password || crypto.randomBytes(16).toString('hex'),
        isAdmin,
        role: isAdmin ? 'admin' : 'user',
        adminStatus: isAdmin ? 'approved' : 'none',
        verificationToken,
        verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        verified: false,
        plan: 'free',
        trialUsed: false,
        trialActive: false,
        accountStatus: 'active',
        metadata: {
          source: 'extension',
          createdAt: new Date()
        }
      });
      
      // Link device if provided
      if (deviceId) {
        await linkDeviceToUser(user, deviceId);
      }
      
      console.log(`[Auth][REGISTER] New user created: ${email} (ID: ${user._id})`);
    }

    // Link Chrome install if provided
    if (chromeId) {
      try {
        const install = await Install.findOne({ chromeId });
        if (install) {
          install.email = email;
          install.userId = user._id;
          install.registered = true;
          await install.save();
          console.log(`[Auth][REGISTER] Linked Chrome install ${chromeId} to user ${email}`);
        }
      } catch (e) {
        console.error('[Auth][REGISTER] Error linking Chrome install:', e);
      }
    }

    // Broadcast new user to admins
    if (isNewUser) {
      try {
        const eventsService = require('../services/events.service');
        eventsService.broadcastToAdmins('new_user', {
          _id: user._id, email: user.email, plan: user.plan, isPro: user.isPro,
          isAdmin: user.isAdmin, role: user.role || 'user', adminStatus: user.adminStatus || 'none',
          verified: user.verified, createdAt: user.createdAt || new Date()
        });
      } catch (e) {
        console.warn('[Auth][REGISTER] Failed to broadcast new user:', e.message);
      }
    }

    // Send verification email
    emailService.sendVerificationEmail(email, verificationToken).catch(e => console.error('Verification email failed', e));
    
    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created. Verification link sent to your email.' : 'Verification link sent to your email.',
      requiresVerification: true,
      email: user.email,
      isNewUser
    });
  } catch (error) {
    console.error('[Auth][REGISTER] Register error:', error);
    return res.status(500).json({ error: 'Server error during authentication request' });
  }
};

// Helper function to link device to user
async function linkDeviceToUser(user, deviceId) {
  if (!user.devices) user.devices = [];
  
  console.log(`[Auth][LINK_DEVICE] Linking device ${deviceId} to user ${user.email}`);
  
  // Check if device already exists
  const existingDevice = user.devices.find(d => d.deviceId === deviceId);
  if (existingDevice) {
    existingDevice.lastSeen = new Date();
    existingDevice.isActive = true;
    existingDevice.installCount += 1;
    console.log(`[Auth][LINK_DEVICE] Updated existing device, install count: ${existingDevice.installCount}`);
  } else {
    user.devices.push({
      deviceId,
      deviceName: `Device ${user.devices.length + 1}`,
      platform: 'chrome',
      installDate: new Date(),
      lastSeen: new Date(),
      isActive: true,
      installCount: 1,
      version: '1.0.0'
    });
    console.log(`[Auth][LINK_DEVICE] Added new device to user`);
  }
  
  // Update device model for fraud prevention
  try {
    const Device = require('../models/device.model');
    let deviceRecord = await Device.findOne({ deviceId });
    if (!deviceRecord) {
      deviceRecord = await Device.create({ 
        deviceId, 
        emailsUsed: [user.email],
        trialUsed: user.trialUsed || false
      });
      console.log(`[Auth][LINK_DEVICE] Created new device record`);
    } else if (!deviceRecord.emailsUsed.includes(user.email)) {
      deviceRecord.emailsUsed.push(user.email);
      await deviceRecord.save();
      console.log(`[Auth][LINK_DEVICE] Updated device record with new email`);
    }
  } catch (e) {
    console.error('[Auth][LINK_DEVICE] Error updating device record:', e);
  }
}

exports.login = async (req, res) => {
  try {
    console.log('[AUDIT][LOGIN] Entry - Request body keys:', Object.keys(req.body));
    let { email, password } = req.body;
    console.log('[AUDIT][LOGIN] Email provided:', !!email, 'Password provided:', !!password);
    if (!email) return res.status(400).json({ error: 'Email is required' });
    email = email.toLowerCase().trim();
    console.log('[AUDIT][LOGIN] Normalized email:', email);

    const user = await User.findOne({ email });
    console.log('[AUDIT][LOGIN] User found:', !!user, 'ID:', user?._id);
    if (user && (await user.comparePassword(password))) {
      console.log('[AUDIT][LOGIN] Password match: true, user.verified:', user.verified, 'user.isAdmin:', user.isAdmin);
      
      // ENFORCE VERIFICATION (Anti-Abuse Phase)
      // Existing verified users can always login
      // New unverified users (created after anti-abuse) must verify first
      if (!user.verified && !user.isAdmin) {
        console.log('[AUDIT][LOGIN] Verification required - user not verified and not admin');
        return res.status(401).json({ 
          error: 'email_not_verified', 
          message: 'Please verify your email address to access your account. Check your inbox for a verification link.',
          email: user.email,
          requiresVerification: true
        });
      }

      // OWNER RESCUE LOGIC - Ensure super admin is always accessible
      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'okparadaniel79@gmail.com';
      if (user.email === superAdminEmail) {
        if (!user.isAdmin || user.role !== 'super_admin') {
           user.isAdmin = true;
           user.role = 'super_admin';
           user.adminStatus = 'approved';
           console.log(`[Rescue] Ensured Super Admin: ${user.email}`);
           await user.save();
        }
      }

      user.lastLogin = new Date();
      await user.save();
      console.log('[AUDIT][LOGIN] User lastLogin updated');

      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      console.log('[AUDIT][LOGIN] accessToken generated (length:', accessToken.length, ')');
      console.log('[AUDIT][LOGIN] refreshToken generated (length:', refreshToken.length, ')');
      setRefreshTokenCookie(res, refreshToken);
      console.log('[AUDIT][LOGIN] Refresh token cookie set');

      console.log('[AUDIT][LOGIN] Response: _id=', user._id, 'email=', user.email, 'accessToken included: true', 'refreshToken included: true');
      return res.json({
        _id: user._id, 
        email: user.email, 
        isPro: user.isPro, 
        isAdmin: user.isAdmin, 
        role: user.role || 'user',
        adminStatus: user.adminStatus || 'none',
        plan: user.plan,
        accessToken, 
        refreshToken, 
        verified: user.verified
      });
    } else {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Login error', error);
    return res.status(500).json({ error: 'Server error during login' });
  }
};

exports.requestEmailChange = async (req, res) => {
  try {
    console.log('[AUDIT][EMAIL_CHANGE] Entry');
    console.log('[AUDIT][EMAIL_CHANGE] req.user exists:', !!req.user, 'req.user.id:', req.user?.id);
    if (!req.user || !req.user.id) {
      console.log('[AUDIT][EMAIL_CHANGE] No req.user.id - returning 401');
      return res.status(401).json({ error: 'Session required' });
    }

    const payloadEmail = req.body && (req.body.newEmail || req.body.email);
    const queryEmail = req.query && (req.query.newEmail || req.query.email);
    const incomingEmail = String(payloadEmail || queryEmail || '').trim();
    console.log('[AUDIT][EMAIL_CHANGE] payloadEmail:', payloadEmail, 'queryEmail:', queryEmail, 'incomingEmail:', incomingEmail);

    if (!incomingEmail) {
      console.log('[AUDIT][EMAIL_CHANGE] No incoming email - returning 400');
      return res.status(400).json({ error: 'New email is required' });
    }

    const normalizedEmail = incomingEmail.toLowerCase();
    console.log('[AUDIT][EMAIL_CHANGE] Normalized email:', normalizedEmail);
    if (!validator.isEmail(normalizedEmail)) {
      console.log('[AUDIT][EMAIL_CHANGE] Invalid email format - returning 400');
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (isDisposableEmail(normalizedEmail)) {
      console.log('[AUDIT][EMAIL_CHANGE] Disposable email - returning 400');
      return res.status(400).json({ error: 'Disposable email addresses are not allowed' });
    }

    const emailTaken = await User.findOne({ email: normalizedEmail });
    console.log('[AUDIT][EMAIL_CHANGE] Email already in use check:', !!emailTaken, 'takenByDifferentUser:', emailTaken && String(emailTaken._id) !== String(req.user.id));
    if (emailTaken && String(emailTaken._id) !== String(req.user.id)) {
      console.log('[AUDIT][EMAIL_CHANGE] Email taken by different user - returning 400');
      return res.status(400).json({ error: 'Email already in use' });
    }

    const user = await User.findById(req.user.id);
    console.log('[AUDIT][EMAIL_CHANGE] User found by req.user.id:', !!user, 'current email:', user?.email);
    if (!user) {
      console.log('[AUDIT][EMAIL_CHANGE] User not found - returning 404');
      return res.status(404).json({ error: 'User not found' });
    }

    const oldEmail = user.email;
    console.log('[AUDIT][EMAIL_CHANGE] Changing email from', oldEmail, 'to', normalizedEmail);
    
    // Preserve all trial and subscription history
    const preservedFields = {
      trialUsed: user.trialUsed,
      trialActive: user.trialActive,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,
      trialDurationDays: user.trialDurationDays,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionStartedAt: user.subscriptionStartedAt,
      subscriptionEndsAt: user.subscriptionEndsAt,
      subscriptionCancelledAt: user.subscriptionCancelledAt,
      subscriptionPlan: user.subscriptionPlan,
      plan: user.plan,
      isPro: user.isPro,
      devices: user.devices,
      templates: user.templates,
      features: user.features,
      creditsUsed: user.creditsUsed,
      dailyUsage: user.dailyUsage,
      lastUsageReset: user.lastUsageReset,
      fraudFlags: user.fraudFlags,
      metadata: user.metadata
    };
    
    // Update email while preserving all history
    user.email = normalizedEmail;
    user.verified = true;
    user.pendingEmail = null;
    user.pendingEmailToken = null;
    user.pendingEmailExpires = null;
    
    // Add email history entry
    user.emailHistory.push({ 
      oldEmail, 
      newEmail: normalizedEmail, 
      changedAt: new Date(),
      changedBy: 'user'
    });
    
    // Restore all preserved fields
    Object.assign(user, preservedFields);
    
    await user.save();
    console.log('[AUDIT][EMAIL_CHANGE] Database update successful - user saved');

    console.log(`[Auth] Email changed immediately for authenticated user: ${oldEmail} -> ${normalizedEmail} (User: ${user._id})`);

    // Generate a fresh access token and set refresh cookie so the extension stays authenticated
    try {
      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      console.log('[AUDIT][EMAIL_CHANGE] New tokens generated - accessToken length:', accessToken.length, 'refreshToken length:', refreshToken.length);
      setRefreshTokenCookie(res, refreshToken);
      console.log('[AUDIT][EMAIL_CHANGE] New refresh cookie set');

      // Broadcast updated user to admins so admin UI can sync
      try {
        const eventsService = require('../services/events.service');
        console.log('[AUDIT][EMAIL_CHANGE] Broadcasting user_updated to admins');
        eventsService.broadcastToAdmins('user_updated', {
          _id: user._id,
          email: user.email,
          plan: user.plan,
          isPro: user.isPro,
          verified: user.verified,
          trialUsed: user.trialUsed,
          subscriptionStatus: user.subscriptionStatus,
          updatedAt: new Date()
        });
        console.log('[AUDIT][EMAIL_CHANGE] Broadcast successful');
      } catch (e) {
        console.warn('[Warning] Failed to broadcast user update:', e.message);
      }

      console.log('[AUDIT][EMAIL_CHANGE] Response: success=true, email=', user.email, 'verified=', user.verified, 'accessToken included: true');
      return res.json({ 
        success: true, 
        message: 'Email updated successfully',
        email: user.email,
        verified: user.verified,
        trialUsed: user.trialUsed,
        subscriptionStatus: user.subscriptionStatus,
        plan: user.plan,
        accessToken
      });
    } catch (err) {
      console.error('[CRITICAL] Token generation failed after email change', err);
      return res.status(500).json({ error: 'Failed to refresh authentication after email change' });
    }
  } catch (error) {
    console.error('[CRITICAL] Email update failure:', error);
    return res.status(500).json({ error: 'Server error updating email' });
  }
};

exports.confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const user = await User.findOne({ 
      pendingEmailToken: token,
      pendingEmailExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired confirmation link' });

    const oldEmail = user.email;
    const newEmail = user.pendingEmail;
    user.email = newEmail;
    user.verified = true;
    user.pendingEmail = null;
    user.pendingEmailToken = null;
    user.pendingEmailExpires = null;
    user.emailHistory.push({ oldEmail, newEmail, changedAt: new Date() });
    
    await user.save();

    console.log(`[Auth] Email confirmed: ${oldEmail} -> ${newEmail}`);
    return res.json({ success: true, message: 'Email updated successfully' });
  } catch (error) {
    console.error('Confirm email change error', error);
    return res.status(500).json({ error: 'Failed to confirm email change' });
  }
};

exports.wipeMyAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    await User.findByIdAndDelete(req.user.id);
    return res.json({ message: 'Account permanently deleted' });
  } catch (error) {
    console.error('Wipe error', error);
    return res.status(500).json({ error: 'Failed to wipe account' });
  }
};

exports.getAccountStatus = async (req, res) => {
  try {
    const { email, deviceId } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      return res.json({
        exists: false,
        message: 'Account not found'
      });
    }
    
    // Link device if provided
    if (deviceId) {
      await linkDeviceToUser(user, deviceId);
      await user.save();
    }
    
    // Calculate trial status
    const trialActive = user.trialActive && user.trialEndsAt && new Date() < user.trialEndsAt;
    const trialExpired = user.trialEndsAt && new Date() > user.trialEndsAt;
    
    // Calculate subscription status
    const subscriptionActive = user.subscriptionStatus === 'active' && 
                            user.subscriptionEndsAt && 
                            new Date() < user.subscriptionEndsAt;
    const subscriptionExpired = user.subscriptionEndsAt && new Date() > user.subscriptionEndsAt;
    
    // Determine what action to show
    let action = 'upgrade'; // default
    if (subscriptionActive) {
      action = 'manage';
    } else if (!user.trialUsed && !subscriptionActive) {
      action = 'start_trial';
    } else if (user.trialUsed && !subscriptionActive) {
      action = 'upgrade';
    }
    
    return res.json({
      exists: true,
      email: user.email,
      verified: user.verified,
      accountStatus: user.accountStatus,
      
      // Trial information
      trialUsed: !!user.trialUsed,
      trialActive: trialActive,
      trialExpired: trialExpired,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,
      trialDurationDays: user.trialDurationDays || 3,
      
      // Subscription information
      subscriptionStatus: user.subscriptionStatus,
      subscriptionActive: subscriptionActive,
      subscriptionExpired: subscriptionExpired,
      subscriptionStartedAt: user.subscriptionStartedAt,
      subscriptionEndsAt: user.subscriptionEndsAt,
      subscriptionCancelledAt: user.subscriptionCancelledAt,
      subscriptionPlan: user.subscriptionPlan,
      
      // Plan information
      plan: user.plan,
      isPro: user.isPro || user.plan === 'pro',
      
      // Device information
      devices: user.devices || [],
      currentDevice: deviceId ? user.devices.find(d => d.deviceId === deviceId) : null,
      
      // Action to show
      action: action,
      
      // Metadata
      createdAt: user.createdAt,
      lastActive: user.lastActive,
      lastLogin: user.lastLogin
    });
  } catch (error) {
    console.error('Get account status error:', error);
    return res.status(500).json({ error: 'Failed to retrieve account status' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Session required' });
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Ensure response includes all fields needed by extension for sync
    return res.json({
      _id: user._id,
      email: user.email,
      plan: user.plan,
      isPro: user.isPro || user.plan === 'pro',
      subscriptionStatus: user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      verified: user.verified,
      isAdmin: user.isAdmin,
      role: user.role || 'user',
      creditsUsed: user.creditsUsed || 0,
      dailyUsage: user.dailyUsage || 0,
      createdAt: user.createdAt,
      // Feature flags
      features: user.features || {
        styleLearning: true,
        autoFollowUp: true,
        aiReply: true,
        improveMessage: true
      }
    });
  } catch (error) {
    console.error('Profile fetch error', error);
    return res.status(500).json({ error: 'Server error fetching profile' });
  }
};

exports.syncTemplates = async (req, res) => {
  try {
    const { templates } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.templates = templates;
    await user.save();
    return res.json({ message: 'Templates synced', templates: user.templates });
  } catch (err) {
    console.error('Sync templates error', err);
    return res.status(500).json({ error: 'Failed to sync templates' });
  }
};

exports.getTemplates = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ templates: user.templates || [] });
  } catch (err) {
    console.error('Get templates error', err);
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }
};

exports.refresh = async (req, res) => {
  try {
    console.log('[AUDIT][REFRESH] Entry');
    const hasCookie = !!req.cookies.refreshToken;
    const hasBody = !!req.body.refreshToken;
    console.log('[AUDIT][REFRESH] hasCookie:', hasCookie, 'hasBody:', hasBody);
    console.log('[AUDIT][REFRESH] Cookie value (first 20 chars):', req.cookies.refreshToken ? req.cookies.refreshToken.substring(0, 20) + '...' : 'none');
    console.log('[AUDIT][REFRESH] Body value (first 20 chars):', req.body.refreshToken ? req.body.refreshToken.substring(0, 20) + '...' : 'none');
    
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      console.log('[AUDIT][REFRESH] No refresh token provided - returning 401');
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET || 'refresh_secret_production_key_2026', async (err, decoded) => {
      if (err) {
        console.log('[AUDIT][REFRESH] JWT verify failed:', err.message, '- returning 403');
        return res.status(403).json({ error: 'Invalid or expired refresh token' });
      }
      console.log('[AUDIT][REFRESH] JWT verify succeeded - userId resolved:', decoded.id);
      const user = await User.findById(decoded.id);
      console.log('[AUDIT][REFRESH] User found by ID:', !!user, 'ID:', user?._id);
      if (!user) {
        console.log('[AUDIT][REFRESH] User not found - returning 404');
        return res.status(404).json({ error: 'User not found' });
      }
      const newAccessToken = generateToken(user);
      console.log('[AUDIT][REFRESH] New JWT generated (length:', newAccessToken.length, ') - returning success');
      return res.json({ accessToken: newAccessToken });
    });
  } catch (err) {
    console.error('[AUDIT][REFRESH] Refresh error:', err);
    return res.status(500).json({ error: 'Server error during refresh' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    console.log('[AUDIT][VERIFY] Entry - Query keys:', Object.keys(req.query));
    const { token, email, deviceId } = req.query;
    console.log('[AUDIT][VERIFY] Token provided:', !!token, 'Email provided:', !!email, 'DeviceId provided:', !!deviceId);
    if (!token) return res.status(400).json({ error: 'Token required' });

    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
      console.log('[AUDIT][VERIFY] User found by email:', !!user, 'ID:', user?._id);
    }

    if (!user) {
      user = await User.findOne({ verificationToken: token });
      console.log('[AUDIT][VERIFY] User found by token:', !!user, 'ID:', user?._id);
    }

    if (!user) {
      console.log('[AUDIT][VERIFY] User not found - returning 400');
      return res.status(400).json({ error: 'User not found' });
    }

    // If already verified, return account status with tokens for auto-login
    if (user.verified) {
      console.log('[AUDIT][VERIFY] User already verified - returning account status with tokens');
      
      // Link device if provided
      if (deviceId) {
        await linkDeviceToUser(user, deviceId);
        await user.save();
      }
      
      // Update last active
      user.lastActive = new Date();
      user.lastLogin = new Date();
      await user.save();
      
      // Generate tokens for automatic login
      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      setRefreshTokenCookie(res, refreshToken);
      
      console.log(`[Auth][VERIFY] Auto-login for already verified user: ${user.email} (ID: ${user._id})`);
      
      // Return comprehensive account status with tokens
      return res.json({ 
        success: true, 
        message: 'Email already verified. Account restored.',
        verified: true,
        isNewUser: false,
        _id: user._id, 
        email: user.email, 
        isPro: user.isPro || user.plan === 'pro', 
        isAdmin: user.isAdmin, 
        role: user.role || 'user',
        adminStatus: user.adminStatus || 'none',
        plan: user.plan,
        trialUsed: !!user.trialUsed,
        trialActive: user.trialActive && user.trialEndsAt && new Date() < user.trialEndsAt,
        trialEndsAt: user.trialEndsAt,
        subscriptionStatus: user.subscriptionStatus || 'inactive',
        subscriptionEndsAt: user.subscriptionEndsAt,
        accountStatus: user.accountStatus || 'active',
        devices: user.devices || [],
        accessToken, 
        refreshToken
      });
    }

    if (user.verificationToken !== token) {
      console.log('[AUDIT][VERIFY] Token mismatch - returning 400');
      return res.status(400).json({ error: 'Invalid verification token' });
    }
    
    // Check if token is expired
    if (user.verificationExpires && new Date() > user.verificationExpires) {
      console.log('[AUDIT][VERIFY] Token expired - returning 400');
      return res.status(400).json({ error: 'Verification token has expired. Please request a new one.' });
    }
    
    // Verify the user
    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    user.lastActive = new Date();
    user.lastLogin = new Date();
    
    // Link device if provided
    if (deviceId) {
      await linkDeviceToUser(user, deviceId);
    }
    
    await user.save();
    
    console.log(`[Auth][VERIFY] Email verified: ${user.email} (ID: ${user._id})`);
    
    // Generate tokens for automatic login
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshToken);
    
    // Broadcast new verified user to admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.broadcastToAdmins('user_verified', {
        _id: user._id,
        email: user.email,
        plan: user.plan,
        isPro: user.isPro,
        verifiedAt: new Date()
      });
    } catch (e) {
      console.warn('[Warning] Failed to broadcast user verification:', e.message);
    }
    
    console.log(`[Auth][VERIFY] Auto-login after verification: ${user.email} (ID: ${user._id})`);
    
    // Return comprehensive account status with tokens for auto-login
    return res.json({ 
      success: true, 
      message: 'Email verified successfully',
      verified: true,
      isNewUser: true,
      _id: user._id, 
      email: user.email, 
      isPro: user.isPro || user.plan === 'pro', 
      isAdmin: user.isAdmin, 
      role: user.role || 'user',
      adminStatus: user.adminStatus || 'none',
      plan: user.plan,
      trialUsed: !!user.trialUsed,
      trialActive: user.trialActive && user.trialEndsAt && new Date() < user.trialEndsAt,
      trialEndsAt: user.trialEndsAt,
      subscriptionStatus: user.subscriptionStatus || 'inactive',
      subscriptionEndsAt: user.subscriptionEndsAt,
      accountStatus: user.accountStatus || 'active',
      devices: user.devices || [],
      accessToken, 
      refreshToken
    });
  } catch (error) {
    console.error('Verify error', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    let { email, token } = req.body;

    if (!email && !token) {
      return res.status(400).json({ error: 'Email or verification token is required' });
    }

    let user;
    if (token) {
      user = await User.findOne({ verificationToken: token });
    }

    if (!user && email) {
      email = email.toLowerCase().trim();
      if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
      if (isDisposableEmail(email)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });
      user = await User.findOne({ email });
    }
    
    // Create user if they don't exist (Extension-First Flow)
    if (!user) {
      const verificationToken = crypto.randomBytes(16).toString('hex');
      user = await User.create({ 
        email, 
        password: crypto.randomBytes(16).toString('hex'),
        verified: false,
        role: 'user',
        adminStatus: 'none',
        plan: 'free',
        verificationToken,
        verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });

      // Verify the user was actually saved
      const savedUser = await User.findOne({ email });
      if (!savedUser) {
        console.error(`[CRITICAL] Extension user creation failed: ${email}`);
        return res.status(500).json({ error: 'Failed to create user account. Please try again.' });
      }

      await emailService.sendVerificationEmail(email, verificationToken);
      console.log(`[Auth] New user created via extension flow: ${email} (ID: ${user._id})`);
      
      // Broadcast to admins via SSE
      try {
        const eventsService = require('../services/events.service');
        eventsService.broadcastToAdmins('new_user', {
          _id: user._id,
          email: user.email,
          plan: user.plan,
          isPro: user.isPro,
          isAdmin: user.isAdmin,
          role: user.role || 'user',
          adminStatus: user.adminStatus || 'none',
          verified: user.verified,
          createdAt: user.createdAt || new Date()
        });
      } catch (e) {
        console.warn('[Warning] Failed to broadcast new_user SSE', e.message);
      }
      
      return res.json({ message: 'Verification email sent', _id: user._id });
    }

    if (user.verified) return res.status(400).json({ error: 'Email already verified' });

    const verificationToken = crypto.randomBytes(16).toString('hex');
    user.verificationToken = verificationToken;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    await emailService.sendVerificationEmail(user.email, verificationToken);
    return res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend verification error', error);
    return res.status(500).json({ error: 'Server error resending verification' });
  }
};

exports.updateFeatures = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Session required' });
    
    const { features } = req.body;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'Features object is required' });
    }
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Only update allowed features
    const allowedFeatures = ['styleLearning', 'autoFollowUp', 'aiReply', 'improveMessage'];
    allowedFeatures.forEach(feature => {
      if (feature in features) {
        user.features[feature] = features[feature];
      }
    });
    
    await user.save();
    
    console.log(`[Auth] User features updated: ${user.email}`, user.features);
    
    // Broadcast feature change to admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.notifyEmail(user.email, {
        email: user.email,
        features: user.features
      });
    } catch (e) {
      console.warn('[Warning] Failed to broadcast feature update:', e.message);
    }
    
    return res.json({ 
      success: true, 
      message: 'Features updated', 
      features: user.features 
    });
  } catch (error) {
    console.error('Update features error', error);
    return res.status(500).json({ error: 'Server error updating features' });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Authentication required' });
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const email = user.email;
    console.log(`[Auth] Deleting user account: ${email}`);
    
    await User.findByIdAndDelete(req.user.id);
    
    console.log(`[Auth] User account deleted successfully: ${email}`);
    
    return res.json({ 
      success: true, 
      message: 'Account deleted successfully' 
    });
  } catch (error) {
    console.error('Delete account error', error);
    return res.status(500).json({ error: 'Server error deleting account' });
  }
};

exports.getFeatureMatrix = async (req, res) => {
  try {
    const features = require('../config/features');
    
    // If user is authenticated, include their personal feature overrides
    if (req.user && req.user.id) {
      const user = await User.findById(req.user.id);
      if (user) {
        return res.json({
          matrix: features.featureMatrix,
          userPlan: user.plan,
          userFeatures: user.features || features.getFeatures(user.plan),
          proBadgeFeatures: features.getProBadgeFeatures()
        });
      }
    }
    
    // Return public matrix
    return res.json({
      matrix: features.featureMatrix,
      proBadgeFeatures: features.getProBadgeFeatures()
    });
  } catch (error) {
    console.error('Get feature matrix error', error);
    return res.status(500).json({ error: 'Server error fetching features' });
  }
};

exports.getExtensionLinks = async (req, res) => {
  try {
    const links = require('../config/extension-links');
    return res.json({
      links: links.getAllLinks(),
      primary: links.getInstallLink('chrome'),
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Get extension links error', error);
    return res.status(500).json({ error: 'Server error fetching links' });
  }
};


exports.startTrial = async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID is required' });
    
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Authentication required' });
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    console.log(`[Auth][START_TRIAL] Trial request for user: ${user.email} (ID: ${user._id})`);
    console.log(`[Auth][START_TRIAL] User trialUsed: ${user.trialUsed}, deviceId: ${deviceId}`);
    
    // Check if trial already used at account level (permanent flag)
    if (user.trialUsed) {
      console.log(`[Auth][START_TRIAL] Trial already used by email: ${user.email}`);
      return res.status(403).json({ 
        success: false, 
        error: 'TRIAL_ALREADY_USED', 
        message: 'This email has already used a free trial.' 
      });
    }
    
    // Check device-level trial usage for fraud prevention
    try {
      const Device = require('../models/device.model');
      let deviceRecord = await Device.findOne({ deviceId });
      
      console.log(`[Auth][START_TRIAL] Device record found: ${!!deviceRecord}`);
      
      if (deviceRecord && deviceRecord.trialUsed) {
        console.log(`[Auth][START_TRIAL] Device trial used, checking email history`);
        // Check if this device has been used with this email before
        const emailUsedOnDevice = deviceRecord.emailsUsed && deviceRecord.emailsUsed.includes(user.email);
        console.log(`[Auth][START_TRIAL] Email used on device before: ${emailUsedOnDevice}`);
        
        if (!emailUsedOnDevice) {
          console.log(`[Auth][START_TRIAL] Trial abuse detected - device used with different email`);
          return res.status(403).json({ 
            success: false, 
            error: 'DEVICE_TRIAL_USED', 
            message: 'A free trial has already been used on this device with a different email.' 
          });
        }
      }
      
      if (!deviceRecord) {
        console.log(`[Auth][START_TRIAL] Creating new device record for trial`);
        deviceRecord = await Device.create({ 
          deviceId, 
          emailsUsed: [user.email],
          trialUsed: true
        });
      } else {
        console.log(`[Auth][START_TRIAL] Updating existing device record for trial`);
        deviceRecord.trialUsed = true;
        if (!deviceRecord.emailsUsed) deviceRecord.emailsUsed = [];
        if (!deviceRecord.emailsUsed.includes(user.email)) {
          deviceRecord.emailsUsed.push(user.email);
        }
        
        // Add trial history
        if (!deviceRecord.trialHistory) deviceRecord.trialHistory = [];
        deviceRecord.trialHistory.push({
          email: user.email,
          grantedAt: new Date(),
          trialDurationDays: user.trialDurationDays || 3
        });
        
        await deviceRecord.save();
      }
    } catch (e) {
      console.error('[Auth][START_TRIAL] Device tracking error:', e);
      // Continue with trial activation even if device tracking fails
    }
    
    // Grant trial at account level (permanent flag)
    user.trialUsed = true; // Permanent flag - NEVER reset
    user.trialActive = true;
    user.plan = 'trial';
    user.trialStartedAt = new Date();
    user.trialEndsAt = new Date(Date.now() + (user.trialDurationDays || 3) * 24 * 60 * 60 * 1000);
    user.lastActive = new Date();
    
    // Set new trial protection fields
    user.firstTrialDeviceId = deviceId;
    user.trialGrantedAt = new Date();
    user.trialGrantReason = 'user_requested';
    
    await user.save();
    
    console.log(`[Auth][START_TRIAL] Trial activated for user: ${user.email} (ID: ${user._id})`);
    console.log(`[Auth][START_TRIAL] Trial ends at: ${user.trialEndsAt}`);
    
    // Broadcast trial activation to admins
    try {
      const eventsService = require('../services/events.service');
      eventsService.broadcastToAdmins('trial_started', {
        _id: user._id,
        email: user.email,
        trialEndsAt: user.trialEndsAt,
        deviceId: deviceId
      });
    } catch (e) {
      console.warn('[Auth][START_TRIAL] Failed to broadcast trial start:', e.message);
    }
    
    return res.json({
      success: true,
      trialActive: true,
      trialUsed: true,
      expiryDate: user.trialEndsAt,
      planType: 'trial',
      trialDurationDays: user.trialDurationDays || 3,
      message: 'Free trial activated successfully.'
    });
  } catch (error) {
    console.error('[Auth][START_TRIAL] Start trial error:', error);
    return res.status(500).json({ error: 'Failed to start trial' });
  }
};

exports.licenseStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Authentication required' });
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Calculate trial status
    const trialActive = user.trialActive && user.trialEndsAt && new Date() < user.trialEndsAt;
    const trialExpired = user.trialEndsAt && new Date() > user.trialEndsAt;
    
    // Calculate subscription status
    const subscriptionActive = user.subscriptionStatus === 'active' && 
                            user.subscriptionEndsAt && 
                            new Date() < user.subscriptionEndsAt;
    const subscriptionExpired = user.subscriptionEndsAt && new Date() > user.subscriptionEndsAt;
    
    // Determine current plan status
    let currentPlan = 'free';
    let planStatus = 'inactive';
    
    if (subscriptionActive) {
      currentPlan = 'pro';
      planStatus = 'active';
    } else if (trialActive) {
      currentPlan = 'trial';
      planStatus = 'active';
    } else if (user.plan === 'pro') {
      currentPlan = 'pro';
      planStatus = subscriptionExpired ? 'expired' : 'inactive';
    } else if (user.plan === 'trial') {
      currentPlan = 'trial';
      planStatus = trialExpired ? 'expired' : 'inactive';
    }
    
    return res.json({
      // Current status
      currentPlan: currentPlan,
      planStatus: planStatus,
      isPro: user.isPro || currentPlan === 'pro',
      
      // Trial information
      trialActive: trialActive,
      trialUsed: !!user.trialUsed,
      trialExpired: trialExpired,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,
      trialDurationDays: user.trialDurationDays || 3,
      
      // Subscription information
      subscriptionStatus: user.subscriptionStatus,
      subscriptionActive: subscriptionActive,
      subscriptionExpired: subscriptionExpired,
      subscriptionStartedAt: user.subscriptionStartedAt,
      subscriptionEndsAt: user.subscriptionEndsAt,
      subscriptionCancelledAt: user.subscriptionCancelledAt,
      subscriptionPlan: user.subscriptionPlan,
      
      // Account information
      email: user.email,
      accountStatus: user.accountStatus,
      verified: user.verified,
      
      // Device information
      devices: user.devices || [],
      
      // Action to show
      action: subscriptionActive ? 'manage' : (!user.trialUsed ? 'start_trial' : 'upgrade')
    });
  } catch (error) {
    console.error('License status error:', error);
    return res.status(500).json({ error: 'Failed to retrieve license status' });
  }
};

