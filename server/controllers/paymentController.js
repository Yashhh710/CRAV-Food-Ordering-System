const { Orders } = require('../config/db');
const { generateQrDataUrl } = require('../services/qrService');
const { selectAvailablePartner } = require('../services/deliveryService');

// In-memory active payment sessions to guarantee lightning-fast polling sync
const paymentSessions = new Map();

async function createDemoQrPayment(req, res) {
  try {
    const { items, subtotal, discount, delivery, total, coupon, customer } = req.body;

    if (!items || !items.length || !total) {
      return res.status(400).json({ success: false, message: 'Invalid order data. Cart cannot be empty.' });
    }

    const orderId = 'CRV-DEMO-' + Math.floor(100000 + Math.random() * 900000);
    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol === 'https' ? 'https' : 'http';
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

    const mobilePayUrl = `${baseUrl}/pay-mobile.html?orderId=${orderId}&amount=${encodeURIComponent(total)}`;
    const qrCodeDataUrl = await generateQrDataUrl(mobilePayUrl);
    const nowIso = new Date().toISOString();

    const newOrder = {
      id: orderId,
      userId: req.user ? req.user.id : null,
      isGuest: !req.user,
      items,
      subtotal: Number(subtotal),
      discount: Number(discount || 0),
      delivery: Number(delivery || 0),
      total: Number(total),
      coupon: coupon || '',
      customer: customer || {},
      payment: {
        method: 'CRAV Demo QR Payment',
        status: 'Pending',
        transactionId: null,
        paidAt: null,
        isDemo: true
      },
      deliveryBoy: null,
      stage: 'ORDER PLACED',
      createdAt: nowIso,
      updatedAt: nowIso,
      timeline: [
        {
          stage: 'ORDER PLACED',
          timestamp: nowIso,
          note: 'Demo QR payment initiated'
        }
      ]
    };

    Orders.insert(newOrder);

    // Keep active session in memory for real-time polling sync
    paymentSessions.set(orderId, {
      status: 'Pending',
      orderId,
      amount: total,
      transactionId: null,
      deliveryBoy: null,
      updatedAt: Date.now()
    });

    res.json({
      success: true,
      orderId,
      total,
      status: 'Pending',
      qrCodeDataUrl,
      mobilePayUrl,
      deliveryBoy: null,
      instructions: 'Scan this QR code using Google Lens or your preferred mobile QR scanner.'
    });
  } catch (err) {
    console.error('Create Demo QR error:', err);
    res.status(500).json({ success: false, message: 'Server error generating payment QR.' });
  }
}

async function getPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;
    const session = paymentSessions.get(orderId);
    if (session) {
      return res.json({
        success: true,
        orderId,
        status: session.status,
        transactionId: session.transactionId,
        isDemo: true
      });
    }

    const order = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.json({
      success: true,
      orderId,
      status: order.payment.status,
      transactionId: order.payment.transactionId,
      isDemo: true
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching payment status.' });
  }
}

async function completeDemoPayment(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }

    const order = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const txnId = 'TXN-DEMO-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
    const paidAt = new Date().toISOString();

    const assignedBoy = (order.deliveryBoy && order.deliveryBoy.id)
      ? order.deliveryBoy
      : selectAvailablePartner(orderId);

    const currentTimeline = Array.isArray(order.timeline) ? [...order.timeline] : [];
    currentTimeline.push({
      stage: 'ORDER CONFIRMED',
      timestamp: paidAt,
      note: assignedBoy
        ? `Payment verified (${txnId}) — Assigned to ${assignedBoy.name}`
        : `Payment verified (${txnId}) — Searching for available delivery partner`
    });

    const updatedOrder = Orders.update({ id: orderId }, {
      payment: {
        method: 'CRAV Demo QR Payment',
        status: 'Successful',
        transactionId: txnId,
        paidAt,
        isDemo: true
      },
      deliveryBoy: assignedBoy,
      stage: 'ORDER CONFIRMED',
      timeline: currentTimeline,
      updatedAt: paidAt
    });

    // Update in-memory session for instant polling sync
    paymentSessions.set(orderId, {
      status: 'Successful',
      orderId,
      amount: order.total,
      transactionId: txnId,
      deliveryBoy: assignedBoy,
      updatedAt: Date.now()
    });

    res.json({
      success: true,
      message: 'Demo payment completed successfully!',
      orderId,
      transactionId: txnId,
      status: 'Successful',
      amount: order.total,
      paidAt,
      deliveryBoy: updatedOrder ? updatedOrder.deliveryBoy : assignedBoy
    });
  } catch (err) {
    console.error('Complete Demo Payment error:', err);
    res.status(500).json({ success: false, message: 'Server error processing payment.' });
  }
}

async function getOrderDetailsForPay(req, res) {
  try {
    const { orderId } = req.params;
    const order = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        items: order.items,
        total: order.total,
        subtotal: order.subtotal,
        discount: order.discount,
        delivery: order.delivery,
        status: order.payment.status,
        transactionId: order.payment.transactionId,
        isDemo: true,
        customerName: `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Guest Customer'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving order for payment.' });
  }
}

module.exports = {
  createDemoQrPayment,
  getPaymentStatus,
  completeDemoPayment,
  getOrderDetailsForPay
};
