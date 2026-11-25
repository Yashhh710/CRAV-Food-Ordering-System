const { Users, Addresses, Orders, Reservations } = require('../config/db');
const { hashPassword, comparePassword } = require('../utils/password');

async function getProfile(req, res) {
  try {
    const user = Users.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const addresses = Addresses.find({ userId: req.user.id });
    const orders = Orders.find({ userId: req.user.id });
    const reservations = Reservations.find({ userId: req.user.id });

    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      },
      addresses,
      orderCount: orders.length,
      reservationCount: reservations.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving profile.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { firstName, lastName, phone } = req.body;
    const updated = Users.update({ id: req.user.id }, {
      firstName: (firstName || req.user.firstName).trim(),
      lastName: (lastName || req.user.lastName).trim(),
      phone: (phone || req.user.phone).trim()
    });

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating profile.' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }

    const user = Users.findById(req.user.id);
    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password.' });
    }

    const newHash = await hashPassword(newPassword);
    Users.update({ id: req.user.id }, { password: newHash });

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error changing password.' });
  }
}

async function getAddresses(req, res) {
  try {
    const addresses = Addresses.find({ userId: req.user.id });
    res.json({ success: true, addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching addresses.' });
  }
}

async function addAddress(req, res) {
  try {
    const { firstName, lastName, email, phone, address, address2, state, zipcode, isDefault } = req.body;
    if (!address || !state || !zipcode) {
      return res.status(400).json({ success: false, message: 'Address, state, and zipcode are required.' });
    }

    if (isDefault) {
      const existing = Addresses.find({ userId: req.user.id });
      existing.forEach(a => Addresses.update({ id: a.id }, { isDefault: false }));
    }

    const newAddr = Addresses.insert({
      userId: req.user.id,
      firstName: (firstName || req.user.firstName).trim(),
      lastName: (lastName || req.user.lastName).trim(),
      email: (email || req.user.email).trim(),
      phone: (phone || req.user.phone).trim(),
      address: address.trim(),
      address2: (address2 || '').trim(),
      state: state.trim(),
      zipcode: zipcode.trim(),
      isDefault: Boolean(isDefault)
    });

    res.status(201).json({ success: true, message: 'Address saved successfully.', address: newAddr });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error saving address.' });
  }
}

async function updateAddress(req, res) {
  try {
    const { id } = req.params;
    const addr = Addresses.findById(id);
    if (!addr || addr.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Address not found or unauthorized.' });
    }

    const { firstName, lastName, email, phone, address, address2, state, zipcode, isDefault } = req.body;
    if (isDefault) {
      const existing = Addresses.find({ userId: req.user.id });
      existing.forEach(a => Addresses.update({ id: a.id }, { isDefault: false }));
    }

    const updated = Addresses.update({ id }, {
      firstName: (firstName !== undefined ? firstName : addr.firstName).trim(),
      lastName: (lastName !== undefined ? lastName : addr.lastName).trim(),
      email: (email !== undefined ? email : addr.email).trim(),
      phone: (phone !== undefined ? phone : addr.phone).trim(),
      address: (address !== undefined ? address : addr.address).trim(),
      address2: (address2 !== undefined ? address2 : addr.address2).trim(),
      state: (state !== undefined ? state : addr.state).trim(),
      zipcode: (zipcode !== undefined ? zipcode : addr.zipcode).trim(),
      isDefault: isDefault !== undefined ? Boolean(isDefault) : addr.isDefault
    });

    res.json({ success: true, message: 'Address updated successfully.', address: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating address.' });
  }
}

async function deleteAddress(req, res) {
  try {
    const { id } = req.params;
    const addr = Addresses.findById(id);
    if (!addr || addr.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    Addresses.delete({ id });
    res.json({ success: true, message: 'Address removed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting address.' });
  }
}

async function setDefaultAddress(req, res) {
  try {
    const { id } = req.params;
    const addr = Addresses.findById(id);
    if (!addr || addr.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    const existing = Addresses.find({ userId: req.user.id });
    existing.forEach(a => Addresses.update({ id: a.id }, { isDefault: a.id === id }));

    res.json({ success: true, message: 'Default address updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error setting default address.' });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
};
