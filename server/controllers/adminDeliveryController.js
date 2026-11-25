const { Orders, Users } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');
const { hashPassword } = require('../utils/password');
const { loadDeliveryBoys, isOrderActive } = require('../services/deliveryService');

async function getDeliveries(req, res) {
  try {
    const { status, date } = req.query;
    let orders = Orders.find();

    if (status) {
      const s = status.trim().toUpperCase();
      if (s === 'UNASSIGNED') {
        orders = orders.filter(o => !o.deliveryBoy || !o.deliveryBoy.name);
      } else if (s === 'ACTIVE') {
        orders = orders.filter(o => ['ASSIGNED TO DELIVERY BOY', 'PICKED UP', 'OUT FOR DELIVERY'].includes((o.stage || '').toUpperCase()));
      } else if (s === 'COMPLETED') {
        orders = orders.filter(o => (o.stage || '').toUpperCase() === 'DELIVERED');
      } else if (s === 'FAILED') {
        orders = orders.filter(o => ['FAILED', 'DELIVERY FAILED'].includes((o.stage || '').toUpperCase()));
      }
    }

    if (date) {
      orders = orders.filter(o => (o.createdAt || '').startsWith(date));
    }

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: orders.length, deliveries: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving deliveries.' });
  }
}

async function getDeliveryBoys(req, res) {
  try {
    const jsonPartners = loadDeliveryBoys();
    const allUsers = Users.find({ role: 'DELIVERY_BOY' });
    const allOrders = Orders.find();

    const partnerMap = new Map();
    jsonPartners.forEach(p => {
      partnerMap.set(p.id, {
        ...p,
        email: `${p.id}@crav.delivery`,
        licenseNumber: p.vehicle_number,
        availability: 'available',
        status: 'active'
      });
    });

    allUsers.forEach(boy => {
      const fullName = `${boy.firstName} ${boy.lastName}`.trim();
      if (!partnerMap.has(boy.id)) {
        partnerMap.set(boy.id, {
          id: boy.id,
          firstName: boy.firstName,
          lastName: boy.lastName,
          name: fullName,
          email: boy.email,
          phone: boy.phone || '+91 90000 00000',
          image: boy.image || 'assets/media/delivery/db-001.png',
          vehicle: boy.vehicle || 'Hero Splendor Plus',
          vehicle_number: boy.licenseNumber || 'MH-46-2024-00918',
          licenseNumber: boy.licenseNumber || 'MH-46-2024-00918',
          availability: boy.availability || 'available',
          rating: boy.rating || 4.8,
          deliveries: boy.deliveries || 0,
          experience: boy.experience || '2 yrs',
          languages: boy.languages || ['Hindi', 'English'],
          status: boy.status || 'active'
        });
      }
    });

    const deliveryBoys = Array.from(partnerMap.values()).map(boy => {
      const assignedOrders = allOrders.filter(o => o.deliveryBoy && (o.deliveryBoy.id === boy.id || o.deliveryBoy.name === boy.name));
      const activeCount = assignedOrders.filter(o => isOrderActive(o)).length;
      const completedCount = assignedOrders.filter(o => (o.stage || '').toUpperCase() === 'DELIVERED').length;
      const failedCount = assignedOrders.filter(o => ['FAILED', 'DELIVERY FAILED'].includes((o.stage || '').toUpperCase())).length;

      return {
        ...boy,
        availability: activeCount > 0 ? 'busy' : (boy.availability || 'available'),
        activeOrders: activeCount,
        completedOrders: completedCount,
        failedOrders: failedCount
      };
    });

    res.json({ success: true, deliveryBoys });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving delivery partners.' });
  }
}

async function addDeliveryBoy(req, res) {
  try {
    const { firstName, lastName, email, phone, password, vehicle, licenseNumber } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: 'First name, last name, email, and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = Users.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const hashedPassword = await hashPassword(password);
    const newBoy = Users.insert({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      password: hashedPassword,
      role: 'DELIVERY_BOY',
      permissions: ['delivery_boy_view', 'update_order_status'],
      vehicle: vehicle || 'Hero Splendor Plus',
      licenseNumber: licenseNumber || 'MH-46-DL-1092',
      availability: 'available',
      rating: 5.0,
      status: 'active',
      isVerified: true,
      lastLogin: null
    });

    logAudit({
      actor: req.user,
      action: 'DELIVERY_BOY_ADDED',
      recordId: newBoy.id,
      details: `Added new delivery boy fleet partner: ${cleanEmail}`,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: `Delivery partner ${firstName} ${lastName} added successfully.`,
      deliveryBoy: newBoy
    });
  } catch (err) {
    console.error('Add delivery boy error:', err);
    res.status(500).json({ success: false, message: 'Server error adding delivery boy.' });
  }
}

async function updateDeliveryBoyAvailability(req, res) {
  try {
    const { id } = req.params;
    const { availability } = req.body;

    if (!['available', 'offline', 'busy'].includes(availability)) {
      return res.status(400).json({ success: false, message: 'Invalid availability state.' });
    }

    const updated = Users.findByIdAndUpdate(id, { availability });
    res.json({ success: true, message: `Availability updated to ${availability}.`, deliveryBoy: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating availability.' });
  }
}

// Delivery Boy Personal Portal Endpoint
async function getMyAssignedDeliveries(req, res) {
  try {
    const boyId = req.user.id;
    const boyName = `${req.user.firstName} ${req.user.lastName}`.trim();
    const allOrders = Orders.find();

    const myOrders = allOrders.filter(o => {
      if (!o.deliveryBoy) return false;
      return o.deliveryBoy.id === boyId || o.deliveryBoy.name === boyName;
    });

    myOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: myOrders.length, deliveries: myOrders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving personal deliveries.' });
  }
}

// Delivery Boy Status Transition Update
async function updateMyDeliveryStatus(req, res) {
  try {
    const { orderId } = req.params;
    const { status, reason, note } = req.body;

    const allowedStatuses = ['ACCEPTED', 'PICKED UP', 'OUT FOR DELIVERY', 'DELIVERED', 'FAILED'];
    const targetStatus = String(status || '').trim().toUpperCase();

    if (!allowedStatuses.includes(targetStatus)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    if (targetStatus === 'FAILED' && !reason && !note) {
      return res.status(400).json({ success: false, message: 'A failure reason is strictly required when reporting a failed delivery.' });
    }

    const order = Orders.findById(orderId) || Orders.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const timeline = Array.isArray(order.timeline) ? order.timeline : [];
    timeline.push({
      stage: targetStatus === 'DELIVERED' ? 'DELIVERED' : (targetStatus === 'FAILED' ? 'DELIVERY FAILED' : targetStatus),
      note: note || reason || `Delivery partner updated status to ${targetStatus}`,
      updatedBy: {
        id: req.user.id,
        name: `${req.user.firstName} ${req.user.lastName}`.trim(),
        role: 'DELIVERY_BOY'
      },
      timestamp: new Date().toISOString()
    });

    const updatePayload = {
      timeline,
      stage: targetStatus === 'DELIVERED' ? 'DELIVERED' : (targetStatus === 'FAILED' ? 'DELIVERY FAILED' : targetStatus),
      updatedAt: new Date().toISOString()
    };

    if (targetStatus === 'DELIVERED') {
      if (order.payment) {
        updatePayload.payment = { ...order.payment, status: 'Paid', paidAt: new Date().toISOString() };
      }
    }

    if (targetStatus === 'FAILED') {
      updatePayload.failureReason = reason || note;
    }

    const updated = Orders.update({ id: order.id }, updatePayload);

    logAudit({
      actor: req.user,
      action: 'DELIVERY_STATUS_UPDATED',
      recordId: order.id,
      details: `Delivery partner updated Order ${order.id} status to ${targetStatus}. Reason: ${reason || note || 'N/A'}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Order status updated to ${targetStatus}.`, order: updated });
  } catch (err) {
    console.error('Update delivery status error:', err);
    res.status(500).json({ success: false, message: 'Server error updating delivery status.' });
  }
}

module.exports = {
  getDeliveries,
  getDeliveryBoys,
  addDeliveryBoy,
  updateDeliveryBoyAvailability,
  getMyAssignedDeliveries,
  updateMyDeliveryStatus
};
