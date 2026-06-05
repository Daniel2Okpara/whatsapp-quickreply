const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const validator = require('validator');
const emailService = require('../services/email.service');

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
const generateToken = (user) => {
  return jwt.sign({ id: user._id, isAdmin: user.isAdmin, role: user.role || 'user' }, process.env.JWT_SECRET || 'super_secret_production_key_2026', {
    expiresIn: '15m'
  });
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
    console.log('[AUDIT][REGISTER] Entry - Request body keys:', Object.keys(req.body));
    let { email, password } = req.body;
    console.log('[AUDIT][REGISTER] Email provided:', !!email, 'Password provided:', !!password);
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    email = email.toLowerCase().trim();
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(email)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    const userExists = await User.findOne({ email });
    console.log('[AUDIT][REGISTER] User exists check:', !!userExists);
    if (userExists) return res.status(400).json({ error: 'User already exists' });

    const verificationToken = crypto.randomBytes(16).toString('hex');
    console.log('[AUDIT][REGISTER] Creating user with email:', email, 'verificationToken:', verificationToken.substring(0, 8) + '...');
    const user = await User.create({ 
      email, 
      password, 
      isAdmin: false,
      role: 'user',
      adminStatus: 'none',
      verificationToken,
      verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      verified: false,
      plan: 'free'
    });
    console.log('[AUDIT][REGISTER] User created with ID:', user._id);

    // Verify the user was actually saved
    const savedUser = await User.findOne({ email });
    console.log('[AUDIT][REGISTER] Saved user verification:', !!savedUser, 'ID:', savedUser?._id);
    if (!savedUser) {
      console.error(`[CRITICAL] User registration failed to save: ${email}`);
      return res.status(500).json({ error: 'Failed to create account. Please try again.' });
    }

    console.log(`[Auth] User registered and saved: ${email} (ID: ${user._id})`);
    console.log('[AUDIT][REGISTER] Response: requiresVerification=true, email=', email, '_id=', user._id);

    // Attempt verification email in background
    emailService.sendVerificationEmail(email, verificationToken).catch(e => console.error('Verification email failed', e));
    
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

    return res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      requiresVerification: true,
      email: user.email,
      _id: user._id,
      verified: false
    });
  } catch (error) {
    console.error('[Registration error]', error);
    return res.status(500).json({ error: 'Server error during registration' });
  }
};

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
    user.email = normalizedEmail;
    user.verified = true;
    user.pendingEmail = null;
    user.pendingEmailToken = null;
    user.pendingEmailExpires = null;
    user.emailHistory.push({ oldEmail, newEmail: normalizedEmail, changedAt: new Date() });
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

exports.verificationStatus = async (req, res) => {
  try {
    console.log('[AUDIT][VERIFICATION_STATUS] Entry - Query keys:', Object.keys(req.query));
    const { email } = req.query;
    console.log('[AUDIT][VERIFICATION_STATUS] Email provided:', !!email);
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    console.log('[AUDIT][VERIFICATION_STATUS] User found:', !!user, 'ID:', user?._id, 'verified:', user?.verified);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.verified) {
      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      console.log('[AUDIT][VERIFICATION_STATUS] Tokens generated - accessToken length:', accessToken.length, 'refreshToken length:', refreshToken.length);
      console.log('[AUDIT][VERIFICATION_STATUS] Response: verified=true, _id=', user._id, 'email=', user.email, 'accessToken included: true', 'refreshToken included: true');
      return res.json({
        verified: true,
        _id: user._id, email: user.email, isPro: user.isPro, isAdmin: user.isAdmin, plan: user.plan,
        accessToken, refreshToken
      });
    }
    
    console.log('[AUDIT][VERIFICATION_STATUS] Response: verified=false');
    return res.json({ verified: false });
  } catch (error) {
    console.error('Status error', error);
    return res.status(500).json({ error: 'Status check failed' });
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
    const { token, email } = req.query;
    console.log('[AUDIT][VERIFY] Token provided:', !!token, 'Email provided:', !!email);
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

    // If already verified, just return success
    if (user.verified) {
      console.log('[AUDIT][VERIFY] User already verified - returning success');
      return res.json({ success: true, message: 'Email is already verified' });
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
    
    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();
    
    console.log(`[Auth] Email verified: ${user.email}`);
    console.log('[AUDIT][VERIFY] WARNING: No tokens generated after verifyEmail - user must call verificationStatus');
    
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
    
    return res.json({ success: true, message: 'Email verified successfully' });
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
