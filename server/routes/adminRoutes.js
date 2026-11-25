const express = require('express');
const router = express.Router();

const { authenticateAdmin, requireRole, requirePermission } = require('../middleware/adminAuth');
const { PERMISSIONS, ROLES } = require('../config/roles');

// Controllers
const { adminLogin, getAdminProfile, requestStaffAccess } = require('../controllers/adminAuthController');
const { getStaffList, getStaffRequests, approveStaffRequest, rejectStaffRequest, createStaff, updateStaff, deleteStaff, resetStaffPassword } = require('../controllers/adminStaffController');
const { getAllOrders, getOrderDetails, updateOrderStatus, assignDeliveryBoy } = require('../controllers/adminOrderController');
const { getDeliveries, getDeliveryBoys, addDeliveryBoy, updateDeliveryBoyAvailability, getMyAssignedDeliveries, updateMyDeliveryStatus } = require('../controllers/adminDeliveryController');
const { getProducts, createProduct, updateProduct, deleteProduct, getCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/adminProductController');
const { getInventory, createInventoryItem, adjustStock, deleteInventoryItem } = require('../controllers/adminInventoryController');
const { getCustomers, getCustomerDetails, updateCustomerStatus } = require('../controllers/adminCustomerController');
const { getReservations, updateReservationStatus } = require('../controllers/adminReservationController');
const { getPayments, recordCashPayment } = require('../controllers/adminPaymentController');
const { getDashboardOverview, getSalesReport } = require('../controllers/adminReportController');
const { getCoupons, createCoupon, updateCoupon, deleteCoupon } = require('../controllers/adminCouponController');
const { getReviews, moderateReview, deleteReview } = require('../controllers/adminReviewController');
const { getSettings, updateSettings } = require('../controllers/adminSettingsController');
const { getAuditLogs } = require('../controllers/adminAuditController');

// 1. Authentication
router.post('/auth/login', adminLogin);
router.get('/auth/me', authenticateAdmin, getAdminProfile);
router.post('/auth/request-access', requestStaffAccess);

// 2. Overview & Analytics
router.get('/overview', authenticateAdmin, getDashboardOverview);
router.get('/reports/sales', authenticateAdmin, requirePermission(PERMISSIONS.VIEW_REPORTS), getSalesReport);

// 3. Orders Management
router.get('/orders', authenticateAdmin, requirePermission(PERMISSIONS.VIEW_ORDERS), getAllOrders);
router.get('/orders/:id', authenticateAdmin, requirePermission(PERMISSIONS.VIEW_ORDERS), getOrderDetails);
router.put('/orders/:id/status', authenticateAdmin, requirePermission(PERMISSIONS.UPDATE_ORDER_STATUS), updateOrderStatus);
router.post('/orders/:id/assign-delivery', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_DELIVERIES), assignDeliveryBoy);

// 4. Deliveries Management
router.get('/deliveries', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_DELIVERIES), getDeliveries);
router.get('/deliveries/boys', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_DELIVERIES), getDeliveryBoys);
router.post('/deliveries/boys', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_DELIVERIES), addDeliveryBoy);
router.put('/deliveries/boys/:id/availability', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_DELIVERIES), updateDeliveryBoyAvailability);

// 4b. Delivery Boy Dedicated Endpoints
router.get('/delivery/my-orders', authenticateAdmin, requireRole(ROLES.DELIVERY_BOY), getMyAssignedDeliveries);
router.put('/delivery/orders/:orderId/status', authenticateAdmin, requireRole(ROLES.DELIVERY_BOY), updateMyDeliveryStatus);

// 5. Staff Management
router.get('/staff', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), getStaffList);
router.get('/staff/requests', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), getStaffRequests);
router.post('/staff/requests/:id/approve', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), approveStaffRequest);
router.post('/staff/requests/:id/reject', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), rejectStaffRequest);
router.post('/staff', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), createStaff);
router.put('/staff/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), updateStaff);
router.delete('/staff/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), deleteStaff);
router.post('/staff/:id/reset-password', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_STAFF), resetStaffPassword);

// 6. Products & Categories Management
router.get('/products', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PRODUCTS), getProducts);
router.post('/products', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PRODUCTS), createProduct);
router.put('/products/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PRODUCTS), updateProduct);
router.delete('/products/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PRODUCTS), deleteProduct);

router.get('/categories', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CATEGORIES), getCategories);
router.post('/categories', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CATEGORIES), createCategory);
router.put('/categories/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CATEGORIES), updateCategory);
router.delete('/categories/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CATEGORIES), deleteCategory);

// 7. Inventory Management
router.get('/inventory', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_INVENTORY), getInventory);
router.post('/inventory', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_INVENTORY), createInventoryItem);
router.post('/inventory/:id/adjust', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_INVENTORY), adjustStock);
router.delete('/inventory/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_INVENTORY), deleteInventoryItem);

// 8. Customers Management
router.get('/customers', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CUSTOMERS), getCustomers);
router.get('/customers/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CUSTOMERS), getCustomerDetails);
router.put('/customers/:id/status', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_CUSTOMERS), updateCustomerStatus);

// 9. Reservations Management
router.get('/reservations', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_RESERVATIONS), getReservations);
router.put('/reservations/:id/status', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_RESERVATIONS), updateReservationStatus);

// 10. Payments & Billing
router.get('/payments', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PAYMENTS), getPayments);
router.post('/payments/:orderId/cash', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_PAYMENTS), recordCashPayment);

// 11. Coupons & Promotions
router.get('/coupons', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_COUPONS), getCoupons);
router.post('/coupons', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_COUPONS), createCoupon);
router.put('/coupons/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_COUPONS), updateCoupon);
router.delete('/coupons/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_COUPONS), deleteCoupon);

// 12. Reviews & Moderation
router.get('/reviews', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_REVIEWS), getReviews);
router.put('/reviews/:id/moderate', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_REVIEWS), moderateReview);
router.delete('/reviews/:id', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_REVIEWS), deleteReview);

// 13. Audit Logs (Super Admin only)
router.get('/audit-logs', authenticateAdmin, requireRole(ROLES.SUPER_ADMIN), getAuditLogs);

// 14. Settings
router.get('/settings', authenticateAdmin, getSettings);
router.put('/settings', authenticateAdmin, requirePermission(PERMISSIONS.MANAGE_SETTINGS), updateSettings);

module.exports = router;
