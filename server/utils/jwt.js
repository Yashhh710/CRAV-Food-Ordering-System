const crypto = require('crypto');
let jwtPkg = null;
try {
  jwtPkg = require('jsonwebtoken');
} catch (e) {}

const JWT_SECRET = process.env.JWT_SECRET || 'crav_super_secret_jwt_key_2026_production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'crav_super_secret_refresh_key_2026_production';

function signToken(payload, isRefresh = false) {
  const secret = isRefresh ? JWT_REFRESH_SECRET : JWT_SECRET;
  const expiresIn = isRefresh ? (process.env.JWT_REFRESH_EXPIRES_IN || '7d') : (process.env.JWT_EXPIRES_IN || '1d');

  if (jwtPkg) {
    return jwtPkg.sign(payload, secret, { expiresIn });
  }

  // Fallback signature using built-in crypto
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (isRefresh ? 7 * 86400 : 86400);
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token, isRefresh = false) {
  const secret = isRefresh ? JWT_REFRESH_SECRET : JWT_SECRET;

  if (jwtPkg) {
    try {
      return jwtPkg.verify(token, secret);
    } catch (err) {
      return null;
    }
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  signToken,
  verifyToken
};
