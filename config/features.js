/**
 * Feature Configuration
 * Defines which features are available for each plan
 */

const featureMatrix = {
  free: {
    styleLearning: false,
    autoFollowUp: false,
    aiReply: true,
    improveMessage: false,
    aiLimit: 10, // per day
    templates: true,
    voiceTranscription: false
  },
  trial: {
    styleLearning: true,
    autoFollowUp: true,
    aiReply: true,
    improveMessage: true,
    aiLimit: 100, // per day
    templates: true,
    voiceTranscription: true
  },
  pro: {
    styleLearning: true,
    autoFollowUp: true,
    aiReply: true,
    improveMessage: true,
    aiLimit: 200, // per day
    templates: true,
    voiceTranscription: true
  }
};

const getFeatures = (plan = 'free') => {
  return featureMatrix[plan] || featureMatrix.free;
};

const isFeatureAvailable = (plan = 'free', feature) => {
  const features = getFeatures(plan);
  return features[feature] === true;
};

const getProBadgeFeatures = () => {
  return ['styleLearning', 'autoFollowUp', 'improveMessage'];
};

module.exports = {
  featureMatrix,
  getFeatures,
  isFeatureAvailable,
  getProBadgeFeatures
};
