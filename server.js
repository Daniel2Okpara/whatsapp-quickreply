const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const aiRoutes = require('./routes/ai.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for the Chrome Extension
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate Limiting: Max 10 requests per minute per IP (DISABLED for TESTING)
/*
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/generate-replies', limiter);
*/

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'WA QuickReply Backend is running' });
});

app.use('/', aiRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.stack);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(PORT, () => {
  console.log(`[Server]: Running on http://localhost:${PORT}`);
  console.log(`[Server]: OpenAI AI integration active`);
});
