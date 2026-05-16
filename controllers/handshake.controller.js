const crypto = require('crypto');
const Handshake = require('../models/handshake.model');
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const emailService = require('../services/email.service');

// Reuse auth logic helpers or replicate for brevity if small
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

function genToken(len = 8) {
  return crypto.randomBytes(Math.max(4, len)).toString('hex').slice(0, len);
}

exports.createHandshake = async (req, res) => {
  try {
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase() : null;
    if (!email) return res.status(400).json({ error: 'email_required' });
    const token = genToken(8);
    const expiresAt = new Date(Date.now() + (1000 * 60 * 15)); // 15 minutes
    const h = new Handshake({ token, email, expiresAt });
    await h.save();
    return res.json({ token, expiresAt });
  } catch (err) {
    console.error('[Handshake] create error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.consumeHandshake = async (req, res) => {
  try {
    const token = (req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token_required' });
    const rec = await Handshake.findOne({ token });
    if (!rec) return res.status(404).json({ error: 'not_found' });
    if (rec.used) return res.status(400).json({ error: 'token_used' });
    if (rec.expiresAt && rec.expiresAt < new Date()) return res.status(400).json({ error: 'token_expired' });

    // Mark used
    rec.used = true;
    await rec.save();

    // Ensure user exists
    let user = await User.findOne({ email: rec.email });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const verificationToken = crypto.randomBytes(32).toString('hex');
      user = new User({ 
        email: rec.email, 
        password: crypto.randomBytes(16).toString('hex'),
        verified: false, // Enforce verification for new users from extension
        verificationToken,
        verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      await user.save();
      
      // Send verification email in background
      emailService.sendVerificationEmail(user.email, verificationToken).catch(e => console.error('Handshake verification email failed', e));
    }

    if (!user.verified && !user.isAdmin) {
      return res.status(401).json({ 
        error: 'email_not_verified',
        message: 'Please verify your email address. Check your inbox for a verification link.',
        email: user.email
      });
    }

    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    return res.json({ 
      _id: user._id,
      email: user.email,
      plan: user.plan,
      isPro: user.isPro,
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('[Handshake] consume error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
