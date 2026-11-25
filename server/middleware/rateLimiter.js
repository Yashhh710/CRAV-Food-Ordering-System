// In-memory rate limiter with fallback to express-rate-limit
let rateLimitPkg = null;
try {
  rateLimitPkg = require('express-rate-limit');
} catch (e) {}

const requestCounts = new Map();

function customLimiter(windowMs, maxRequests, message) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = requestCounts.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + windowMs;
    } else {
      entry.count++;
    }

    requestCounts.set(ip, entry);

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please try again later.'
      });
    }

    next();
  };
}

const authLimiter = rateLimitPkg
  ? rateLimitPkg({ windowMs: 15 * 60 * 1000, max: 50, message: { success: false, message: 'Too many authentication attempts. Please try again after 15 minutes.' } })
  : customLimiter(15 * 60 * 1000, 50, 'Too many authentication attempts. Please try again after 15 minutes.');

const otpLimiter = rateLimitPkg
  ? rateLimitPkg({ windowMs: 60 * 1000, max: 5, message: { success: false, message: 'Too many OTP requests. Please wait a minute.' } })
  : customLimiter(60 * 1000, 5, 'Too many OTP requests. Please wait a minute.');

module.exports = {
  authLimiter,
  otpLimiter
};
