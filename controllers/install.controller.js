const Install = require('../models/install.model');
const User = require('../models/user.model');
const crypto = require('crypto');

exports.trackInstall = async (req, res) => {
  try {
    const { deviceId, chromeId, version, platform } = req.body;
    
    // Allow tracking with either deviceId (preferred) or chromeId (fallback for backward compatibility)
    if (!deviceId && !chromeId) {
      return res.status(400).json({ error: 'deviceId or chromeId is required' });
    }

    console.log(`[Install][TRACK] Install tracking request - deviceId: ${deviceId}, chromeId: ${chromeId}`);

    // NEW ARCHITECTURE: Try to find user by deviceId first
    let user = null;
    if (deviceId) {
      user = await User.findOne({ 'devices.deviceId': deviceId });
    }

    if (user) {
      console.log(`[Install][TRACK] Found user by deviceId: ${user.email} (ID: ${user._id})`);
      
      // Update existing device entry in user.devices
      const deviceIndex = user.devices.findIndex(d => d.deviceId === deviceId);
      if (deviceIndex !== -1) {
        user.devices[deviceIndex].lastSeen = new Date();
        user.devices[deviceIndex].isActive = true;
        user.devices[deviceIndex].installCount += 1;
        if (version) user.devices[deviceIndex].version = version;
        if (chromeId) user.devices[deviceIndex].chromeId = chromeId;
        if (platform) user.devices[deviceIndex].platform = platform;
      }
      
      user.lastActive = new Date();
      await user.save();
      
      console.log(`[Install][TRACK] Updated device entry for user: ${user.email}`);
      
      return res.json({ 
        success: true, 
        installId: user._id,
        registered: !!user.email,
        email: user.email,
        userId: user._id
      });
    }

    // LEGACY: Fallback to install.model.js for backward compatibility
    console.log(`[Install][TRACK] User not found by deviceId, using legacy install.model.js`);
    
    // Check if install already exists by deviceId (preferred) or chromeId (fallback)
    let install;
    if (deviceId) {
      // If deviceId is provided, only check by deviceId (unique per device)
      install = await Install.findOne({ deviceId });
    } else {
      // Fallback to chromeId only for backward compatibility
      install = await Install.findOne({ chromeId, deviceId: { $exists: false } });
    }
    
    if (install) {
      // Update last active time
      install.lastActive = new Date();
      if (version) install.version = version;
      if (deviceId && !install.deviceId) install.deviceId = deviceId; // Add deviceId if missing
      if (chromeId) install.chromeId = chromeId; // Update chromeId if provided
      await install.save();
      console.log(`[Install][TRACK] Updated existing legacy install: ${install.deviceId || install.chromeId}`);
    } else {
      // Create new install record
      install = await Install.create({
        deviceId: deviceId || null,
        chromeId: chromeId || null,
        version: version || '1.0.0',
        platform: platform || 'chrome'
      });
      console.log(`[Install][TRACK] New legacy install tracked: ${install.deviceId || install.chromeId}`);
    }

    return res.json({ 
      success: true, 
      installId: install._id,
      registered: install.registered,
      email: install.email
    });
  } catch (err) {
    console.error('[Install][TRACK] trackInstall error:', err);
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
    console.log('[Install][STATS] Fetching install statistics');
    
    // NEW ARCHITECTURE: Count from user.devices for accurate tracking
    const totalUsers = await User.countDocuments({ verified: true });
    const activeDevices = await User.aggregate([
      { $match: { verified: true } },
      { $project: { deviceCount: { $size: '$devices' } } },
      { $group: { _id: null, total: { $sum: '$deviceCount' } } }
    ]);
    
    // Count active devices (last seen within 30 days)
    const activeDevicesRecent = await User.aggregate([
      { $match: { verified: true } },
      { $project: { 
        devices: {
          $filter: {
            input: '$devices',
            as: 'device',
            cond: { $gte: ['$$device.lastSeen', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] }
          }
        }
      }},
      { $project: { activeCount: { $size: '$devices' } } },
      { $group: { _id: null, total: { $sum: '$activeCount' } } }
    ]);
    
    // LEGACY: Keep install.model.js stats for backward compatibility
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

    console.log(`[Install][STATS] Total users: ${totalUsers}, Active devices: ${activeDevices[0]?.total || 0}`);
    console.log(`[Install][STATS] Active devices (30 days): ${activeDevicesRecent[0]?.total || 0}`);
    console.log(`[Install][STATS] Legacy installs: ${totalInstalls}, Registered: ${registeredInstalls}`);

    return res.json({
      // New architecture stats
      totalUsers,
      activeDevices: activeDevices[0]?.total || 0,
      activeDevicesRecent: activeDevicesRecent[0]?.total || 0,
      
      // Legacy stats for backward compatibility
      totalInstalls,
      registeredInstalls,
      unregisteredInstalls,
      installsByDate,
      
      lastUpdated: new Date()
    });
  } catch (err) {
    console.error('[Install][STATS] getInstallStats error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
