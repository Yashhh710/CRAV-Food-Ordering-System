const fs = require('fs');
const path = require('path');
const { Orders, Users } = require('../config/db');

const DELIVERY_JSON_PATH = path.join(__dirname, '../../assets/js/deliveryboy.json');

const TERMINAL_STAGES = new Set([
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'DELIVERY FAILED'
]);

const TRACKING_STAGES = [
  { index: 0, key: 'placed', title: 'Order Placed', text: 'Your order has been received.', icon: 'fa-receipt' },
  { index: 1, key: 'confirmed', title: 'Order Confirmed', text: 'We have received and confirmed your order.', icon: 'fa-circle-check' },
  { index: 2, key: 'preparing', title: 'Preparing Your Order', text: 'Your food is being freshly prepared in our kitchen.', icon: 'fa-utensils' },
  { index: 3, key: 'ready', title: 'Ready for Pickup', text: 'Packed hot and ready for pickup.', icon: 'fa-box' },
  { index: 4, key: 'assigned', title: 'Delivery Partner Assigned', text: 'A delivery partner has been assigned to your order.', icon: 'fa-user-check' },
  { index: 5, key: 'out_for_delivery', title: 'Out for Delivery', text: 'Your delivery partner is on the way to your doorstep.', icon: 'fa-motorcycle' },
  { index: 6, key: 'delivered', title: 'Delivered', text: 'Delivered! Enjoy your delicious CRAV meal.', icon: 'fa-house-chimney' }
];

function loadDeliveryBoys() {
  try {
    const raw = fs.readFileSync(DELIVERY_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.deliveryBoys || []);
    return list.map(normalizePartner);
  } catch (err) {
    console.warn('Could not load deliveryboy.json on server:', err.message);
    return [];
  }
}

function normalizePartner(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Delivery Partner',
    phone: p.phone || '+91 90000 00000',
    image: p.image || 'assets/media/delivery/db-001.png',
    vehicle: p.vehicle || 'Hero Splendor',
    vehicle_number: p.vehicle_number || p.licenseNumber || 'MH 46 AB 0001',
    rating: p.rating != null ? Number(p.rating) : 4.8,
    deliveries: p.deliveries != null ? Number(p.deliveries) : 0,
    experience: p.experience || '2 yrs',
    languages: Array.isArray(p.languages) ? p.languages : ['Hindi', 'English']
  };
}

function isOrderActive(order) {
  if (!order) return false;
  const stage = String(order.stage || 'ORDER PLACED').trim().toUpperCase();
  return !TERMINAL_STAGES.has(stage);
}

function getBusyPartnerIds(orders, excludeOrderId) {
  const busy = new Set();
  (orders || []).forEach(o => {
    if (!o || (excludeOrderId && o.id === excludeOrderId)) return;
    if (isOrderActive(o) && o.deliveryBoy && o.deliveryBoy.id) {
      busy.add(o.deliveryBoy.id);
    }
  });

  // Also respect any explicitly offline/busy delivery users in DB
  try {
    const dbBoys = Users.find({ role: 'DELIVERY_BOY' });
    dbBoys.forEach(u => {
      if (u.availability === 'offline' || u.availability === 'busy') {
        busy.add(u.id);
      }
    });
  } catch (e) {}

  return busy;
}

/**
 * Selects an available delivery partner from deliveryboy.json.
 * Never returns a partner who is currently assigned to another active order.
 * Returns null if all partners are busy.
 */
function selectAvailablePartner(orderId) {
  const partners = loadDeliveryBoys();
  if (!partners.length) return null;

  const allOrders = Orders.find();
  const busyIds = getBusyPartnerIds(allOrders, orderId);
  const available = partners.filter(p => !busyIds.has(p.id));

  if (!available.length) {
    return null;
  }

  // Deterministic pick among available partners based on orderId
  let hash = 0;
  const str = String(orderId || 'CRAV');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % available.length;
  return normalizePartner(available[idx]);
}

function findPartnerById(partnerId) {
  if (!partnerId) return null;
  const partners = loadDeliveryBoys();
  const fromJson = partners.find(p => p.id === partnerId);
  if (fromJson) return normalizePartner(fromJson);

  const boyUser = Users.findById(partnerId);
  if (boyUser) {
    return normalizePartner({
      id: boyUser.id,
      name: `${boyUser.firstName || ''} ${boyUser.lastName || ''}`.trim(),
      phone: boyUser.phone,
      image: boyUser.image || 'assets/media/delivery/db-001.png',
      vehicle: boyUser.vehicle,
      vehicle_number: boyUser.licenseNumber,
      rating: boyUser.rating,
      deliveries: boyUser.deliveries || 0,
      experience: boyUser.experience || '2 yrs',
      languages: boyUser.languages || ['Hindi', 'English']
    });
  }

  return null;
}

function mapStageToIndex(stage) {
  const s = String(stage || 'ORDER PLACED').trim().toUpperCase();
  if (s === 'CANCELLED' || s === 'REJECTED') return { index: -1, isCancelled: true, isFailed: false };
  if (s === 'FAILED' || s === 'DELIVERY FAILED') return { index: -1, isCancelled: false, isFailed: true };
  if (s === 'ORDER PLACED') return { index: 0, isCancelled: false, isFailed: false };
  if (s === 'ORDER CONFIRMED') return { index: 1, isCancelled: false, isFailed: false };
  if (s === 'PREPARING' || s === 'PREPARING YOUR ORDER') return { index: 2, isCancelled: false, isFailed: false };
  if (s === 'READY FOR PICKUP' || s === 'FOOD PACKED') return { index: 3, isCancelled: false, isFailed: false };
  if (s === 'ASSIGNED TO DELIVERY BOY' || s === 'DELIVERY PARTNER ASSIGNED' || s === 'ACCEPTED') return { index: 4, isCancelled: false, isFailed: false };
  if (s === 'PICKED UP' || s === 'OUT FOR DELIVERY' || s === 'ARRIVING SOON') return { index: 5, isCancelled: false, isFailed: false };
  if (s === 'DELIVERED') return { index: 6, isCancelled: false, isFailed: false };
  return { index: 1, isCancelled: false, isFailed: false };
}

function buildTrackingInfo(order) {
  const mapped = mapStageToIndex(order.stage);
  const { index, isCancelled, isFailed } = mapped;
  const hasPartner = !!(order.deliveryBoy && order.deliveryBoy.id);

  let currentStage = 'Order Placed';
  let currentText = 'Your order has been received.';

  if (isCancelled) {
    currentStage = String(order.stage || 'CANCELLED').toUpperCase() === 'REJECTED' ? 'Order Rejected' : 'Order Cancelled';
    currentText = order.cancelReason || 'This order has been cancelled.';
  } else if (isFailed) {
    currentStage = 'Delivery Failed';
    currentText = order.failureReason || 'Delivery attempt could not be completed.';
  } else {
    const stageObj = TRACKING_STAGES[index] || TRACKING_STAGES[0];
    currentStage = stageObj.title;
    currentText = stageObj.text;
  }

  return {
    stageIndex: index,
    currentStage,
    currentText,
    rawStage: order.stage || 'ORDER PLACED',
    isCancelled,
    isFailed,
    isDelivered: index === 6 && !isCancelled && !isFailed,
    waitingForPartner: !isCancelled && !isFailed && !hasPartner,
    stages: TRACKING_STAGES.map(s => ({
      ...s,
      completed: !isCancelled && !isFailed && (s.index < index || (s.index === index && index === 6)),
      active: !isCancelled && !isFailed && s.index === index && index !== 6
    }))
  };
}

module.exports = {
  TRACKING_STAGES,
  loadDeliveryBoys,
  normalizePartner,
  isOrderActive,
  getBusyPartnerIds,
  selectAvailablePartner,
  findPartnerById,
  mapStageToIndex,
  buildTrackingInfo
};
