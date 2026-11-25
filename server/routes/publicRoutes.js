const express = require('express');
const router = express.Router();

const { getPublicMenu } = require('../controllers/adminProductController');
const { validateCouponPublic } = require('../controllers/adminCouponController');
const { submitReviewPublic } = require('../controllers/adminReviewController');
const { getSettings } = require('../controllers/adminSettingsController');

router.get('/menu', getPublicMenu);
router.post('/coupons/validate', validateCouponPublic);
router.post('/reviews', submitReviewPublic);
router.get('/settings', getSettings);

module.exports = router;
