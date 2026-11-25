const fs = require('fs');
const path = require('path');
const { Orders } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

let deliveryBoysList = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, '../../assets/js/deliveryboy.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  deliveryBoysList = parsed.deliveryBoys || [];
} catch (e) {
  console.warn('Could not load deliveryboy.json on server:', e.message);
}

function getDeterministicDeliveryBoy(orderId) {
  if (!deliveryBoysList.length) return null;
  let hash = 0;
  const str = String(orderId || 'CRAV');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % deliveryBoysList.length;
  return deliveryBoysList[index];
}

const STAGES = [
  { key: 'confirmed', title: 'Order Confirmed', text: 'We have received and confirmed your order.', sec: 0 },
  { key: 'preparing', title: 'Preparing Your Food', text: 'Fresh ingredients are being prepared by the chef.', sec: 20 },
  { key: 'packed', title: 'Food Packed', text: 'Your meal is carefully packed with tamper-proof seal.', sec: 45 },
  { key: 'out_for_delivery', title: 'Out for Delivery', text: 'Your delivery partner has picked up your order.', sec: 80 },
  { key: 'arriving_soon', title: 'Arriving Soon', text: 'Delivery partner is within 5 minutes of your location.', sec: 130 },
  { key: 'delivered', title: 'Delivered', text: 'Delivered! Enjoy your delicious CRAV meal.', sec: 190 }
];

function calculateStage(createdAt) {
  const elapsedSec = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  let currentStageIndex = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsedSec >= STAGES[i].sec) {
      currentStageIndex = i;
    }
  }
  return {
    stageIndex: currentStageIndex,
    currentStage: STAGES[currentStageIndex].title,
    currentText: STAGES[currentStageIndex].text,
    elapsedSec,
    stages: STAGES.map((s, idx) => ({
      ...s,
      completed: idx <= currentStageIndex,
      active: idx === currentStageIndex
    }))
  };
}

async function createOrder(req, res) {
  try {
    const { id, items, subtotal, discount, delivery, total, coupon, customer, payment, deliveryBoy } = req.body;

    if (!items || !items.length || total === undefined) {
      return res.status(400).json({ success: false, message: 'Invalid order data. Cart cannot be empty.' });
    }

    const orderId = (id && String(id).trim()) || ('CRV' + Math.floor(100000 + Math.random() * 900000));
    
    // Check if order already recorded
    const existing = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (existing) {
      return res.json({ success: true, message: 'Order already exists in database.', order: existing });
    }

    const assignedBoy = deliveryBoy || getDeterministicDeliveryBoy(orderId);
    const userId = req.user ? req.user.id : (customer?.userId || null);
    const isPaid = (payment?.status || '').toLowerCase() === 'paid';

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
        paidAt: isPaid ? new Date().toISOString() : null
      },
      deliveryBoy: assignedBoy,
      stage: isPaid ? 'ORDER CONFIRMED' : 'ORDER PLACED',
      stageIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [
        {
          stage: isPaid ? 'ORDER CONFIRMED' : 'ORDER PLACED',
          timestamp: new Date().toISOString(),
          note: 'Customer placed order online'
        }
      ]
    };

    Orders.insert(newOrder);

    logAudit({
      actor: req.user || { firstName: newOrder.customer.firstName, lastName: newOrder.customer.lastName, email: newOrder.customer.email, role: 'CUSTOMER' },
      action: 'ORDER_PLACED',
      recordId: newOrder.id,
      details: `Customer placed order #${newOrder.id} for ₹${newOrder.total} (${newOrder.payment.method})`,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Order created and synced to server successfully.',
      order: newOrder
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
        const assignedBoy = rawOrder.deliveryBoy || getDeterministicDeliveryBoy(rawOrder.id);
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
          stageIndex: 0,
          createdAt: rawOrder.placedAt ? new Date(rawOrder.placedAt).toISOString() : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          statusHistory: [
            { stage: 'ORDER PLACED', timestamp: rawOrder.placedAt ? new Date(rawOrder.placedAt).toISOString() : new Date().toISOString(), note: 'Synced from customer device' }
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
    const order = Orders.findById(id) || Orders.findOne({ id });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const stageInfo = calculateStage(order.createdAt);

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
      tracking: calculateStage(o.createdAt)
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
