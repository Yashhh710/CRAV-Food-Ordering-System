const { verifyToken } = require('../utils/jwt');
const { Users } = require('../config/db');
const { ROLES, hasPermission } = require('../config/roles');

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded || !decoded.userId) {
    return res.status(401).json({ success: false, message: 'Invalid or expired administrative token.' });
  }

  const user = Users.findById(decoded.userId);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Admin account not found.' });
  }

  const role = (user.role || '').toUpperCase();
  if (!role || role === 'CUSTOMER') {
    return res.status(403).json({ success: false, message: 'Access denied. Privileged staff account required.' });
  }

  if (user.status === 'inactive' || user.status === 'suspended') {
    return res.status(403).json({ success: false, message: 'Account is deactivated. Contact the Super Admin.' });
  }

  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: role,
    permissions: user.permissions || [],
    status: user.status || 'active'
  };

  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const userRole = (req.user.role || '').toUpperCase();
    if (userRole === ROLES.SUPER_ADMIN) {
      return next();
    }
    const rolesArray = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map(r => r.toUpperCase());
    if (!rolesArray.includes(userRole)) {
      return res.status(403).json({ success: false, message: `Access forbidden for role: ${userRole}.` });
    }
    next();
  };
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (hasPermission(req.user, perm)) {
      return next();
    }
    return res.status(403).json({ success: false, message: `Permission denied: ${perm}.` });
  };
}

module.exports = {
  authenticateAdmin,
  requireRole,
  requirePermission
};
