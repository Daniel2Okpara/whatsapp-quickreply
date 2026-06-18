const SystemLog = require('../models/systemLog.model');

exports.logError = async (type, message, details = {}, options = {}) => {
  const { email = null, userId = null, source = 'backend', endpoint = null } = options;
  console.error(`[${source.toUpperCase()}][${type.toUpperCase()}] ${message}`, details);
  try {
    await SystemLog.create({ type, message, details, email, userId, source, endpoint });
  } catch (err) {
    console.error('[LOGGER_FAILURE] Failed to write log to DB', err);
  }
};

exports.trackEvent = async (event, options = {}) => {
  const { userId = null, email = null, source = 'extension', metadata = {} } = options;
  try {
    const Analytics = require('../models/analytics.model');
    await Analytics.create({ event, userId, email, source, metadata });
  } catch (err) {
    console.error('[ANALYTICS_FAILURE]', err);
  }
};
