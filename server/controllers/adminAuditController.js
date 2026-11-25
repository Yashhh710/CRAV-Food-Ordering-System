const { AuditLogs } = require('../config/db');

async function getAuditLogs(req, res) {
  try {
    const { action, search, page = 1, limit = 50 } = req.query;
    let logs = AuditLogs.find();

    if (action && action !== 'all') {
      logs = logs.filter(l => (l.action || '').toUpperCase() === action.toUpperCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      logs = logs.filter(l => {
        const actorName = String(l.actor?.name || '').toLowerCase();
        const actorEmail = String(l.actor?.email || '').toLowerCase();
        const details = String(l.details || '').toLowerCase();
        const act = String(l.action || '').toLowerCase();
        return actorName.includes(q) || actorEmail.includes(q) || details.includes(q) || act.includes(q);
      });
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = logs.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = logs.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      logs: paginated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving audit logs.' });
  }
}

module.exports = {
  getAuditLogs
};
