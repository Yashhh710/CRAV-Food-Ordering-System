const express = require('express');
const router = express.Router();
const reservationController = require('../controllers/reservationController');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.post('/create', optionalAuth, reservationController.createReservation);
router.get('/my-reservations', authenticate, reservationController.getUserReservations);
router.get('/ticket/:id', reservationController.getReservation);
router.get('/verify/:id', reservationController.verifyReservation);

module.exports = router;
