const { Users, Orders, Reservations } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getCustomers(req, res) {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const allUsers = Users.find();
    const allOrders = Orders.find();

    // Filter to customers only
    let customers = allUsers.filter(u => !u.role || u.role.toLowerCase() === 'customer');

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      customers = customers.filter(c => {
        const name = (String(c.firstName || '') + ' ' + String(c.lastName || '')).toLowerCase();
        const email = String(c.email || '').toLowerCase();
        const phone = String(c.phone || '').toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q);
      });
    }

    if (status && status !== 'all') {
      customers = customers.filter(c => (c.status || 'active').toLowerCase() === status.toLowerCase());
    }

    // Sort newest registration first
    customers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalCustomers = customers.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = customers.slice(startIndex, startIndex + limitNum);

    // Enrich with actual order metrics
    const enriched = paginated.map(c => {
      const userOrders = allOrders.filter(o => o.userId === c.id || o.customer?.email === c.email);
      const totalSpent = userOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Guest Customer',
        email: c.email,
        phone: c.phone || 'N/A',
        status: c.status || 'active',
        isVerified: Boolean(c.isVerified),
        ordersCount: userOrders.length,
        totalSpent: Math.round(totalSpent),
        createdAt: c.createdAt,
        lastLogin: c.lastLogin || null
      };
    });

    res.json({
      success: true,
      total: totalCustomers,
      page: pageNum,
      totalPages: Math.ceil(totalCustomers / limitNum) || 1,
      customers: enriched
    });
  } catch (err) {
    console.error('Get customers error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving customer records.' });
  }
}

async function getCustomerDetails(req, res) {
  try {
    const { id } = req.params;
    const user = Users.findById(id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Customer record not found.' });
    }

    const orders = Orders.find().filter(o => o.userId === id || o.customer?.email === user.email);
    const reservations = Reservations.find().filter(r => r.userId === id || r.email === user.email);

    res.json({
      success: true,
      customer: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || 'N/A',
        status: user.status || 'active',
        isVerified: Boolean(user.isVerified),
        createdAt: user.createdAt,
        orders,
        reservations
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving customer details.' });
  }
}

async function updateCustomerStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be "active" or "suspended".' });
    }

    const customer = Users.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer record not found.' });
    }

    Users.findByIdAndUpdate(id, {
      status,
      suspensionReason: status === 'suspended' ? (reason || 'Violation of terms') : null
    });

    logAudit({
      actor: req.user,
      action: 'CUSTOMER_STATUS_CHANGED',
      recordId: id,
      details: `Customer ${customer.email} marked as ${status}. Reason: ${reason || 'N/A'}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Customer account marked as ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating customer status.' });
  }
}

module.exports = {
  getCustomers,
  getCustomerDetails,
  updateCustomerStatus
};
