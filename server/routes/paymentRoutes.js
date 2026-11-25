const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { optionalAuth } = require('../middleware/auth');

router.post('/create-demo-qr', optionalAuth, paymentController.createDemoQrPayment);
router.get('/status/:orderId', paymentController.getPaymentStatus);
router.post('/complete-demo-payment', paymentController.completeDemoPayment);
router.get('/order-details/:orderId', paymentController.getOrderDetailsForPay);

module.exports = router;
