
const { Users, Otps, Addresses } = require('../config/db');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken, verifyToken } = require('../utils/jwt');
const { sendOtpEmail } = require('../services/emailService');

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createAndSendOtp(email, firstName) {
  const otp = generateOtp();
  const now = new Date();

  const expiresAt = new Date(
    now.getTime() + 5 * 60 * 1000
  ).toISOString();

  // Send email before replacing the previous OTP.
  await sendOtpEmail(email, otp, firstName);

  // Store OTP only after successful email sending.
  Otps.delete({ email });

  Otps.insert({
    email,
    otp,
    expiresAt,
    createdAt: now.toISOString()
  });

  return true;
}

async function register(req, res) {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      address,
      address2,
      state,
      zipcode
    } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and password are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanFirstName = String(firstName).trim();
    const cleanLastName = String(lastName).trim();
    const cleanPhone = phone ? String(phone).trim() : '';

    const existingUser = Users.findOne({ email: cleanEmail });

    if (existingUser && existingUser.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please log in.'
      });
    }

    const hashedPassword = await hashPassword(password);
    let userId;

    if (existingUser) {
      userId = existingUser.id;

      Users.update(
        { id: userId },
        {
          firstName: cleanFirstName,
          lastName: cleanLastName,
          phone: cleanPhone,
          password: hashedPassword
        }
      );
    } else {
      const newUser = Users.insert({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        role: 'customer',
        status: 'active',
        isVerified: false
      });

      userId = newUser.id;
    }

    if (address && String(address).trim()) {
      Addresses.insert({
        userId,
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        address: String(address).trim(),
        address2: String(address2 || '').trim(),
        state: String(state || '').trim(),
        zipcode: String(zipcode || '').trim(),
        isDefault: true
      });
    }

    try {
      await createAndSendOtp(cleanEmail, cleanFirstName);
    } catch (emailError) {
      console.error('CRAV OTP EMAIL ERROR:', emailError);

      return res.status(502).json({
        success: false,
        message: 'Your account was created, but the verification email could not be sent. Please try again.'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Registration successful! A 6-digit OTP has been sent to your email.',
      email: cleanEmail
    });

  } catch (err) {
    console.error('Registration error:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error during registration.'
    });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP code are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = Otps.findOne({
      email: cleanEmail,
      otp: cleanOtp
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code. Please check and try again.'
      });
    }

    if (new Date() > new Date(record.expiresAt)) {
      Otps.delete({ email: cleanEmail });

      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new code.'
      });
    }

    const updatedUser = Users.update(
      { email: cleanEmail },
      { isVerified: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    Otps.delete({ email: cleanEmail });

    const token = signToken({
      userId: updatedUser.id,
      email: updatedUser.email
    });

    const refreshToken = signToken({
      userId: updatedUser.id,
      email: updatedUser.email
    }, true);

    const userAddresses = Addresses.find({
      userId: updatedUser.id
    });

    return res.json({
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

    return res.status(500).json({
      success: false,
      message: 'Server error during verification.'
    });
  }
}

async function resendOtp(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const user = Users.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email.'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'This email is already verified. Please log in.'
      });
    }

    const existing = Otps.findOne({ email: cleanEmail });

    if (existing) {
      const elapsed = Date.now() -
        new Date(existing.createdAt).getTime();

      if (elapsed < 60 * 1000) {
        const waitSec = Math.ceil(
          (60 * 1000 - elapsed) / 1000
        );

        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec} seconds before requesting a new OTP.`
        });
      }
    }

    await createAndSendOtp(cleanEmail, user.firstName);

    return res.json({
      success: true,
      message: 'A new 6-digit OTP code has been sent to your email.'
    });

  } catch (err) {
    console.error('Resend OTP error:', err);

    return res.status(502).json({
      success: false,
      message: 'Unable to send OTP email. Please try again later.'
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const user = Users.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    if (!user.isVerified) {
      await createAndSendOtp(cleanEmail, user.firstName);

      return res.status(403).json({
        success: false,
        unverified: true,
        email: cleanEmail,
        message: 'Your email address is not verified yet. A new verification code has been sent.'
      });
    }

    const token = signToken({
      userId: user.id,
      email: user.email
    });

    const refreshToken = signToken({
      userId: user.id,
      email: user.email
    }, true);

    const userAddresses = Addresses.find({
      userId: user.id
    });

    return res.json({
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

    return res.status(500).json({
      success: false,
      message: 'Server error during login.'
    });
  }
}

async function refreshTokenHandler(req, res) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required.'
      });
    }

    const decoded = verifyToken(refreshToken, true);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token.'
      });
    }

    const user = Users.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found.'
      });
    }

    const newToken = signToken({
      userId: user.id,
      email: user.email
    });

    return res.json({
      success: true,
      token: newToken
    });

  } catch (err) {
    console.error('Refresh token error:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error refreshing token.'
    });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const user = Users.findOne({ email: cleanEmail });

    if (!user) {
      return res.json({
        success: true,
        message: 'If this email exists in our system, an OTP code was sent.'
      });
    }

    await createAndSendOtp(cleanEmail, user.firstName);

    return res.json({
      success: true,
      message: 'Password reset OTP has been sent to your email.'
    });

  } catch (err) {
    console.error('Forgot password error:', err);

    return res.status(502).json({
      success: false,
      message: 'Unable to send password reset email. Please try again later.'
    });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and new password are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const record = Otps.findOne({
      email: cleanEmail,
      otp: cleanOtp
    });

    if (!record || new Date() > new Date(record.expiresAt)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code.'
      });
    }

    const hashedPassword = await hashPassword(newPassword);

    const updatedUser = Users.update(
      { email: cleanEmail },
      { password: hashedPassword }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    Otps.delete({ email: cleanEmail });

    return res.json({
      success: true,
      message: 'Your password has been reset successfully. Please log in.'
    });

  } catch (err) {
    console.error('Reset password error:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error resetting password.'
    });
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
