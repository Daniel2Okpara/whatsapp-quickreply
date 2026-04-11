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

app.use('/auth', authRoutes);
app.use('/', aiRoutes);

// Paddle webhook needs raw body parsing to verify signature
app.post('/webhook/paddle', express.raw({ type: '*/*' }), (req, res, next) => {
  req.rawBody = req.body; // Buffer
  next();
}, paddleRoutes);

// Now parse JSON for other routes
app.use(express.json());

app.use('/', userRoutes);

// Admin routes (protected by admin secret header)
const adminRoutes = require('./routes/admin.routes');
app.use('/admin', adminRoutes);

// Serve admin static assets and dashboard
app.use('/admin-static', express.static(path.join(__dirname, 'public')));
app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

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
