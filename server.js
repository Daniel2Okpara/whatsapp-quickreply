const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const aiRoutes = require('./routes/ai.routes');
const authRoutes = require('./routes/auth.routes');
const paddleRoutes = require('./routes/paddle.routes');
const userRoutes = require('./routes/user.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
  next();
}, paddleRoutes);

// Now parse JSON for other routes
app.use(express.json());

// Mount auth and API routes after JSON body parser
app.use('/auth', authRoutes);
app.use('/', aiRoutes);
app.use('/', userRoutes);

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
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/wa-quickreply');
    console.log(`[MongoDB]: Connected to ${conn.connection.host}`);
  } catch (error) {
    console.log(`[MongoDB Error]: ${error.message}`);
    process.exit(1);
  }
};

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.stack);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server]: Running on http://localhost:${PORT}`);
    console.log(`[Server]: Auth & AI modules active`);
  });
});
