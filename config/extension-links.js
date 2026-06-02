/**
 * Extension Installation Links
 * URLs for Chrome Web Store and other distribution channels
 */

const extensionLinks = {
  chrome: {
    production: 'https://chromewebstore.google.com/detail/wa-quickreply-ai-assistant/caakoogldanocjlnlogcldndlfhgaoge',
    fallback: 'https://chromewebstore.google.com/detail/WA-QuickReply'
  },
  firefox: {
    production: null, // Firefox version URL if available
    fallback: null
  },
  edge: {
    production: null, // Edge version URL if available
    fallback: null
  }
};

// Get the install link for a specific browser or default to Chrome
const getInstallLink = (browser = 'chrome') => {
  const browserLinks = extensionLinks[browser] || extensionLinks.chrome;
  return browserLinks.production || browserLinks.fallback;
};

// Get all available install links
const getAllLinks = () => extensionLinks;

module.exports = {
  extensionLinks,
  getInstallLink,
  getAllLinks
};
