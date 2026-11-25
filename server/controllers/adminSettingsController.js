const { Settings } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getSettings(req, res) {
  try {
    let settings = Settings.findOne({ key: 'general' });
    if (!settings) {
      settings = Settings.insert({
        key: 'general',
        restaurantName: 'CRAV',
        tagline: 'From Craving to Doorstep.',
        openingHours: 'Every Day 11:00 AM to 11:00 PM',
        phone: '+91 90000 00000',
        email: 'hello@crav.example',
        address: 'Online Demonstration Platform (College Software Project)',
        currency: '₹',
        deliveryFee: 40,
        taxPercent: 5,
        minOrderAmount: 99,
        announcement: 'Welcome to CRAV! Enjoy fresh, hot food delivered to your doorstep.'
      });
    }

    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving settings.' });
  }
}

async function updateSettings(req, res) {
  try {
    const { openingHours, phone, email, deliveryFee, taxPercent, minOrderAmount, announcement, address } = req.body;

    let settings = Settings.findOne({ key: 'general' });
    const payload = {};
    if (openingHours !== undefined) payload.openingHours = openingHours.trim();
    if (phone !== undefined) payload.phone = phone.trim();
    if (email !== undefined) payload.email = email.trim();
    if (address !== undefined) payload.address = address.trim();
    if (deliveryFee !== undefined) payload.deliveryFee = Number(deliveryFee);
    if (taxPercent !== undefined) payload.taxPercent = Number(taxPercent);
    if (minOrderAmount !== undefined) payload.minOrderAmount = Number(minOrderAmount);
    if (announcement !== undefined) payload.announcement = announcement.trim();

    let updated;
    if (settings) {
      updated = Settings.findByIdAndUpdate(settings.id, payload);
    } else {
      updated = Settings.insert({ key: 'general', ...payload });
    }

    logAudit({
      actor: req.user,
      action: 'SETTINGS_UPDATED',
      recordId: updated.id,
      details: `Updated general restaurant configuration`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Restaurant settings updated successfully.', settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating settings.' });
  }
}

module.exports = {
  getSettings,
  updateSettings
};
