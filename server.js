const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const aiRoutes = require('./routes/ai.routes');
const authRoutes = require('./routes/auth.routes');
const paddleRoutes = require('./routes/paddle.routes');
const userRoutes = require('./routes/user.routes');

const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many auth requests, please try again later.' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Too many AI requests, please try again later.' }
});

// Middleware
app.use(cookieParser());
// CORS Configuration
const allowedOrigins = [
  'https://wa-quickreply-landing.vercel.app',
  'https://wa-quickreply-admin.vercel.app',
  'https://waquickreply.com',
  'https://www.waquickreply.com',
  'chrome-extension://caakoogldanocjlnlogcldndlfhgaoge'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl) or if in whitelist
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    console.warn(`[CORS Rejected]: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// NOTE: We mount the JSON body parser after the raw webhook route to avoid
// the global JSON parser consuming the webhook payload stream.

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'WA QuickReply Backend is running' });
});

// Paddle webhook needs raw body parsing to verify signature
app.post('/webhook/paddle', express.raw({ type: '*/*' }), (req, res, next) => {
  req.rawBody = req.body; // Buffer
  return next();
}, paddleRoutes);

// Now parse JSON for other routes
app.use(express.json());

// Mount auth and API routes after JSON body parser
const signupLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3,
  message: { error: 'Maximum signups from this IP exceeded. Please try again tomorrow.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const isDisposableEmail = (email) => {
  const disposableDomains = [
    'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com', 
    'mailinator.com', 'throwawaymail.com', 'temp-mail.org', 'tempmail.net',
    'dispostable.com', 'getnada.com', 'maildrop.cc', 'protonmail.ch' // Adding some common ones
  ];
  const domain = email.split('@')[1];
  return disposableDomains.some(d => domain.includes(d));
};

app.use('/auth/register', signupLimiter);
app.use('/auth', authLimiter, authRoutes);

// Surgical AI Routing (No root overlap)
app.post('/ai-reply', aiLimiter, aiRoutes);
app.post('/ai-improve', aiLimiter, aiRoutes);
app.post('/ai-feedback', aiLimiter, aiRoutes);
app.post('/generate-replies', aiLimiter, aiRoutes);
app.post('/improve-message', aiLimiter, aiRoutes);
app.post('/transcribe', aiLimiter, aiRoutes);

// User Routing
app.get('/user-status', userRoutes);

// Admin routes (protected by admin secret header)
const adminRoutes = require('./routes/admin.routes');
app.use('/admin', adminRoutes);

// Server-Sent Events endpoint for subscription updates
const eventsService = require('./services/events.service');
app.get('/events', (req, res) => {
  const email = (req.query.email || '').toLowerCase();
  if (!email) return res.status(400).send('email_required');

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  eventsService.addClient(email, res);

  req.on('close', () => {
    eventsService.removeClient(email, res);
  });
});

// Admin dashboard moved to standalone frontend app; do not serve admin UI here.

// Database connection
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/wa-quickreply';
  try {
    const conn = await mongoose.connect(uri);
    console.log(`[MongoDB]: Connected to ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB Error]: ${error.message}`);
    console.log('Server will continue to run without DB, but some features may fail.');
  }
};

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.stack);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Something went wrong on the server' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[Server]: Running on http://localhost:${PORT}`);
  console.log(`[Server]: Auth & AI modules active`);
  connectDB(); // Attempt connection in background
});
