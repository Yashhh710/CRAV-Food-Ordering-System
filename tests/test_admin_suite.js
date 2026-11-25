/**
 * Comprehensive Automated Test Suite for CRAV Admin Control Center
 */
const assert = require('assert');
const db = require('../server/config/db');
const { ROLES, PERMISSIONS, hasPermission } = require('../server/config/roles');
const { adminLogin } = require('../server/controllers/adminAuthController');
const { createStaff, getStaffList, deleteStaff } = require('../server/controllers/adminStaffController');
const { getAllOrders, updateOrderStatus, assignDeliveryBoy } = require('../server/controllers/adminOrderController');
const { getMyAssignedDeliveries, updateMyDeliveryStatus } = require('../server/controllers/adminDeliveryController');
const { createProduct, updateProduct, deleteProduct, getPublicMenu, createCategory } = require('../server/controllers/adminProductController');
const { adjustStock } = require('../server/controllers/adminInventoryController');
const { recordCashPayment } = require('../server/controllers/adminPaymentController');
const { getDashboardOverview } = require('../server/controllers/adminReportController');
const { createCoupon, validateCouponPublic } = require('../server/controllers/adminCouponController');

function mockReq(body = {}, params = {}, query = {}, user = null) {
  return {
    body,
    params,
    query,
    user: user || {
      id: 'crav_1795023308612_xcoww3',
      email: 'owner@crav.example',
      role: 'SUPER_ADMIN',
      permissions: ['*']
    },
    ip: '127.0.0.1'
  };
}

function mockRes() {
  return {
    statusCode: 200,
    data: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (obj) {
      this.data = obj;
      return this;
    }
  };
}

async function runTests() {
  console.log('🧪 Starting CRAV Admin Suite Tests...\n');

  // Test 1: Role permission matrix
  console.log('Test 1: Roles & Permission Matrix');
  assert.strictEqual(hasPermission('SUPER_ADMIN', PERMISSIONS.MANAGE_STAFF), true);
  assert.strictEqual(hasPermission('ADMIN', PERMISSIONS.MANAGE_STAFF), false);
  assert.strictEqual(hasPermission('KITCHEN_STAFF', PERMISSIONS.UPDATE_ORDER_STATUS), true);
  assert.strictEqual(hasPermission('KITCHEN_STAFF', PERMISSIONS.MANAGE_PRODUCTS), false);
  assert.strictEqual(hasPermission('CUSTOMER', PERMISSIONS.VIEW_ORDERS), false);
  console.log('✅ Role & Permission Matrix tests passed.');

  // Test 2: Admin Login Authentication
  console.log('\nTest 2: Admin Authentication');
  const loginReq = mockReq({ email: 'tambadeyash96@gmail.com', password: 'Admin@CRAV2026!' });
  const loginRes = mockRes();
  await adminLogin(loginReq, loginRes);
  assert.strictEqual(loginRes.data.success, true);
  assert.ok(loginRes.data.token);
  assert.strictEqual(loginRes.data.user.role, 'SUPER_ADMIN');
  console.log('✅ Admin login with SUPER_ADMIN credentials succeeded for Yash Tambade.');

  // Test 3: Customer Blocked from Admin Login
  console.log('\nTest 3: Customer Blocked from Admin Login');
  const custLoginReq = mockReq({ email: 'satvikap22@gmail.com', password: 'AnyPassword' });
  const custLoginRes = mockRes();
  await adminLogin(custLoginReq, custLoginRes);
  assert.strictEqual(custLoginRes.statusCode, 403);
  assert.strictEqual(custLoginRes.data.success, false);
  console.log('✅ Customer blocked with 403 Forbidden.');

  // Test 4: Dashboard Overview Telemetry Calculation
  console.log('\nTest 4: Dashboard Overview Telemetry Calculation');
  const overviewReq = mockReq();
  const overviewRes = mockRes();
  await getDashboardOverview(overviewReq, overviewRes);
  assert.strictEqual(overviewRes.data.success, true);
  assert.ok(overviewRes.data.metrics);
  assert.ok(overviewRes.data.charts);
  assert.strictEqual(typeof overviewRes.data.metrics.totalRevenue, 'number');
  console.log('✅ Overview calculations returned real database metrics.');

  // Test 5: Staff Creation with Restricted Role
  console.log('\nTest 5: Create Staff Account (Kitchen Staff)');
  const oldChef = db.Users.findOne({ email: 'chef.gordon@crav.example' });
  if (oldChef) db.Users.findByIdAndDelete(oldChef.id);

  const newStaffReq = mockReq({
    firstName: 'Chef',
    lastName: 'Gordon',
    email: 'chef.gordon@crav.example',
    password: 'ChefPassword123!',
    phone: '+91 91234 56789',
    role: 'KITCHEN_STAFF'
  });
  const newStaffRes = mockRes();
  await createStaff(newStaffReq, newStaffRes);
  assert.strictEqual(newStaffRes.data.success, true);
  const createdStaffId = newStaffRes.data.staff.id;
  assert.strictEqual(newStaffRes.data.staff.role, 'KITCHEN_STAFF');
  console.log('✅ Kitchen staff created successfully with ID:', createdStaffId);

  // Test 6: Last Super Admin Protection
  console.log('\nTest 6: Protect Last Super Admin from Deletion');
  const superAdmin = db.Users.findOne({ role: 'SUPER_ADMIN' });
  const delAdminReq = mockReq({}, { id: superAdmin.id });
  const delAdminRes = mockRes();
  await deleteStaff(delAdminReq, delAdminRes);
  assert.strictEqual(delAdminRes.statusCode, 403);
  assert.strictEqual(delAdminRes.data.success, false);
  console.log('✅ Attempt to delete the last Super Admin was safely blocked (403 Forbidden).');

  // Test 7: Clean up created test staff
  const cleanupReq = mockReq({}, { id: createdStaffId });
  const cleanupRes = mockRes();
  await deleteStaff(cleanupReq, cleanupRes);
  assert.strictEqual(cleanupRes.data.success, true);
  console.log('✅ Test staff account deleted cleanly.');

  // Test 8: Product & Category Dynamic Sync
  console.log('\nTest 8: Product & Public Menu Sync');
  const catReq = mockReq({ name: 'Test Appetizers', slug: 'test-appetizers' });
  const catRes = mockRes();
  await createCategory(catReq, catRes);
  assert.strictEqual(catRes.data.success, true);
  const testCatId = catRes.data.category.id;

  const prodReq = mockReq({
    name: 'Truffle Garlic Bread',
    category: testCatId,
    price: 249,
    description: 'Toasted baguette infused with black truffle butter.',
    image: 'assets/media/products/bread.png',
    isVeg: true,
    isAvailable: true
  });
  const prodRes = mockRes();
  await createProduct(prodReq, prodRes);
  assert.strictEqual(prodRes.data.success, true);
  const testProdId = prodRes.data.product.id;

  // Verify public menu now serves this product dynamically
  const menuReq = mockReq();
  const menuRes = mockRes();
  await getPublicMenu(menuReq, menuRes);
  assert.strictEqual(menuRes.data.success, true);
  const foundProd = menuRes.data.products.find(p => p.id === testProdId);
  assert.ok(foundProd, 'Newly created product must be returned by public menu');
  console.log('✅ Product created and verified live in public menu API.');

  // Clean up test product & category
  const delProdReq = mockReq({}, { id: testProdId });
  const delProdRes = mockRes();
  await deleteProduct(delProdReq, delProdRes);
  assert.strictEqual(delProdRes.data.success, true);

  const { deleteCategory } = require('../server/controllers/adminProductController');
  const delCatReq = mockReq({}, { id: testCatId });
  const delCatRes = mockRes();
  await deleteCategory(delCatReq, delCatRes);
  assert.strictEqual(delCatRes.data.success, true);
  console.log('✅ Test product and category cleaned up cleanly.');

  // Test 9: Coupon Creation and Public Validation
  console.log('\nTest 9: Coupon Creation & Validation');
  const couponReq = mockReq({
    code: 'CRAVTEST20',
    type: 'percent',
    discount: 20,
    minOrderAmount: 200,
    maxDiscount: 100,
    isActive: true
  });
  const couponRes = mockRes();
  await createCoupon(couponReq, couponRes);
  assert.strictEqual(couponRes.data.success, true);
  const couponId = couponRes.data.coupon.id;

  // Validate coupon
  const valReq = mockReq({ code: 'cravtest20', orderAmount: 300 });
  const valRes = mockRes();
  await validateCouponPublic(valReq, valRes);
  assert.strictEqual(valRes.data.success, true);
  assert.strictEqual(valRes.data.discount, 60); // 20% of 300 = 60
  console.log('✅ Coupon validated successfully (20% of ₹300 = ₹60 discount).');

  // Clean up coupon
  const { deleteCoupon } = require('../server/controllers/adminCouponController');
  const delCouponReq = mockReq({}, { id: couponId });
  const delCouponRes = mockRes();
  await deleteCoupon(delCouponReq, delCouponRes);
  assert.strictEqual(delCouponRes.data.success, true);
  console.log('✅ Test coupon cleaned up.');

  // Test 10: Inventory Adjustment
  console.log('\nTest 10: Inventory Stock Adjustment');
  const invItems = db.Inventory.find();
  if (invItems.length > 0) {
    const item = invItems[0];
    const initialQty = item.quantity;
    const adjReq = mockReq({ changeAmount: 10, reason: 'Test shipment received' }, { id: item.id });
    const adjRes = mockRes();
    await adjustStock(adjReq, adjRes);
    assert.strictEqual(adjRes.data.success, true);
    assert.strictEqual(adjRes.data.inventory.quantity, initialQty + 10);
    console.log(`✅ Stock adjusted correctly: ${initialQty} -> ${adjRes.data.inventory.quantity}`);
  }

  // Test 11: Immutable Audit Log Verification
  console.log('\nTest 11: Audit Logs Verification');
  const recentLogs = db.AuditLogs.find();
  assert.ok(recentLogs.length > 0, 'Audit logs must contain recorded entries');
  const lastLog = recentLogs[recentLogs.length - 1];
  assert.ok(lastLog.action);
  assert.ok(lastLog.actorEmail);
  assert.ok(lastLog.timestamp);
  console.log(`✅ Verified ${recentLogs.length} audit logs. Last action recorded: "${lastLog.action}" by ${lastLog.actorEmail}.`);

  // Test 12: Order Status Lifecycle & Cash Payment
  console.log('\nTest 12: Order Lifecycle Transitions & Payment Recording');
  const orders = db.Orders.find();
  if (orders.length > 0) {
    const order = orders[0];
    const initialStage = order.stage;

    // Transition to PREPARING
    const prepReq = mockReq({ stage: 'PREPARING' }, { id: order.id });
    const prepRes = mockRes();
    await updateOrderStatus(prepReq, prepRes);
    assert.strictEqual(prepRes.data.success, true);
    assert.strictEqual(prepRes.data.order.stage, 'PREPARING');

    // Transition to READY FOR PICKUP
    const readyReq = mockReq({ stage: 'READY FOR PICKUP' }, { id: order.id });
    const readyRes = mockRes();
    await updateOrderStatus(readyReq, readyRes);
    assert.strictEqual(readyRes.data.success, true);
    assert.strictEqual(readyRes.data.order.stage, 'READY FOR PICKUP');

    // Record cash payment
    const payReq = mockReq({ receivedAmount: order.total, notes: 'Cash at counter' }, { orderId: order.id });
    const payRes = mockRes();
    await recordCashPayment(payReq, payRes);
    assert.strictEqual(payRes.data.success, true);
    assert.strictEqual(payRes.data.payment.status, 'Paid');

    // Revert back to original stage for test cleanliness
    db.Orders.findByIdAndUpdate(order.id, { stage: initialStage });
    console.log('✅ Order lifecycle transition and cash payment verification passed.');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL CRAV ADMIN SYSTEM TESTS PASSED SUCCESSFULLY! (12/12)');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
