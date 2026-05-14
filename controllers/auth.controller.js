const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const validator = require('validator');
const emailService = require('../services/email.service');

// Simple disposable email detection (can be expanded)
const isDisposableEmail = (email) => {
  const disposableDomains = ['yopmail.com', 'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com'];
  const domain = email.split('@')[1];
  return disposableDomains.includes(domain);
};

// Helper to generate JWTs
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'super_secret_production_key_2026', {
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
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    email = email.toLowerCase().trim();

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (isDisposableEmail(email)) {
      return res.status(400).json({ error: 'Disposable email addresses are not allowed' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const adminCount = await User.countDocuments({ isAdmin: true });
    const isAdmin = adminCount === 0;

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    const user = await User.create({ 
      email, 
      password, 
      isAdmin,
      verificationToken,
      verificationExpires
    });

    // Send verification email
    try {
      await emailService.sendVerificationEmail(email, verificationToken);
    } catch (err) {
      console.error('Email sending failed during registration', err);
      // We still created the user, they can request a resend later
    }

    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      email: user.email
    });
  } catch (error) {
    console.error('Registration error', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (user && (await user.comparePassword(password))) {
      
      if (!user.verified && !user.isAdmin) {
        return res.status(403).json({ 
          error: 'Email not verified', 
          requiresVerification: true,
          email: user.email
        });
      }

      user.lastLogin = new Date();
      await user.save();

      const accessToken = generateToken(user._id);
      const refreshToken = generateRefreshToken(user._id);
      setRefreshTokenCookie(res, refreshToken);

      res.json({
        _id: user._id,
        email: user.email,
        isPro: user.isPro,
        isAdmin: user.isAdmin,
        plan: user.plan,
        verified: user.verified,
        accessToken,
        refreshToken
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) return res.status(400).json({ error: 'Email already verified' });

    // Generate new token
    const token = crypto.randomBytes(32).toString('hex');
    user.verificationToken = token;
    user.verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    await emailService.sendVerificationEmail(user.email, token);

    res.json({ success: true, message: 'Verification email resent' });
  } catch (err) {
    console.error('Resend error', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) return res.status(400).json({ error: 'Token and email are required' });

    const user = await User.findOne({ 
      email: email.toLowerCase(),
      verificationToken: token,
      verificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.verified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();

    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshToken);

    res.json({
      message: 'Email verified successfully',
      _id: user._id,
      email: user.email,
      accessToken,
      refreshToken
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during verification' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    email = email.toLowerCase().trim();
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) return res.status(400).json({ error: 'Email already verified' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    user.verificationToken = verificationToken;
    user.verificationExpires = verificationExpires;
    await user.save();

    await emailService.sendVerificationEmail(email, verificationToken);

    res.json({ message: 'Verification email sent' });
  } catch (error) {
    res.status(500).json({ error: 'Server error resending verification' });
  }
};

exports.requestEmailChange = async (req, res) => {
  try {
    let { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ error: 'New email is required' });
    
    newEmail = newEmail.toLowerCase().trim();
    if (!validator.isEmail(newEmail)) return res.status(400).json({ error: 'Invalid email format' });
    if (isDisposableEmail(newEmail)) return res.status(400).json({ error: 'Disposable email addresses are not allowed' });

    const emailTaken = await User.findOne({ email: newEmail });
    if (emailTaken) return res.status(400).json({ error: 'Email already in use' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    user.verificationToken = verificationToken;
    user.verificationExpires = verificationExpires;
    // We'll store the pending email in a temporary field or just use the token logic
    // For simplicity, we'll just pass the new email in the verification link
    await user.save();

    await emailService.sendEmailChangeVerification(newEmail, verificationToken);

    res.json({ message: 'Confirmation email sent to your new address' });
  } catch (error) {
    res.status(500).json({ error: 'Server error requesting email change' });
  }
};

exports.confirmEmailChange = async (req, res) => {
  try {
    const { token, email } = req.query; // email here is the NEW email
    if (!token || !email) return res.status(400).json({ error: 'Token and email are required' });

    const user = await User.findOne({ 
      verificationToken: token,
      verificationExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired confirmation token' });

    // Ensure email is not taken by someone else in the meantime
    const emailTaken = await User.findOne({ email: email.toLowerCase() });
    if (emailTaken) return res.status(400).json({ error: 'Target email is now in use' });

    user.emailHistory.push({
      oldEmail: user.email,
      newEmail: email.toLowerCase(),
      changedAt: new Date()
    });
    
    user.email = email.toLowerCase();
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();

    res.json({ message: 'Email updated successfully', email: user.email });
  } catch (error) {
    res.status(500).json({ error: 'Server error confirming email change' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching profile' });
  }
};

exports.syncTemplates = async (req, res) => {
  try {
    const { templates } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.templates = templates;
    await user.save();
    res.json({ message: 'Templates synced', templates: user.templates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sync templates' });
  }
};

exports.getTemplates = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ templates: user.templates || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch templates' });
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

      const newAccessToken = generateToken(user._id);
      
      res.json({ accessToken: newAccessToken });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during refresh' });
  }
};
