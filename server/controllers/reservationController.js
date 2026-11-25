const { Reservations } = require('../config/db');
const { generateQrDataUrl } = require('../services/qrService');

// Total tables in the restaurant: Table 1 to Table 15
const TOTAL_TABLES = 15;

function allocateTable(date, time) {
  const existing = Reservations.find({ date, time, status: 'Confirmed' });
  const bookedTables = new Set(existing.map(r => r.tableNumber));

  for (let t = 1; t <= TOTAL_TABLES; t++) {
    const tableId = `T-${t < 10 ? '0' + t : t}`;
    if (!bookedTables.has(tableId)) {
      return tableId;
    }
  }
  return null; // All tables booked for this slot
}

async function createReservation(req, res) {
  try {
    const { name, phone, email, guests, date, time, message } = req.body;

    if (!name || !email || !guests || !date || !time) {
      return res.status(400).json({ success: false, message: 'Please fill in all required reservation fields.' });
    }

    const cleanDate = date.trim();
    const cleanTime = time.trim();

    // Check availability & allocate table
    const allocatedTable = allocateTable(cleanDate, cleanTime);
    if (!allocatedTable) {
      return res.status(409).json({
        success: false,
        message: `All tables are fully booked on ${cleanDate} at ${cleanTime}. Please select an alternate time slot.`
      });
    }

    const bookingId = 'CRV-RES-' + Math.floor(100000 + Math.random() * 900000);
    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol === 'https' ? 'https' : 'http';
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

    const verifyUrl = `${baseUrl}/api/reservations/verify/${bookingId}`;
    const qrCodeDataUrl = await generateQrDataUrl(verifyUrl);

    const reservation = {
      id: bookingId,
      bookingId,
      userId: req.user ? req.user.id : null,
      guestName: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      guests: parseInt(guests, 10) || 2,
      date: cleanDate,
      time: cleanTime,
      tableNumber: allocatedTable,
      specialRequests: (message || '').trim(),
      status: 'Confirmed',
      qrCodeDataUrl,
      verifyUrl,
      createdAt: new Date().toISOString()
    };

    Reservations.insert(reservation);

    res.status(201).json({
      success: true,
      message: 'Table reservation confirmed successfully!',
      reservation
    });
  } catch (err) {
    console.error('Reservation error:', err);
    res.status(500).json({ success: false, message: 'Server error processing table reservation.' });
  }
}

async function getReservation(req, res) {
  try {
    const { id } = req.params;
    const reservation = Reservations.findById(id) || Reservations.findOne({ bookingId: id });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation ticket not found.' });
    }
    res.json({ success: true, reservation });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving reservation.' });
  }
}

async function verifyReservation(req, res) {
  try {
    const { id } = req.params;
    const reservation = Reservations.findById(id) || Reservations.findOne({ bookingId: id });

    if (!reservation) {
      return res.status(404).send(`
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #D90019;">❌ Invalid Ticket</h2>
          <p>This reservation does not exist in the CRAV system.</p>
        </div>
      `);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reservation Verified - CRAV</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background: #080808; color: #FFF9E9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #181818; border: 1px solid #333; border-top: 4px solid #D90019; border-radius: 16px; padding: 32px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .badge { background: #22c55e22; color: #22c55e; border: 1px solid #22c55e; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 20px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; border-bottom: 1px dashed #2a2a2a; padding-bottom: 8px; }
          .label { color: #888; }
          .val { font-weight: 600; color: #FFF9E9; }
          .table-box { background: #D90019; color: #fff; font-size: 24px; font-weight: bold; padding: 12px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="color: #D90019; margin: 0 0 8px 0; letter-spacing: 2px;">CRAV</h2>
          <p style="color: #F5B900; margin: 0 0 20px 0; font-size: 13px;">Official Digital Reservation</p>
          <div class="badge">✓ VERIFIED & CONFIRMED</div>
          <div class="table-box">Table ${reservation.tableNumber}</div>
          <div class="row"><span class="label">Booking ID</span><span class="val">${reservation.bookingId}</span></div>
          <div class="row"><span class="label">Guest Name</span><span class="val">${reservation.guestName}</span></div>
          <div class="row"><span class="label">Guests</span><span class="val">${reservation.guests} Persons</span></div>
          <div class="row"><span class="label">Date</span><span class="val">${reservation.date}</span></div>
          <div class="row"><span class="label">Time</span><span class="val">${reservation.time}</span></div>
          <div class="row"><span class="label">Contact</span><span class="val">${reservation.phone}</span></div>
          <p style="color: #666; font-size: 12px; margin-top: 24px;">Please present this verification to the reception upon arrival.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error verifying reservation');
  }
}

async function getUserReservations(req, res) {
  try {
    const reservations = Reservations.find({ userId: req.user.id });
    reservations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, reservations });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving reservations.' });
  }
}

module.exports = {
  createReservation,
  getReservation,
  verifyReservation,
  getUserReservations
};
