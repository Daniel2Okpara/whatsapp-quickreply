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
  return jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET || 'super_secret_production_key_2026', {
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
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

exports.register = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    email = email.toLowerCase().trim();
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(email)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ error: 'User already exists' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = await User.create({ 
      email, password, isAdmin: false,
      verificationToken,
      verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    // Attempt verification email in background
    emailService.sendVerificationEmail(email, verificationToken).catch(e => console.error('Verification email failed', e));
    
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshToken);

    return res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      _id: user._id, email: user.email, isPro: user.isPro, isAdmin: user.isAdmin, plan: user.plan,
      accessToken, refreshToken, verified: false
    });
  } catch (error) {
    console.error('Registration error', error);
    return res.status(500).json({ error: 'Server error during registration' });
  }
};

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (user && (await user.comparePassword(password))) {
      
      // ENFORCE VERIFICATION (Anti-Abuse Phase)
      if (!user.verified && !user.isAdmin) {
        return res.status(401).json({ 
          error: 'email_not_verified', 
          message: 'Please verify your email address to access your account.',
          email: user.email 
        });
      }

      // OWNER RESCUE LOGIC
      const adminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.toLowerCase() : null;
      if (adminEmail && user.email === adminEmail) {
        if (!user.isAdmin) {
           user.isAdmin = true;
           console.log(`[Rescue] Promoted owner: ${user.email}`);
        }
      } else {
        const adminCount = await User.countDocuments({ isAdmin: true });
        if (adminCount === 0 && !user.isAdmin) {
          user.isAdmin = true;
          console.log(`[Rescue] Promoted initial admin: ${user.email}`);
        }
      }

      user.lastLogin = new Date();
      await user.save();

      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      setRefreshTokenCookie(res, refreshToken);

      return res.json({
        _id: user._id, email: user.email, isPro: user.isPro, isAdmin: user.isAdmin, plan: user.plan,
        accessToken, refreshToken, verified: user.verified
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
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Session required' });
    
    let { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ error: 'New email is required' });
    
    newEmail = newEmail.toLowerCase().trim();
    if (!validator.isEmail(newEmail)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(newEmail)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    const emailTaken = await User.findOne({ email: newEmail });
    if (emailTaken) return res.status(400).json({ error: 'Email already in use' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Direct Email Update
    const oldEmail = user.email;
    user.email = newEmail;
    await user.save();

    console.log(`[Auth] Direct email update: ${oldEmail} -> ${newEmail}`);
    
    // Return fresh tokens so the extension stays authenticated
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user._id);
    
    return res.json({ 
      success: true, 
      message: 'Email updated successfully.',
      email: user.email,
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('[CRITICAL] Email update failure:', error);
    return res.status(500).json({ error: 'Server error updating email' });
  }
};

exports.confirmEmailChange = async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) return res.status(400).json({ error: 'Token and new email required' });

    const newEmail = email.toLowerCase().trim();
    const user = await User.findOne({ 
      verificationToken: token,
      verificationExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired confirmation link' });

    const oldEmail = user.email;
    user.email = newEmail;
    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
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
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.verified) {
      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user._id);
      return res.json({
        verified: true,
        _id: user._id, email: user.email, isPro: user.isPro, isAdmin: user.isAdmin, plan: user.plan,
        accessToken, refreshToken
      });
    }
    
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
      creditsUsed: user.creditsUsed || 0,
      dailyUsage: user.dailyUsage || 0,
      createdAt: user.createdAt
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
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token provided' });

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET || 'refresh_secret_production_key_2026', async (err, decoded) => {
      if (err) return res.status(403).json({ error: 'Invalid or expired refresh token' });
      const user = await User.findById(decoded.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json({ accessToken: generateToken(user) });
    });
  } catch (err) {
    console.error('Refresh error', err);
    return res.status(500).json({ error: 'Server error during refresh' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) return res.status(400).json({ error: 'Token and email required' });
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(), 
      verificationToken: token 
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });
    
    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();
    
    console.log(`[Auth] Email verified: ${user.email}`);
    return res.json({ success: true, message: 'Verified successfully' });
  } catch (error) {
    console.error('Verify error', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    email = email.toLowerCase().trim();
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(email)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    let user = await User.findOne({ email });
    
    // Create user if they don't exist (Extension-First Flow)
    if (!user) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      user = await User.create({ 
        email, 
        password: crypto.randomBytes(16).toString('hex'),
        verified: false,
        verificationToken,
        verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });
      await emailService.sendVerificationEmail(email, verificationToken);
      console.log(`[Auth] New user created via extension flow: ${email}`);
      return res.json({ message: 'Verification email sent' });
    }

    if (user.verified) return res.status(400).json({ error: 'Email already verified' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    await emailService.sendVerificationEmail(email, verificationToken);
    return res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend verification error', error);
    return res.status(500).json({ error: 'Server error resending verification' });
  }
};
