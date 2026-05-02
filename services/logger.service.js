const SystemLog = require('../models/systemLog.model');

exports.logError = async (type, message, details = {}, email = null) => {
  console.error(`[${type.toUpperCase()}] ${message}`, details);
  try {
    // Optional DB logging. We wrap in try-catch so logging doesn't break flows
    await SystemLog.create({ type, message, details, email });
  } catch (err) {
    console.error('[LOGGER_FAILURE] Failed to write log to DB', err);
  }
};
