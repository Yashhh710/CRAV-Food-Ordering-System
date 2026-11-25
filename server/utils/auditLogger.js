const { AuditLogs } = require('../config/db');

function logAudit({ actor, action, recordId = null, details = null, ip = null }) {
  try {
    AuditLogs.insert({
      actor: {
        id: actor?.id || 'system',
        name: actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.email : 'System',
        email: actor?.email || 'system@crav.example',
        role: (actor?.role || 'SYSTEM').toUpperCase()
      },
      actorEmail: actor?.email || 'system@crav.example',
      actorRole: (actor?.role || 'SYSTEM').toUpperCase(),
      action,
      recordId,
      details,
      ip: ip || '127.0.0.1',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

module.exports = { logAudit };
