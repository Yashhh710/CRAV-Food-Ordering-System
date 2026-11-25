const { Orders } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getPayments(req, res) {
  try {
    const { status, method, page = 1, limit = 20 } = req.query;
    const orders = Orders.find();

    let paymentList = orders.map(o => {
      const p = o.payment || {};
      return {
        orderId: o.id,
        customerName: o.customer?.name || `${o.customer?.firstName || ''} ${o.customer?.lastName || ''}`.trim() || 'Customer',
        customerEmail: o.customer?.email || 'N/A',
        total: Number(o.total) || 0,
        subtotal: Number(o.subtotal) || 0,
        discount: Number(o.discount) || 0,
        delivery: Number(o.delivery) || 0,
        method: p.method || 'CRAV Demo QR Payment',
        status: p.status || 'Pending',
        isDemo: p.isDemo !== undefined ? Boolean(p.isDemo) : true,
        transactionId: p.transactionId || 'SIM-' + (o.id || '').replace(/[^0-9]/g, '').substr(0, 8),
        paidAt: p.paidAt || (p.status === 'Paid' ? o.updatedAt : null),
        createdAt: o.createdAt
      };
    });

    if (status && status !== 'all') {
      paymentList = paymentList.filter(p => p.status.toLowerCase() === status.toLowerCase());
    }

    if (method && method !== 'all') {
      paymentList = paymentList.filter(p => p.method.toLowerCase().includes(method.toLowerCase()));
    }

    paymentList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalOrdersValue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const paidRecords = paymentList.filter(p => p.status.toLowerCase() === 'paid');
    const totalCollected = paidRecords.reduce((sum, p) => sum + p.total, 0);
    const demoSimulatedTotal = paidRecords.filter(p => p.isDemo).reduce((sum, p) => sum + p.total, 0);

    const total = paymentList.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = paymentList.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      metrics: {
        totalOrdersValue: Math.round(totalOrdersValue),
        totalCollected: Math.round(totalCollected),
        demoSimulatedTotal: Math.round(demoSimulatedTotal),
        pendingTotal: Math.round(totalOrdersValue - totalCollected)
      },
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      payments: paginated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving payments.' });
  }
}

async function recordCashPayment(req, res) {
  try {
    const { orderId } = req.params;
    const { amountReceived, notes } = req.body;

    const order = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order record not found.' });
    }

    const currentPayment = order.payment || {};
    const updatedPayment = {
      ...currentPayment,
      method: 'Cash Received (Counter / Delivery)',
      status: 'Paid',
      isDemo: false, // Verified physical cash
      amountReceived: Number(amountReceived) || Number(order.total),
      receivedBy: `${req.user.firstName} ${req.user.lastName}`,
      paidAt: new Date().toISOString(),
      notes: notes || 'Cash payment verified at checkout counter'
    };

    const updated = Orders.findByIdAndUpdate(order.id, {
      payment: updatedPayment
    });

    logAudit({
      actor: req.user,
      action: 'CASH_PAYMENT_RECORDED',
      recordId: order.id,
      details: `Cashier recorded physical cash payment of ₹${updatedPayment.amountReceived} for Order ${order.id}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Cash payment recorded successfully for order ${order.id}.`,
      order: updated,
      payment: updatedPayment
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error recording cash payment.' });
  }
}

module.exports = {
  getPayments,
  recordCashPayment
};
