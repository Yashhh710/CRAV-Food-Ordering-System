const { Orders, Users } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

const VALID_STAGES = [
  'ORDER PLACED',
  'ORDER CONFIRMED',
  'PREPARING',
  'READY FOR PICKUP',
  'ASSIGNED TO DELIVERY BOY',
  'PICKED UP',
  'OUT FOR DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REJECTED'
];

async function getAllOrders(req, res) {
  try {
    const { search, status, paymentStatus, date, page = 1, limit = 20 } = req.query;
    let orders = Orders.find();

    // Search filter (Order ID, Customer Name, Email, Phone)
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      orders = orders.filter(o => {
        const idMatch = String(o.id || '').toLowerCase().includes(q);
        const nameMatch = (
          String(o.customer?.name || '') + ' ' +
          String(o.customer?.firstName || '') + ' ' +
          String(o.customer?.lastName || '')
        ).toLowerCase().includes(q);
        const emailMatch = String(o.customer?.email || '').toLowerCase().includes(q);
        const phoneMatch = String(o.customer?.phone || '').toLowerCase().includes(q);
        return idMatch || nameMatch || emailMatch || phoneMatch;
      });
    }

    // Status filter
    if (status && status !== 'all') {
      const s = status.trim().toUpperCase();
      orders = orders.filter(o => (o.stage || '').toUpperCase() === s);
    }

    // Payment status filter
    if (paymentStatus && paymentStatus !== 'all') {
      const ps = paymentStatus.trim().toLowerCase();
      orders = orders.filter(o => (o.payment?.status || '').toLowerCase() === ps);
    }

    // Date filter (YYYY-MM-DD)
    if (date) {
      orders = orders.filter(o => (o.createdAt || '').startsWith(date));
    }

    // Sort newest first
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalOrders = orders.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedOrders = orders.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      total: totalOrders,
      page: pageNum,
      totalPages: Math.ceil(totalOrders / limitNum) || 1,
      orders: paginatedOrders
    });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving orders.' });
  }
}

async function getOrderDetails(req, res) {
  try {
    const { id } = req.params;
    const order = Orders.findById(id) || Orders.findOne({ id });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving order details.' });
  }
}

async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { note, reason } = req.body;
    const stage = req.body.stage || req.body.status;

    if (!stage) {
      return res.status(400).json({ success: false, message: 'New order status is required.' });
    }

    const targetStage = String(stage).trim().toUpperCase();
    if (!VALID_STAGES.includes(targetStage)) {
      return res.status(400).json({ success: false, message: `Invalid stage: ${stage}. Valid stages are: ${VALID_STAGES.join(', ')}` });
    }

    const order = Orders.findById(id) || Orders.findOne({ id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Kitchen staff can only transition between PREPARING and READY FOR PICKUP
    if (req.user.role === 'KITCHEN_STAFF') {
      if (!['PREPARING', 'READY FOR PICKUP'].includes(targetStage)) {
        return res.status(403).json({ success: false, message: 'Kitchen staff can only update cooking and ready status.' });
      }
    }

    // Require reason for cancellation or rejection
    if (['CANCELLED', 'REJECTED'].includes(targetStage) && !reason && !note) {
      return res.status(400).json({ success: false, message: 'A reason is required when rejecting or cancelling an order.' });
    }

    const timelineEntry = {
      stage: targetStage,
      note: note || reason || `Status updated to ${targetStage}`,
      updatedBy: {
        id: req.user.id,
        name: `${req.user.firstName} ${req.user.lastName}`.trim(),
        role: req.user.role
      },
      timestamp: new Date().toISOString()
    };

    const currentTimeline = Array.isArray(order.timeline) ? order.timeline : [];
    currentTimeline.push(timelineEntry);

    const updatePayload = {
      stage: targetStage,
      timeline: currentTimeline,
      updatedAt: new Date().toISOString()
    };

    if (targetStage === 'DELIVERED') {
      updatePayload['payment.status'] = 'Paid';
      if (order.payment) {
        updatePayload.payment = { ...order.payment, status: 'Paid', paidAt: new Date().toISOString() };
      }
    }

    const updatedOrder = Orders.update({ id: order.id }, updatePayload);

    logAudit({
      actor: req.user,
      action: 'ORDER_STATUS_CHANGED',
      recordId: order.id,
      details: `Order ${order.id} status changed from "${order.stage}" to "${targetStage}". Reason/Note: ${note || reason || 'N/A'}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Order status updated to ${targetStage}.`,
      order: updatedOrder
    });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ success: false, message: 'Server error updating order status.' });
  }
}

async function assignDeliveryBoy(req, res) {
  try {
    const { id } = req.params;
    const { deliveryBoyId } = req.body;

    if (!deliveryBoyId) {
      return res.status(400).json({ success: false, message: 'Delivery partner ID is required.' });
    }

    const order = Orders.findById(id) || Orders.findOne({ id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const boyUser = Users.findById(deliveryBoyId);
    let assignedBoyData = null;

    if (boyUser) {
      assignedBoyData = {
        id: boyUser.id,
        name: `${boyUser.firstName} ${boyUser.lastName}`.trim(),
        phone: boyUser.phone || '+91 90000 00000',
        vehicle: boyUser.vehicle || 'Hero Splendor Plus',
        rating: boyUser.rating || 4.9
      };
    } else {
      assignedBoyData = {
        id: deliveryBoyId,
        name: 'Assigned Partner',
        phone: '+91 90000 00000',
        vehicle: 'Motorcycle',
        rating: 4.8
      };
    }

    const currentTimeline = Array.isArray(order.timeline) ? order.timeline : [];
    currentTimeline.push({
      stage: 'ASSIGNED TO DELIVERY BOY',
      note: `Delivery assigned to partner: ${assignedBoyData.name}`,
      updatedBy: {
        id: req.user.id,
        name: `${req.user.firstName} ${req.user.lastName}`.trim(),
        role: req.user.role
      },
      timestamp: new Date().toISOString()
    });

    const updated = Orders.update({ id: order.id }, {
      deliveryBoy: assignedBoyData,
      stage: (order.stage === 'ORDER CONFIRMED' || order.stage === 'ORDER PLACED') ? 'ASSIGNED TO DELIVERY BOY' : order.stage,
      timeline: currentTimeline,
      updatedAt: new Date().toISOString()
    });

    logAudit({
      actor: req.user,
      action: 'DELIVERY_ASSIGNED',
      recordId: order.id,
      details: `Assigned delivery partner ${assignedBoyData.name} to order ${order.id}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Delivery successfully assigned to ${assignedBoyData.name}.`,
      order: updated
    });
  } catch (err) {
    console.error('Assign delivery boy error:', err);
    res.status(500).json({ success: false, message: 'Server error assigning delivery boy.' });
  }
}

module.exports = {
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  assignDeliveryBoy
};
