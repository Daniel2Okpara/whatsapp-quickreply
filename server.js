const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const aiRoutes = require('./routes/ai.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'WA QuickReply Backend is running' });
});

app.use('/auth', authRoutes);
app.use('/', aiRoutes);

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
