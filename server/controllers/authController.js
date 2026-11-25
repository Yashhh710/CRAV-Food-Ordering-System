const { Users, Otps, Addresses } = require('../config/db');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken, verifyToken } = require('../utils/jwt');
const { sendOtpEmail } = require('../services/emailService');

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function register(req, res) {
  try {
    const { firstName, lastName, email, phone, password, address, address2, state, zipcode } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: 'First name, last name, email, and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = phone ? String(phone).trim() : '';
    const existingUser = Users.findOne({ email: cleanEmail });

    if (existingUser && existingUser.isVerified) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists. Please log in.' });
    }

    const hashedPassword = await hashPassword(password);
    let userId;

    if (existingUser && !existingUser.isVerified) {
      userId = existingUser.id;
      Users.update({ id: userId }, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: cleanPhone,
        password: hashedPassword
      });
    } else {
      const newUser = Users.insert({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        isVerified: false
      });
      userId = newUser.id;
    }

    // Save initial delivery address if provided
    if (address && address.trim()) {
      Addresses.insert({
        userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: cleanEmail,
        phone: phone.trim(),
        address: address.trim(),
        address2: (address2 || '').trim(),
        state: (state || '').trim(),
        zipcode: (zipcode || '').trim(),
        isDefault: true
      });
    }

    // Generate 6-digit OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // Delete existing OTPs for this email
    Otps.delete({ email: cleanEmail });
    Otps.insert({
      email: cleanEmail,
      otp,
      expiresAt,
      createdAt: new Date().toISOString()
    });

    // Send email
    await sendOtpEmail(cleanEmail, otp, firstName);

    res.status(201).json({
      success: true,
      message: 'Registration successful! A 6-digit OTP has been sent to your email.',
      email: cleanEmail
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP code are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = Otps.findOne({ email: cleanEmail, otp: cleanOtp });
    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code. Please check and try again.' });
    }

    if (new Date() > new Date(record.expiresAt)) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new code.' });
    }

    // Activate user
    const updatedUser = Users.update({ email: cleanEmail }, { isVerified: true });
    Otps.delete({ email: cleanEmail });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const token = signToken({ userId: updatedUser.id, email: updatedUser.email });
    const refreshToken = signToken({ userId: updatedUser.id, email: updatedUser.email }, true);

    const userAddresses = Addresses.find({ userId: updatedUser.id });

    res.json({
      success: true,
      message: 'Email successfully verified! Welcome to CRAV.',
      token,
      refreshToken,
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        phone: updatedUser.phone,
        isVerified: true
      },
      addresses: userAddresses
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
}

async function resendOtp(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = Users.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email.' });
    }

    // Cooldown check: 60 seconds
    const existing = Otps.findOne({ email: cleanEmail });
    if (existing) {
      const elapsed = Date.now() - new Date(existing.createdAt).getTime();
      if (elapsed < 60 * 1000) {
        const waitSec = Math.ceil((60 * 1000 - elapsed) / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${waitSec} seconds before requesting a new OTP.` });
      }
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    Otps.delete({ email: cleanEmail });
    Otps.insert({
      email: cleanEmail,
      otp,
      expiresAt,
      createdAt: new Date().toISOString()
    });

    await sendOtpEmail(cleanEmail, otp, user.firstName);

    res.json({
      success: true,
      message: 'A new 6-digit OTP code has been sent to your email.'
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error resending OTP.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = Users.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isVerified) {
      // Trigger new OTP
      const otp = generateOtp();
      Otps.delete({ email: cleanEmail });
      Otps.insert({
        email: cleanEmail,
        otp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      });
      await sendOtpEmail(cleanEmail, otp, user.firstName);

      return res.status(403).json({
        success: false,
        unverified: true,
        email: cleanEmail,
        message: 'Your email address is not verified yet. We have sent a verification code to your email.'
      });
    }

    const token = signToken({ userId: user.id, email: user.email });
    const refreshToken = signToken({ userId: user.id, email: user.email }, true);
    const userAddresses = Addresses.find({ userId: user.id });

    res.json({
      success: true,
      message: 'Login successful! Welcome back.',
      token,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role || 'customer',
        isVerified: user.isVerified
      },
      addresses: userAddresses
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
}

async function refreshTokenHandler(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required.' });
    }

    const decoded = verifyToken(refreshToken, true);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const user = Users.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const newToken = signToken({ userId: user.id, email: user.email });
    res.json({ success: true, token: newToken });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error refreshing token.' });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = Users.findOne({ email: cleanEmail });
    if (!user) {
      // Security standard: don't reveal email non-existence, return success message
      return res.json({ success: true, message: 'If this email exists in our system, an OTP code was sent.' });
    }

    const otp = generateOtp();
    Otps.delete({ email: cleanEmail });
    Otps.insert({
      email: cleanEmail,
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    });

    await sendOtpEmail(cleanEmail, otp, user.firstName);
    res.json({ success: true, message: 'Password reset OTP has been sent to your email.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error initiating password reset.' });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = Otps.findOne({ email: cleanEmail, otp: cleanOtp });
    if (!record || new Date() > new Date(record.expiresAt)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP code.' });
    }

    const hashedPassword = await hashPassword(newPassword);
    Users.update({ email: cleanEmail }, { password: hashedPassword });
    Otps.delete({ email: cleanEmail });

    res.json({ success: true, message: 'Your password has been reset successfully. Please log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error resetting password.' });
  }
}

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  login,
  refreshTokenHandler,
  forgotPassword,
  resetPassword
};
