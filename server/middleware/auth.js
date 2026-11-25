const { verifyToken } = require('../utils/jwt');
const { Users } = require('../config/db');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded || !decoded.userId) {
    return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
  }

  const user = Users.findById(decoded.userId);
  if (!user) {
    return res.status(401).json({ success: false, message: 'User account not found.' });
  }

  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role || 'customer',
    isVerified: user.isVerified
  };

  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded && decoded.userId) {
      const user = Users.findById(decoded.userId);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          isVerified: user.isVerified
        };
      }
    }
  }
  next();
}

module.exports = {
  authenticate,
  optionalAuth
};
