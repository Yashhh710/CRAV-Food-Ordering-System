const { Reservations } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getReservations(req, res) {
  try {
    const { status, date, search, page = 1, limit = 20 } = req.query;
    let reservations = Reservations.find();

    if (status && status !== 'all') {
      const s = status.trim().toLowerCase();
      reservations = reservations.filter(r => (r.status || 'pending').toLowerCase() === s);
    }

    if (date) {
      reservations = reservations.filter(r => (r.date || '').startsWith(date));
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      reservations = reservations.filter(r => {
        const idMatch = String(r.id || r.bookingId || '').toLowerCase().includes(q);
        const nameMatch = String(r.guestName || r.name || '').toLowerCase().includes(q);
        const emailMatch = String(r.email || '').toLowerCase().includes(q);
        const phoneMatch = String(r.phone || '').toLowerCase().includes(q);
        return idMatch || nameMatch || emailMatch || phoneMatch;
      });
    }

    // Sort upcoming / newest first
    reservations.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

    const total = reservations.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = reservations.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      reservations: paginated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving reservations.' });
  }
}

async function updateReservationStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, reason, notes } = req.body;

    const validStatuses = ['confirmed', 'rejected', 'cancelled', 'completed', 'pending'];
    if (!status || !validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ success: false, message: `Invalid status. Valid values: ${validStatuses.join(', ')}` });
    }

    const reservation = Reservations.findById(id) || Reservations.findOne({ bookingId: id });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation record not found.' });
    }

    if (status === 'rejected' && !reason && !notes) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    const updatePayload = {
      status: status.toLowerCase(),
      adminNotes: notes || reason || `Status changed to ${status}`,
      updatedBy: `${req.user.firstName} ${req.user.lastName}`,
      updatedAt: new Date().toISOString()
    };

    const updated = Reservations.findByIdAndUpdate(reservation.id, updatePayload);

    logAudit({
      actor: req.user,
      action: 'RESERVATION_STATUS_CHANGED',
      recordId: reservation.id,
      details: `Reservation #${reservation.bookingId || reservation.id} status changed to ${status}. Reason/Notes: ${notes || reason || 'N/A'}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Reservation marked as ${status}.`,
      reservation: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating reservation.' });
  }
}

module.exports = {
  getReservations,
  updateReservationStatus
};
