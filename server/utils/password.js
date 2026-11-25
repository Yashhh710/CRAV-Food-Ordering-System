const crypto = require('crypto');
let bcryptPkg = null;
try {
  bcryptPkg = require('bcryptjs');
} catch (e) {}

async function hashPassword(password) {
  if (bcryptPkg) {
    const salt = await bcryptPkg.genSalt(10);
    return await bcryptPkg.hash(password, salt);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

async function comparePassword(password, storedHash) {
  if (!storedHash) return false;
  if (bcryptPkg && storedHash.startsWith('$2')) {
    return await bcryptPkg.compare(password, storedHash);
  }
  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    const salt = parts[1];
    const hash = parts[2];
    const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === testHash;
  }
  return password === storedHash;
}

module.exports = {
  hashPassword,
  comparePassword
};
