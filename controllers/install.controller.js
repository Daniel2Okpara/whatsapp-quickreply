const Install = require('../models/install.model');
const User = require('../models/user.model');
const crypto = require('crypto');

exports.trackInstall = async (req, res) => {
  try {
    const { chromeId, version, platform } = req.body;
    
    if (!chromeId) {
      return res.status(400).json({ error: 'chromeId is required' });
    }

    // Check if install already exists
    let install = await Install.findOne({ chromeId });
    
    if (install) {
      // Update last active time
      install.lastActive = new Date();
      if (version) install.version = version;
      await install.save();
      console.log(`[Install] Updated existing install: ${chromeId}`);
    } else {
      // Create new install record
      install = await Install.create({
        chromeId,
        version: version || '1.0.0',
        platform: platform || 'chrome'
      });
      console.log(`[Install] New install tracked: ${chromeId}`);
    }

    return res.json({ 
      success: true, 
      installId: install._id,
      registered: install.registered,
      email: install.email
    });
  } catch (err) {
    console.error('[Install] trackInstall error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.linkInstallToUser = async (req, res) => {
  try {
    const { chromeId, email } = req.body;
    
    if (!chromeId || !email) {
      return res.status(400).json({ error: 'chromeId and email are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const install = await Install.findOne({ chromeId });
    if (!install) {
      return res.status(404).json({ error: 'Install not found' });
    }

    install.email = email;
    install.userId = user._id;
    install.registered = true;
    await install.save();

    console.log(`[Install] Linked install ${chromeId} to user ${email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Install] linkInstallToUser error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.listInstalls = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const total = await Install.countDocuments();
    const installs = await Install.find()
      .sort({ installDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'email plan isPro isAdmin role')
      .lean();

    return res.json({ 
      installs,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('[Install] listInstalls error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

exports.getInstallStats = async (req, res) => {
  try {
    const totalInstalls = await Install.countDocuments();
    const registeredInstalls = await Install.countDocuments({ registered: true });
    const unregisteredInstalls = totalInstalls - registeredInstalls;
    
    const installsByDate = await Install.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$installDate' },
            month: { $month: '$installDate' },
            day: { $dayOfMonth: '$installDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } },
      { $limit: 30 }
    ]);

    return res.json({
      totalInstalls,
      registeredInstalls,
      unregisteredInstalls,
      installsByDate
    });
  } catch (err) {
    console.error('[Install] getInstallStats error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
