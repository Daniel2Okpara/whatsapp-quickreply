const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const validator = require('validator');
const emailService = require('../services/email.service');

// Simple disposable email detection
const isDisposableEmail = (email) => {
  const disposableDomains = ['yopmail.com', 'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'temp-mail.org'];
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

    // Initial Admin Logic
    const adminCount = await User.countDocuments({ isAdmin: true });
    const isAdmin = adminCount === 0;

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = await User.create({ 
      email, password, isAdmin,
      verificationToken,
      verificationExpires: new Date(Date.now() + 15 * 60 * 1000)
    });

    // Attempt verification email in background
    emailService.sendVerificationEmail(email, verificationToken).catch(e => console.error('Verification email failed', e));
    
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshToken);

    return res.status(201).json({
      message: 'Registration successful',
      _id: user._id, email: user.email, isPro: user.isPro, isAdmin: user.isAdmin, plan: user.plan,
      accessToken, refreshToken
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
        accessToken, refreshToken
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

    // Instant Email Change (Rollback Phase)
    const oldEmail = user.email;
    user.email = newEmail;
    user.emailHistory.push({ oldEmail, newEmail, changedAt: new Date() });
    await user.save();

    console.log(`[Auth] Email updated: ${oldEmail} -> ${newEmail}`);
    return res.json({ success: true, message: 'Email updated successfully', email: user.email });
  } catch (error) {
    console.error('[CRITICAL] Email change failure:', error);
    return res.status(500).json({ error: 'Server error updating email: ' + error.message });
  }
};

exports.wipeMyAccount = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Session required' });
    
    const user = await User.findByIdAndDelete(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    console.log(`[Wipe] Account deleted: ${user.email}`);
    return res.json({ success: true, message: 'Account wiped successfully. You can now register as a new user.' });
  } catch (error) {
    console.error('Wipe error', error);
    return res.status(500).json({ error: 'Failed to wipe account' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Session required' });
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
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
    const user = await User.findOne({ email: email.toLowerCase(), verificationToken: token });
    if (!user) return res.status(400).json({ error: 'Invalid verification' });
    user.verified = true;
    user.verificationToken = null;
    await user.save();
    return res.json({ message: 'Verified successfully' });
  } catch (error) {
    console.error('Verify error', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
};
