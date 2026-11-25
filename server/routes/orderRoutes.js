const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.post('/', optionalAuth, orderController.createOrder);
router.post('/sync-local', optionalAuth, orderController.syncLocalOrders);
router.get('/my-orders', authenticate, orderController.getUserOrders);
router.get('/:id', optionalAuth, orderController.getOrder);

module.exports = router;
