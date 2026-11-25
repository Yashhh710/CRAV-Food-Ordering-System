const { Orders } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');
const {
  isOrderActive,
  selectAvailablePartner,
  buildTrackingInfo
} = require('../services/deliveryService');

async function createOrder(req, res) {
  try {
    const { id, items, subtotal, discount, delivery, total, coupon, customer, payment } = req.body;

    if (!items || !items.length || total === undefined) {
      return res.status(400).json({ success: false, message: 'Invalid order data. Cart cannot be empty.' });
    }

    const orderId = (id && String(id).trim()) || ('CRV' + Math.floor(100000 + Math.random() * 900000));

    // Check if order already recorded — never overwrite existing deliveryBoy
    const existing = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (existing) {
      let existingOrder = existing;
      if (isOrderActive(existingOrder) && (!existingOrder.deliveryBoy || !existingOrder.deliveryBoy.id)) {
        const partner = selectAvailablePartner(existingOrder.id);
        if (partner) {
          existingOrder = Orders.update({ id: existingOrder.id }, {
            deliveryBoy: partner,
            updatedAt: new Date().toISOString()
          }) || existingOrder;
        }
      }
      return res.json({
        success: true,
        message: 'Order already exists in database.',
        order: {
          ...existingOrder,
          tracking: buildTrackingInfo(existingOrder)
        }
      });
    }

    const userId = req.user ? req.user.id : (customer?.userId || null);
    const paymentStatus = String(payment?.status || 'Pay on delivery');
    const isPaid = ['paid', 'successful'].includes(paymentStatus.toLowerCase());
    const isCod = (payment?.method || '').toLowerCase().includes('cash');

    // Confirmed orders (Paid or COD) automatically receive an available partner
    const initialStage = (isPaid || isCod) ? 'ORDER CONFIRMED' : 'ORDER PLACED';
    const assignedBoy = (isPaid || isCod) ? selectAvailablePartner(orderId) : null;
    const nowIso = new Date().toISOString();

    const newOrder = {
      id: orderId,
      userId: userId,
      isGuest: !userId,
      items: items.map(it => ({
        id: it.id,
        name: it.name || it.title || 'CRAV Item',
        price: Number(it.price) || 0,
        qty: Number(it.qty || it.quantity) || 1,
        img: it.img || it.image || 'assets/models/menu/bbq-chicken-pizza.png'
      })),
      subtotal: Number(subtotal) || 0,
      discount: Number(discount) || 0,
      delivery: Number(delivery) || 0,
      total: Number(total) || 0,
      coupon: coupon || '',
      customer: {
        firstName: customer?.firstName || customer?.name?.split(' ')[0] || 'Guest',
        lastName: customer?.lastName || customer?.name?.split(' ').slice(1).join(' ') || '',
        name: customer?.name || `${customer?.firstName || 'Guest'} ${customer?.lastName || ''}`.trim(),
        email: customer?.email || req.user?.email || 'guest@crav.example',
        phone: customer?.phone || '+91 90000 00000',
        address: customer?.address || 'Delivery Address',
        address2: customer?.address2 || '',
        state: customer?.state || 'Maharashtra',
        zip: customer?.zip || '400001'
      },
      payment: {
        method: payment?.method || 'Cash on Delivery',
        status: payment?.status || 'Pay on delivery',
        isDemo: payment?.isDemo !== undefined ? payment.isDemo : (payment?.method?.includes('QR') || false),
        transactionId: payment?.transactionId || null,
        paidAt: isPaid ? nowIso : null
      },
      deliveryBoy: assignedBoy,
      stage: initialStage,
      createdAt: nowIso,
      updatedAt: nowIso,
      timeline: [
        {
          stage: initialStage,
          timestamp: nowIso,
          note: assignedBoy
            ? `Order placed and assigned to ${assignedBoy.name}`
            : 'Customer placed order online'
        }
      ],
      statusHistory: [
        {
          stage: initialStage,
          timestamp: nowIso,
          note: 'Customer placed order online'
        }
      ]
    };

    Orders.insert(newOrder);

    logAudit({
      actor: req.user || { firstName: newOrder.customer.firstName, lastName: newOrder.customer.lastName, email: newOrder.customer.email, role: 'CUSTOMER' },
      action: 'ORDER_PLACED',
      recordId: newOrder.id,
      details: `Customer placed order #${newOrder.id} for ₹${newOrder.total} (${newOrder.payment.method})${assignedBoy ? ` — Assigned to ${assignedBoy.name}` : ' — Waiting for available partner'}`,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Order created and synced to server successfully.',
      order: {
        ...newOrder,
        tracking: buildTrackingInfo(newOrder)
      }
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Server error saving order.' });
  }
}

async function syncLocalOrders(req, res) {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: 'Invalid orders array' });
    }

    let syncedCount = 0;
    orders.forEach(rawOrder => {
      if (!rawOrder || !rawOrder.id) return;
      const existing = Orders.findById(rawOrder.id) || Orders.findOne({ id: rawOrder.id });
      if (!existing) {
        const assignedBoy = selectAvailablePartner(rawOrder.id);
        const createdIso = rawOrder.placedAt ? new Date(rawOrder.placedAt).toISOString() : new Date().toISOString();
        const orderToInsert = {
          id: rawOrder.id,
          userId: req.user ? req.user.id : null,
          isGuest: !req.user,
          items: (rawOrder.items || []).map(it => ({
            id: it.id,
            name: it.name || it.title || 'CRAV Item',
            price: Number(it.price) || 0,
            qty: Number(it.qty || it.quantity) || 1,
            img: it.img || it.image || 'assets/models/menu/bbq-chicken-pizza.png'
          })),
          subtotal: Number(rawOrder.subtotal) || 0,
          discount: Number(rawOrder.discount) || 0,
          delivery: Number(rawOrder.delivery) || 0,
          total: Number(rawOrder.total) || 0,
          coupon: rawOrder.coupon || '',
          customer: rawOrder.customer || {},
          payment: rawOrder.payment || { method: 'Cash on Delivery', status: 'Pay on delivery' },
          deliveryBoy: assignedBoy,
          stage: rawOrder.stage || 'ORDER CONFIRMED',
          createdAt: createdIso,
          updatedAt: new Date().toISOString(),
          timeline: [
            { stage: rawOrder.stage || 'ORDER CONFIRMED', timestamp: createdIso, note: 'Synced from customer device' }
          ],
          statusHistory: [
            { stage: 'ORDER PLACED', timestamp: createdIso, note: 'Synced from customer device' }
          ]
        };
        Orders.insert(orderToInsert);
        syncedCount++;
      }
    });

    res.json({ success: true, syncedCount, totalOrders: Orders.count() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error syncing local orders.' });
  }
}

async function getOrder(req, res) {
  try {
    const { id } = req.params;
    let order = Orders.findById(id) || Orders.findOne({ id });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // If order is active and confirmed but still waiting for a partner, assign one if now available.
    // Never overwrite an existing assignment.
    if (isOrderActive(order) && (!order.deliveryBoy || !order.deliveryBoy.id)) {
      const stageUpper = String(order.stage || '').toUpperCase();
      const paymentStatus = String(order.payment?.status || '').toLowerCase();
      const isCod = String(order.payment?.method || '').toLowerCase().includes('cash');
      if (stageUpper !== 'ORDER PLACED' || paymentStatus === 'paid' || paymentStatus === 'successful' || isCod) {
        const partner = selectAvailablePartner(order.id);
        if (partner) {
          order = Orders.update({ id: order.id }, {
            deliveryBoy: partner,
            updatedAt: new Date().toISOString()
          }) || order;
        }
      }
    }

    const stageInfo = buildTrackingInfo(order);

    res.json({
      success: true,
      order: {
        ...order,
        tracking: stageInfo
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving order.' });
  }
}

async function getUserOrders(req, res) {
  try {
    const orders = Orders.find({ userId: req.user.id });
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const enriched = orders.map(o => ({
      ...o,
      tracking: buildTrackingInfo(o)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching user orders.' });
  }
}

module.exports = {
  createOrder,
  syncLocalOrders,
  getOrder,
  getUserOrders
};
