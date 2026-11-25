/**
 * CRAV RESTAURANT MANAGEMENT & ADMIN CONTROL CENTER
 * Client-Side Application Engine
 */

(function (window, document, $) {
  'use strict';

  var salesChartInstance = null;
  var orderStatusChartInstance = null;
  var currentUser = null;
  var currentOrdersCache = [];
  var currentProductsCache = [];
  var currentCategoriesCache = [];
  var currentOrderForReceipt = null;

  var AdminApp = {
    livePollTimer: null,
    lastKnownOrdersSummary: null,
    currentView: 'overview',

    // 1. Initialization
    init: async function () {
      var token = localStorage.getItem('crav_admin_token');
      var userRaw = localStorage.getItem('crav_admin_user');

      if (!token || !userRaw) {
        window.location.replace('admin-login.html');
        return;
      }

      try {
        currentUser = JSON.parse(userRaw);
      } catch (e) {
        window.location.replace('admin-login.html');
        return;
      }

      // Verify token freshness with server
      var verifyOk = await AdminApp.verifySession();
      if (!verifyOk) return;

      AdminApp.setupSidebar();
      AdminApp.setupRolePermissions();
      AdminApp.bindEvents();

      // Determine initial view based on role
      var initialView = 'overview';
      var role = (currentUser.role || '').toUpperCase();
      if (role === 'DELIVERY_BOY') initialView = 'my-deliveries';
      else if (role === 'KITCHEN_STAFF') initialView = 'kitchen';
      else if (role === 'INVENTORY_MANAGER') initialView = 'inventory';
      else if (role === 'CUSTOMER_SUPPORT') initialView = 'customers';
      else if (role === 'CASHIER') initialView = 'payments';

      AdminApp.switchView(initialView);
      AdminApp.startLivePolling();
    },

    // 2. Session verification
    verifySession: async function () {
      try {
        var res = await AdminApp.api('/api/admin/auth/me');
        if (!res.ok || !res.data.success) {
          AdminApp.logout();
          return false;
        }
        currentUser = res.data.user;
        localStorage.setItem('crav_admin_user', JSON.stringify(currentUser));
        return true;
      } catch (e) {
        AdminApp.logout();
        return false;
      }
    },

    // 3. API helper with automatic auth header and error handling
    api: async function (url, method, body) {
      method = method || 'GET';
      var token = localStorage.getItem('crav_admin_token');
      var headers = {
        'Accept': 'application/json'
      };
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
      if (body && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      var opts = {
        method: method,
        headers: headers
      };

      if (body) {
        opts.body = (body instanceof FormData) ? body : JSON.stringify(body);
      }

      var res = await fetch(url, opts);
      var data = {};
      try {
        data = await res.json();
      } catch (e) {}

      if (res.status === 401 || res.status === 403) {
        if (data.message && data.message.includes('expired')) {
          AdminApp.showToast('Session expired. Please log in again.', 'error');
          setTimeout(AdminApp.logout, 1200);
        }
      }

      return { ok: res.ok, status: res.status, data: data };
    },

    // 4. Role & Sidebar Setup
    setupSidebar: function () {
      var name = (currentUser.firstName || '') + ' ' + (currentUser.lastName || '');
      var role = (currentUser.role || 'STAFF').toUpperCase();
      var initial = (currentUser.firstName || 'C').charAt(0).toUpperCase();

      $('#sidebarStaffName').text(name.trim() || currentUser.email);
      $('#sidebarStaffRole').text(role.replace(/_/g, ' '));
      $('#sidebarAvatar').text(initial);
    },

    setupRolePermissions: function () {
      var role = (currentUser.role || '').toUpperCase();
      var perms = currentUser.permissions || [];
      var isSuper = (role === 'SUPER_ADMIN' || perms.includes('*'));

      $('.nav-item-btn').each(function () {
        var $btn = $(this);
        var v = $btn.data('view');
        var allowed = true;

        if (!isSuper) {
          if (role === 'DELIVERY_BOY') {
            allowed = (v === 'my-deliveries');
          } else if (role === 'KITCHEN_STAFF') {
            allowed = (v === 'kitchen');
          } else if (role === 'INVENTORY_MANAGER') {
            allowed = (v === 'inventory');
          } else if (role === 'CASHIER') {
            allowed = (v === 'payments');
          } else if (role === 'CUSTOMER_SUPPORT') {
            allowed = (v === 'customers' || v === 'reviews');
          } else if (role === 'ORDER_MANAGER') {
            allowed = (v === 'orders' || v === 'deliveries');
          } else {
            var reqPerm = $btn.data('perm');
            var reqRole = $btn.data('role');
            if (reqRole && reqRole.toUpperCase() !== role) allowed = false;
            if (reqPerm && !perms.includes(reqPerm)) allowed = false;
          }
        }

        if (allowed) {
          $btn.show();
        } else {
          $btn.hide();
        }
      });
    },

    // 5. Navigation & View Switching
    switchView: function (viewName) {
      var role = (currentUser.role || '').toUpperCase();
      var isSuper = (role === 'SUPER_ADMIN' || (currentUser.permissions || []).includes('*'));

      // Enforce strict station lock for staff roles
      if (!isSuper) {
        if (role === 'DELIVERY_BOY' && viewName !== 'my-deliveries') viewName = 'my-deliveries';
        else if (role === 'KITCHEN_STAFF' && viewName !== 'kitchen') viewName = 'kitchen';
        else if (role === 'INVENTORY_MANAGER' && viewName !== 'inventory') viewName = 'inventory';
        else if (role === 'CASHIER' && viewName !== 'payments') viewName = 'payments';
        else if (role === 'CUSTOMER_SUPPORT' && viewName !== 'customers' && viewName !== 'reviews') viewName = 'customers';
        else if (role === 'ORDER_MANAGER' && viewName !== 'orders' && viewName !== 'deliveries') viewName = 'orders';
      }

      $('.view-panel').removeClass('active');
      $('.nav-item-btn').removeClass('active');

      var $targetPanel = $('#view-' + viewName);
      var $targetBtn = $('.nav-item-btn[data-view="' + viewName + '"]');

      if ($targetPanel.length) {
        $targetPanel.addClass('active');
      } else {
        $('#view-overview').addClass('active');
        viewName = 'overview';
      }

      AdminApp.currentView = viewName;

      if ($targetBtn.length) {
        $targetBtn.addClass('active');
      }

      // Update Topbar Title
      var titles = {
        'overview': ['Dashboard Overview', 'Real-time CRAV restaurant management telemetry'],
        'orders': ['Order Management', 'Filter, inspect, and transition customer orders'],
        'kitchen': ['Kitchen Display (KDS)', 'Live kitchen tickets and food prep timers'],
        'deliveries': ['Delivery Dispatch', 'Driver assignment, workload monitoring, and active routes'],
        'my-deliveries': ['My Assigned Deliveries', 'Personal delivery partner console'],
        'products': ['Menu Products', 'Catalog items, prices, stock levels and dietary tags'],
        'categories': ['Menu Categories', 'Category arrangement and display orders'],
        'inventory': ['Inventory & Stock', 'Raw ingredients, packaging supplies, and stock intake'],
        'customers': ['Customer Directory', 'Customer profiles, order histories, and account status'],
        'staff': ['Staff Accounts & Roles', 'Role-based access control and employee management'],
        'reservations': ['Table Reservations', 'Dining room bookings and QR ticket verification'],
        'payments': ['Payments & Billing', 'Financial records and simulated QR payment tracking'],
        'reports': ['Sales Analytics & Reports', 'Aggregated revenue, popularity trends, and CSV exports'],
        'coupons': ['Discount Coupons', 'Promotions, percentage discounts, and voucher limits'],
        'reviews': ['Customer Reviews', 'Customer feedback ratings and admin replies'],
        'audit-logs': ['Security Audit Trail', 'Immutable administrative history and actor tracking'],
        'settings': ['Restaurant Settings', 'Operational hours, tax rules, delivery rates, and announcements']
      };

      var t = titles[viewName] || ['CRAV Control', 'Restaurant Management System'];
      $('#topbarTitle').text(t[0]);
      $('#topbarSubtitle').text(t[1]);

      // Load data for view
      AdminApp.loadViewData(viewName);
    },

    loadViewData: function (viewName) {
      switch (viewName) {
        case 'overview': AdminApp.loadOverview(); break;
        case 'orders': AdminApp.loadOrders(1); break;
        case 'kitchen': AdminApp.loadKitchen(); break;
        case 'deliveries': AdminApp.loadDeliveries(); break;
        case 'my-deliveries': AdminApp.loadMyDeliveries(); break;
        case 'products': AdminApp.loadProducts(); break;
        case 'categories': AdminApp.loadCategories(); break;
        case 'inventory': AdminApp.loadInventory(); break;
        case 'customers': AdminApp.loadCustomers(); break;
        case 'staff': AdminApp.loadStaff(); break;
        case 'reservations': AdminApp.loadReservations(); break;
        case 'payments': AdminApp.loadPayments(); break;
        case 'reports': AdminApp.loadSalesReport(); break;
        case 'coupons': AdminApp.loadCoupons(); break;
        case 'reviews': AdminApp.loadReviews(); break;
        case 'audit-logs': AdminApp.loadAuditLogs(); break;
        case 'settings': AdminApp.loadSettings(); break;
      }
    },

    // 6. View Data Loaders
    loadOverview: async function () {
      var res = await AdminApp.api('/api/admin/overview');
      if (!res.ok || !res.data.success) return;

      var d = res.data;
      var m = d.metrics;

      $('#ovTodayRevenue').text('₹' + (m.todayRevenue || 0).toLocaleString());
      $('#ovTodayOrders').text(m.counts ? (m.counts.today || 0) : 0);
      $('#ovActiveDeliveries').text(m.counts ? (m.counts.outForDelivery || 0) : 0);
      $('#ovPendingReservations').text(m.pendingReservations || 0);

      // Nav badges
      $('#navOrdersBadge').text(m.counts ? (m.counts.pending + m.counts.confirmed) : 0);
      $('#navKitchenBadge').text(m.counts ? (m.counts.preparing || 0) : 0);

      // Charts
      AdminApp.renderSalesTrendChart(d.charts ? d.charts.salesTrend : []);
      AdminApp.renderOrderStatusChart(m.counts || {});

      // Recent orders table
      var $ordersBody = $('#overviewRecentOrdersBody');
      $ordersBody.empty();
      if (!d.recentOrders || !d.recentOrders.length) {
        $ordersBody.html('<tr><td colspan="6" class="text-center py-4 text-muted">No orders found.</td></tr>');
      } else {
        d.recentOrders.forEach(function (o) {
          $ordersBody.append(
            '<tr>' +
              '<td><b class="text-danger">#' + esc(o.id) + '</b></td>' +
              '<td>' + esc(o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Guest')) + '</td>' +
              '<td><b>₹' + (Number(o.total) || 0) + '</b></td>' +
              '<td>' + AdminApp.getStatusBadge(o.stage) + '</td>' +
              '<td><small class="text-muted">' + AdminApp.formatTimeAgo(o.createdAt) + '</small></td>' +
              '<td><button type="button" class="btn-action" onclick="AdminApp.openOrderDetail(\'' + esc(o.id) + '\')"><i class="fa-solid fa-eye"></i></button></td>' +
            '</tr>'
          );
        });
      }

      // Popular items
      var $popList = $('#overviewPopularList');
      $popList.empty();
      if (!d.popularProducts || !d.popularProducts.length) {
        $popList.html('<div class="text-center py-4 text-muted">No popular items recorded yet.</div>');
      } else {
        d.popularProducts.forEach(function (p) {
          $popList.append(
            '<div class="d-flex align-items-center justify-content-between py-2 border-bottom">' +
              '<div class="d-flex align-items-center gap-2">' +
                '<img src="' + esc(p.image || 'assets/models/menu/bbq-chicken-pizza.png') + '" style="width:36px; height:36px; border-radius:8px; object-fit:contain;">' +
                '<div>' +
                  '<div class="fw-bold" style="font-size:13px;">' + esc(p.name) + '</div>' +
                  '<small class="text-muted">' + (p.count || 0) + ' ordered</small>' +
                '</div>' +
              '</div>' +
              '<div class="fw-bold text-danger">₹' + (Number(p.revenue) || 0) + '</div>' +
            '</div>'
          );
        });
      }
    },

    renderSalesTrendChart: function (dataPoints) {
      var ctx = document.getElementById('salesTrendChart');
      if (!ctx) return;

      var labels = dataPoints.map(function (p) { return p.label; });
      var revenues = dataPoints.map(function (p) { return p.revenue; });
      var orders = dataPoints.map(function (p) { return p.orders; });

      if (salesChartInstance) salesChartInstance.destroy();

      salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Revenue (₹)',
              data: revenues,
              borderColor: '#D90019',
              backgroundColor: 'rgba(217, 0, 25, 0.08)',
              fill: true,
              tension: 0.35,
              borderWidth: 3,
              pointBackgroundColor: '#D90019',
              pointRadius: 4
            },
            {
              label: 'Orders Count',
              data: orders,
              borderColor: '#3B82F6',
              backgroundColor: 'transparent',
              borderWidth: 2,
              borderDash: [5, 5],
              pointBackgroundColor: '#3B82F6',
              pointRadius: 3,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: '#EDF2F7' } },
            y1: { position: 'right', beginAtZero: true, grid: { display: false } },
            x: { grid: { display: false } }
          }
        }
      });
    },

    renderOrderStatusChart: function (counts) {
      var ctx = document.getElementById('orderStatusChart');
      if (!ctx) return;

      if (orderStatusChartInstance) orderStatusChartInstance.destroy();

      orderStatusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled'],
          datasets: [{
            data: [
              counts.pending || 0,
              counts.confirmed || 0,
              counts.preparing || 0,
              counts.outForDelivery || 0,
              counts.delivered || 0,
              counts.cancelled || 0
            ],
            backgroundColor: ['#F59E0B', '#3B82F6', '#8B5CF6', '#F97316', '#22C55E', '#EF4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
          },
          cutout: '68%'
        }
      });
    },

    // 7. Orders Management
    loadOrders: async function (page) {
      page = page || 1;
      var search = $('#orderSearchInput').val();
      var status = $('#orderStatusFilter').val();
      var payment = $('#orderPaymentFilter').val();

      var qs = '?page=' + page + '&limit=15';
      if (search) qs += '&search=' + encodeURIComponent(search);
      if (status && status !== 'all') qs += '&status=' + encodeURIComponent(status);
      if (payment && payment !== 'all') qs += '&paymentStatus=' + encodeURIComponent(payment);

      var res = await AdminApp.api('/api/admin/orders' + qs);
      var $body = $('#ordersTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.orders.length) {
        $body.html('<tr><td colspan="9" class="text-center py-5 text-muted">No orders match the selected filters.</td></tr>');
        $('#ordersPaginationInfo').text('Showing 0 of 0');
        return;
      }

      currentOrdersCache = res.data.orders;
      var total = res.data.total;
      var totalPages = res.data.totalPages;
      $('#ordersPaginationInfo').text('Showing page ' + page + ' of ' + totalPages + ' (' + total + ' total orders)');

      $('#orderPrevPageBtn').prop('disabled', page <= 1).off('click').on('click', function () { AdminApp.loadOrders(page - 1); });
      $('#orderNextPageBtn').prop('disabled', page >= totalPages).off('click').on('click', function () { AdminApp.loadOrders(page + 1); });

      res.data.orders.forEach(function (o) {
        var itemsSummary = Array.isArray(o.items)
          ? o.items.map(function (it) { return (it.quantity || 1) + 'x ' + (it.name || it.title); }).join(', ')
          : 'Items';
        if (itemsSummary.length > 35) itemsSummary = itemsSummary.substring(0, 35) + '...';

        var customerName = o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Guest Customer');
        var payBadge = (o.payment?.status === 'Paid')
          ? '<span class="badge bg-success">Paid</span>'
          : '<span class="badge bg-warning text-dark">Pending</span>';

        var driverName = o.deliveryBoy?.name ? '<i class="fa-solid fa-person-biking text-primary me-1"></i> ' + esc(o.deliveryBoy.name) : '<span class="text-muted">Unassigned</span>';

        $body.append(
          '<tr>' +
            '<td><b class="text-danger">#' + esc(o.id) + '</b></td>' +
            '<td>' +
              '<div class="fw-bold">' + esc(customerName) + '</div>' +
              '<small class="text-muted">' + esc(o.customer?.phone || o.customer?.email || 'N/A') + '</small>' +
            '</td>' +
            '<td><span title="' + esc(itemsSummary) + '">' + esc(itemsSummary) + '</span></td>' +
            '<td><b>₹' + (Number(o.total) || 0) + '</b></td>' +
            '<td>' + payBadge + '</td>' +
            '<td>' + AdminApp.getStatusBadge(o.stage) + '</td>' +
            '<td>' + driverName + '</td>' +
            '<td><small class="text-muted">' + AdminApp.formatDate(o.createdAt) + '</small></td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn-action" onclick="AdminApp.openOrderDetail(\'' + esc(o.id) + '\')" title="Inspect Order Details"><i class="fa-solid fa-eye"></i></button>' +
                '<button type="button" class="btn-action" onclick="AdminApp.quickPrintReceipt(\'' + esc(o.id) + '\')" title="Print Order Receipt"><i class="fa-solid fa-print"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    openOrderDetail: async function (orderId) {
      var res = await AdminApp.api('/api/admin/orders/' + encodeURIComponent(orderId));
      if (!res.ok || !res.data.success) {
        AdminApp.showToast('Could not load order details.', 'error');
        return;
      }

      var o = res.data.order;
      currentOrderForReceipt = o;

      $('#orderDetailTitle').html('<i class="fa-solid fa-receipt text-danger me-2"></i> Order #' + esc(o.id));

      var itemsHtml = '';
      if (Array.isArray(o.items)) {
        itemsHtml = o.items.map(function (it) {
          var price = Number(it.price) || 0;
          var qty = Number(it.quantity) || 1;
          return '<div class="d-flex justify-content-between align-items-center py-2 border-bottom">' +
            '<div>' +
              '<div class="fw-bold">' + esc(it.name || it.title) + '</div>' +
              '<small class="text-muted">₹' + price + ' × ' + qty + '</small>' +
            '</div>' +
            '<div class="fw-bold">₹' + (price * qty) + '</div>' +
          '</div>';
        }).join('');
      }

      // Build timeline tree
      var timelineHtml = '';
      if (Array.isArray(o.timeline) && o.timeline.length) {
        timelineHtml = o.timeline.map(function (t) {
          return '<li class="mb-2">' +
            '<div class="fw-bold">' + esc(t.stage) + '</div>' +
            '<small class="text-muted">' + esc(t.note || '') + ' &bull; ' + AdminApp.formatDate(t.timestamp) + '</small>' +
          '</li>';
        }).join('');
      } else {
        timelineHtml = '<li class="text-muted">No timeline events recorded yet.</li>';
      }

      var content = '' +
        '<div class="row g-4">' +
          '<div class="col-md-7">' +
            '<h6 class="fw-bold mb-3">Order Items</h6>' +
            '<div class="bg-light p-3 rounded mb-3">' + itemsHtml + '</div>' +
            '<div class="d-flex justify-content-between mb-1"><span>Subtotal:</span><span>₹' + (o.subtotal || o.total) + '</span></div>' +
            '<div class="d-flex justify-content-between mb-1"><span>Delivery Fee:</span><span>₹' + (o.delivery || 0) + '</span></div>' +
            (o.discount ? '<div class="d-flex justify-content-between mb-1 text-success"><span>Discount:</span><span>-₹' + o.discount + '</span></div>' : '') +
            '<div class="d-flex justify-content-between fw-bold fs-5 border-top pt-2 mt-2"><span>Total Amount:</span><span class="text-danger">₹' + o.total + '</span></div>' +
          '</div>' +
          '<div class="col-md-5">' +
            '<h6 class="fw-bold mb-2">Customer & Delivery</h6>' +
            '<div class="bg-light p-3 rounded mb-3" style="font-size:13px;">' +
              '<div><b>Name:</b> ' + esc(o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Guest Customer')) + '</div>' +
              '<div><b>Phone:</b> ' + esc(o.customer?.phone || 'N/A') + '</div>' +
              '<div><b>Email:</b> ' + esc(o.customer?.email || 'N/A') + '</div>' +
              '<div class="mt-2"><b>Address:</b> ' + esc(o.customer?.address || 'Demonstration Address') + '</div>' +
            '</div>' +
            '<h6 class="fw-bold mb-2">Change Order Status</h6>' +
            '<div class="input-group input-group-sm mb-3">' +
              '<select id="modalStatusSelect" class="form-select">' +
                '<option value="ORDER CONFIRMED">Order Confirmed</option>' +
                '<option value="PREPARING">Preparing</option>' +
                '<option value="READY FOR PICKUP">Ready for Pickup</option>' +
                '<option value="ASSIGNED TO DELIVERY BOY">Assigned to Driver</option>' +
                '<option value="PICKED UP">Picked Up</option>' +
                '<option value="OUT FOR DELIVERY">Out for Delivery</option>' +
                '<option value="DELIVERED">Delivered</option>' +
                '<option value="CANCELLED">Cancel Order</option>' +
                '<option value="REJECTED">Reject Order</option>' +
              '</select>' +
              '<button type="button" class="btn btn-danger" onclick="AdminApp.submitOrderStatusChange(\'' + esc(o.id) + '\')">Update</button>' +
            '</div>' +
            '<h6 class="fw-bold mb-2">Status Timeline</h6>' +
            '<ul style="padding-left: 20px; font-size: 12.5px;">' + timelineHtml + '</ul>' +
          '</div>' +
        '</div>';

      $('#orderDetailBody').html(content);
      $('#modalStatusSelect').val(o.stage || 'ORDER PLACED');

      var modal = new bootstrap.Modal(document.getElementById('orderDetailModal'));
      modal.show();
    },

    submitOrderStatusChange: async function (orderId) {
      var newStage = $('#modalStatusSelect').val();
      var reason = '';
      if (newStage === 'CANCELLED' || newStage === 'REJECTED') {
        reason = prompt('Please enter a cancellation / rejection reason:');
        if (!reason) {
          AdminApp.showToast('Action cancelled: Reason is mandatory.', 'error');
          return;
        }
      }

      var res = await AdminApp.api('/api/admin/orders/' + encodeURIComponent(orderId) + '/status', 'PUT', {
        stage: newStage,
        note: reason || ('Status updated via control center to ' + newStage)
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Order status updated to ' + newStage, 'success');
        bootstrap.Modal.getInstance(document.getElementById('orderDetailModal')).hide();
        AdminApp.loadOrders();
      } else {
        AdminApp.showToast(res.data.message || 'Failed to update order status.', 'error');
      }
    },

    // 8. Kitchen Display System (KDS)
    loadKitchen: async function () {
      var res = await AdminApp.api('/api/admin/orders?limit=100');
      var $grid = $('#kitchenTicketsGrid');
      $grid.empty();

      if (!res.ok || !res.data.success || !res.data.orders.length) {
        $grid.html('<div class="col-12 text-center py-5 text-muted">No active kitchen orders found.</div>');
        return;
      }

      var kitchenOrders = res.data.orders.filter(function (o) {
        var s = (o.stage || '').toUpperCase();
        return ['ORDER CONFIRMED', 'ORDER PLACED', 'PREPARING', 'READY FOR PICKUP'].includes(s);
      });

      if (!kitchenOrders.length) {
        $grid.html('<div class="col-12 text-center py-5 text-muted"><i class="fa-regular fa-clipboard-check fs-2 text-success mb-2 d-block"></i>All orders are prepped and cleared! Zero active cooking tickets.</div>');
        return;
      }

      kitchenOrders.forEach(function (o) {
        var isPrepping = (o.stage || '').toUpperCase() === 'PREPARING';
        var isReady = (o.stage || '').toUpperCase() === 'READY FOR PICKUP';

        var itemsList = '';
        if (Array.isArray(o.items)) {
          itemsList = o.items.map(function (it) {
            return '<li class="d-flex justify-content-between align-items-center py-1 border-bottom">' +
              '<span><b>' + (it.quantity || 1) + 'x</b> ' + esc(it.name || it.title) + '</span>' +
            '</li>';
          }).join('');
        }

        $grid.append(
          '<div class="col-xl-4 col-md-6">' +
            '<div class="card border-0 shadow-sm h-100 ' + (isReady ? 'border-start border-success border-4' : (isPrepping ? 'border-start border-danger border-4' : 'border-start border-warning border-4')) + '">' +
              '<div class="card-header bg-white d-flex justify-content-between align-items-center py-3">' +
                '<div>' +
                  '<span class="fw-bold fs-6 text-danger">#' + esc(o.id) + '</span>' +
                  '<div style="font-size: 11px;" class="text-muted">' + AdminApp.formatTimeAgo(o.createdAt) + '</div>' +
                '</div>' +
                AdminApp.getStatusBadge(o.stage) +
              '</div>' +
              '<div class="card-body">' +
                '<ul class="list-unstyled mb-0" style="font-size: 13.5px;">' + itemsList + '</ul>' +
              '</div>' +
              '<div class="card-footer bg-light border-0 d-flex gap-2 p-2">' +
                (!isPrepping && !isReady ? '<button type="button" class="btn btn-outline-danger btn-sm flex-fill" onclick="AdminApp.quickKitchenStatus(\'' + esc(o.id) + '\', \'PREPARING\')"><i class="fa-solid fa-fire me-1"></i> Start Cooking</button>' : '') +
                (isPrepping ? '<button type="button" class="btn btn-success btn-sm flex-fill" onclick="AdminApp.quickKitchenStatus(\'' + esc(o.id) + '\', \'READY FOR PICKUP\')"><i class="fa-solid fa-check me-1"></i> Mark Ready</button>' : '') +
                (isReady ? '<span class="text-success small fw-bold flex-fill text-center py-1"><i class="fa-solid fa-bell me-1"></i> Ready for Pickup</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>'
        );
      });
    },

    quickKitchenStatus: async function (orderId, targetStage) {
      var res = await AdminApp.api('/api/admin/orders/' + encodeURIComponent(orderId) + '/status', 'PUT', {
        stage: targetStage,
        note: 'Kitchen station marked order as ' + targetStage
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Order #' + orderId + ' updated to ' + targetStage, 'success');
        AdminApp.loadKitchen();
      } else {
        AdminApp.showToast(res.data.message || 'Error updating kitchen status.', 'error');
      }
    },

    // 9. Deliveries & Dispatch
    loadDeliveries: async function () {
      var filter = $('#deliveryFilterSelect').val() || 'ACTIVE';
      var res = await AdminApp.api('/api/admin/deliveries?status=' + encodeURIComponent(filter));
      var $body = $('#deliveriesTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.deliveries.length) {
        $body.html('<tr><td colspan="6" class="text-center py-5 text-muted">No delivery routes in this category.</td></tr>');
      } else {
        res.data.deliveries.forEach(function (o) {
          var customerInfo = '<b>' + esc(o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Customer')) + '</b><br><small class="text-muted">' + esc(o.customer?.phone || 'N/A') + '</small>';
          var driverBadge = o.deliveryBoy?.name ? '<span class="badge bg-primary"><i class="fa-solid fa-person-biking me-1"></i>' + esc(o.deliveryBoy.name) + '</span>' : '<span class="badge bg-secondary">Unassigned</span>';

          $body.append(
            '<tr>' +
              '<td><b class="text-danger">#' + esc(o.id) + '</b></td>' +
              '<td>' + customerInfo + '</td>' +
              '<td><small>' + esc(o.customer?.address || 'Doorstep Delivery') + '</small></td>' +
              '<td>' + driverBadge + '</td>' +
              '<td>' + AdminApp.getStatusBadge(o.stage) + '</td>' +
              '<td>' +
                '<button type="button" class="btn-action btn-primary-crav" onclick="AdminApp.promptAssignDriver(\'' + esc(o.id) + '\')"><i class="fa-solid fa-user-plus me-1"></i> Assign</button>' +
              '</td>' +
            '</tr>'
          );
        });
      }

      // Load driver workload list
      var boysRes = await AdminApp.api('/api/admin/deliveries/boys');
      var $boysList = $('#deliveryDriversWorkloadList');
      $boysList.empty();

      if (!boysRes.ok || !boysRes.data.success || !boysRes.data.deliveryBoys.length) {
        $boysList.html('<div class="text-center py-4 text-muted">No delivery drivers registered.</div>');
      } else {
        boysRes.data.deliveryBoys.forEach(function (b) {
          var availBadge = (b.availability === 'available')
            ? '<span class="badge bg-success">Available</span>'
            : (b.availability === 'busy' ? '<span class="badge bg-warning text-dark">Busy</span>' : '<span class="badge bg-secondary">Offline</span>');

          $boysList.append(
            '<div class="d-flex align-items-center justify-content-between py-2 border-bottom">' +
              '<div>' +
                '<div class="fw-bold" style="font-size:13px;">' + esc(b.name) + ' ' + availBadge + '</div>' +
                '<small class="text-muted">' + esc(b.phone) + ' &bull; ' + esc(b.vehicle) + '</small>' +
              '</div>' +
              '<div class="text-end">' +
                '<div class="badge bg-light text-dark border">' + (b.activeOrders || 0) + ' active</div>' +
                '<div style="font-size: 11px;" class="text-muted">' + (b.completedOrders || 0) + ' done</div>' +
              '</div>' +
            '</div>'
          );
        });
      }
    },

    promptAssignDriver: async function (orderId) {
      var boysRes = await AdminApp.api('/api/admin/deliveries/boys');
      if (!boysRes.ok || !boysRes.data.success || !boysRes.data.deliveryBoys.length) {
        AdminApp.showToast('No delivery drivers available. Please create a delivery partner account first.', 'error');
        return;
      }

      var boyNames = boysRes.data.deliveryBoys.map(function (b, idx) {
        return (idx + 1) + '. ' + b.name + ' (' + b.availability + ', ' + b.activeOrders + ' active)';
      }).join('\n');

      var choice = prompt('Select driver number to assign to Order #' + orderId + ':\n\n' + boyNames);
      var idx = parseInt(choice, 10) - 1;

      if (!isNaN(idx) && idx >= 0 && idx < boysRes.data.deliveryBoys.length) {
        var selectedBoy = boysRes.data.deliveryBoys[idx];
        var res = await AdminApp.api('/api/admin/orders/' + encodeURIComponent(orderId) + '/assign-delivery', 'POST', {
          deliveryBoyId: selectedBoy.id
        });

        if (res.ok && res.data.success) {
          AdminApp.showToast('Order #' + orderId + ' assigned to ' + selectedBoy.name, 'success');
          AdminApp.loadDeliveries();
        } else {
          AdminApp.showToast(res.data.message || 'Failed to assign driver.', 'error');
        }
      }
    },

    // 10. Delivery Boy Personal Console
    loadMyDeliveries: async function () {
      var res = await AdminApp.api('/api/admin/delivery/my-orders');
      var $grid = $('#myDeliveriesGrid');
      $grid.empty();

      if (!res.ok || !res.data.success || !res.data.deliveries.length) {
        $grid.html('<div class="col-12 text-center py-5 text-muted"><i class="fa-solid fa-box-open fs-1 text-muted mb-3 d-block"></i>You have no active delivery orders assigned right now.</div>');
        return;
      }

      res.data.deliveries.forEach(function (o) {
        var stage = (o.stage || '').toUpperCase();
        var isDelivered = stage === 'DELIVERED';
        var isFailed = stage.includes('FAIL');

        $grid.append(
          '<div class="col-xl-6">' +
            '<div class="card border-0 shadow-sm p-4 h-100">' +
              '<div class="d-flex justify-content-between align-items-center mb-3">' +
                '<h5 class="fw-bold mb-0 text-danger">#' + esc(o.id) + '</h5>' +
                AdminApp.getStatusBadge(o.stage) +
              '</div>' +
              '<div class="bg-light p-3 rounded mb-3" style="font-size: 13.5px;">' +
                '<div><b>Customer:</b> ' + esc(o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Customer')) + '</div>' +
                '<div><b>Contact:</b> <a href="tel:' + esc(o.customer?.phone || '') + '" class="fw-bold text-decoration-none text-dark">' + esc(o.customer?.phone || 'N/A') + ' <i class="fa-solid fa-phone text-success ms-1"></i></a></div>' +
                '<div class="mt-1"><b>Drop Address:</b> ' + esc(o.customer?.address || 'Customer Delivery Address') + '</div>' +
                '<div class="mt-1"><b>Total Bill:</b> ₹' + (Number(o.total) || 0) + ' (' + (o.payment?.status || 'Pending') + ')</div>' +
              '</div>' +
              (!isDelivered && !isFailed ?
                '<div class="d-flex gap-2 flex-wrap">' +
                  '<button type="button" class="btn btn-outline-primary btn-sm flex-fill" onclick="AdminApp.submitMyDriverStatus(\'' + esc(o.id) + '\', \'PICKED UP\')">1. Picked Up</button>' +
                  '<button type="button" class="btn btn-outline-warning btn-sm flex-fill text-dark" onclick="AdminApp.submitMyDriverStatus(\'' + esc(o.id) + '\', \'OUT FOR DELIVERY\')">2. Out for Delivery</button>' +
                  '<button type="button" class="btn btn-success btn-sm flex-fill" onclick="AdminApp.submitMyDriverStatus(\'' + esc(o.id) + '\', \'DELIVERED\')">3. Delivered</button>' +
                  '<button type="button" class="btn btn-danger btn-sm" onclick="AdminApp.submitMyDriverStatus(\'' + esc(o.id) + '\', \'FAILED\')">Report Failed</button>' +
                '</div>' :
                '<div class="alert alert-success mb-0 py-2 text-center" style="font-size: 12.5px;"><i class="fa-solid fa-circle-check me-1"></i> Delivery Finished</div>'
              ) +
            '</div>' +
          '</div>'
        );
      });
    },

    submitMyDriverStatus: async function (orderId, targetStatus) {
      var reason = '';
      if (targetStatus === 'FAILED') {
        reason = prompt('Please enter the failure reason (e.g. Customer unavailable, Address incorrect):');
        if (!reason) {
          AdminApp.showToast('Failure report aborted: Reason is mandatory.', 'error');
          return;
        }
      }

      var res = await AdminApp.api('/api/admin/delivery/orders/' + encodeURIComponent(orderId) + '/status', 'PUT', {
        status: targetStatus,
        reason: reason
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Delivery status updated to ' + targetStatus, 'success');
        AdminApp.loadMyDeliveries();
      } else {
        AdminApp.showToast(res.data.message || 'Error updating status.', 'error');
      }
    },

    // 11. Products Management
    loadProducts: async function () {
      var catFilter = $('#prodCategoryFilter').val();
      var search = $('#prodSearchInput').val();

      var qs = '?limit=100';
      if (catFilter && catFilter !== 'all') qs += '&categoryId=' + encodeURIComponent(catFilter);
      if (search) qs += '&search=' + encodeURIComponent(search);

      var res = await AdminApp.api('/api/admin/products' + qs);
      var $body = $('#productsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.products.length) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No products found.</td></tr>');
        return;
      }

      currentProductsCache = res.data.products;

      res.data.products.forEach(function (p) {
        var vegBadge = p.isVeg ? '<span class="badge bg-success" style="font-size:10px;">VEG</span>' : '<span class="badge bg-danger" style="font-size:10px;">NON-VEG</span>';
        var availBadge = p.isAvailable ? '<span class="badge bg-success">In Stock</span>' : '<span class="badge bg-secondary">Disabled</span>';
        var featBadge = p.isFeatured ? '<i class="fa-solid fa-star text-warning" title="Featured Product"></i>' : '<span class="text-muted">-</span>';

        $body.append(
          '<tr>' +
            '<td>' +
              '<div class="d-flex align-items-center gap-2">' +
                '<img src="' + esc(p.image || 'assets/models/menu/bbq-chicken-pizza.png') + '" style="width:38px; height:38px; border-radius:8px; object-fit:contain;">' +
                '<div><b>' + esc(p.name) + '</b></div>' +
              '</div>' +
            '</td>' +
            '<td>' + esc(p.categoryName || p.categoryId) + '</td>' +
            '<td><b>₹' + (Number(p.price) || 0) + '</b></td>' +
            '<td>' + vegBadge + '</td>' +
            '<td>' + (p.stockQuantity !== undefined ? p.stockQuantity : 50) + '</td>' +
            '<td>' + availBadge + '</td>' +
            '<td class="text-center">' + featBadge + '</td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn-action" onclick="AdminApp.openProductModal(\'' + esc(p.id) + '\')"><i class="fa-solid fa-pen"></i></button>' +
                '<button type="button" class="btn-action text-danger" onclick="AdminApp.deleteProduct(\'' + esc(p.id) + '\')"><i class="fa-solid fa-trash"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    openProductModal: async function (productId) {
      // Ensure category options are loaded
      var catRes = await AdminApp.api('/api/admin/categories');
      var $catSelect = $('#prodFormCategory');
      $catSelect.empty();
      if (catRes.ok && catRes.data.categories) {
        catRes.data.categories.forEach(function (c) {
          $catSelect.append('<option value="' + esc(c.id || c.slug) + '">' + esc(c.name) + '</option>');
        });
      }

      if (productId) {
        var prod = currentProductsCache.find(function (p) { return p.id === productId; });
        if (prod) {
          $('#productModalTitle').text('Edit Product: ' + prod.name);
          $('#prodFormId').val(prod.id);
          $('#prodFormName').val(prod.name);
          $('#prodFormCategory').val(prod.categoryId);
          $('#prodFormPrice').val(prod.price);
          $('#prodFormStock').val(prod.stockQuantity !== undefined ? prod.stockQuantity : 50);
          $('#prodFormDesc').val(prod.description || '');
          $('#prodFormImage').val(prod.image || '');
          $('#prodFormVeg').prop('checked', Boolean(prod.isVeg));
          $('#prodFormAvail').prop('checked', Boolean(prod.isAvailable));
        }
      } else {
        $('#productModalTitle').text('Add New Product');
        $('#prodFormId').val('');
        $('#productForm')[0].reset();
        $('#prodFormStock').val(50);
        $('#prodFormAvail').prop('checked', true);
      }

      var modal = new bootstrap.Modal(document.getElementById('productModal'));
      modal.show();
    },

    saveProduct: async function (e) {
      e.preventDefault();
      var id = $('#prodFormId').val();
      var payload = {
        name: $('#prodFormName').val(),
        categoryId: $('#prodFormCategory').val(),
        price: Number($('#prodFormPrice').val()),
        stockQuantity: Number($('#prodFormStock').val()),
        description: $('#prodFormDesc').val(),
        image: $('#prodFormImage').val(),
        isVeg: $('#prodFormVeg').is(':checked'),
        isAvailable: $('#prodFormAvail').is(':checked')
      };

      var url = id ? ('/api/admin/products/' + encodeURIComponent(id)) : '/api/admin/products';
      var method = id ? 'PUT' : 'POST';

      var res = await AdminApp.api(url, method, payload);
      if (res.ok && res.data.success) {
        AdminApp.showToast('Product saved successfully.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
        AdminApp.loadProducts();
      } else {
        AdminApp.showToast(res.data.message || 'Error saving product.', 'error');
      }
    },

    deleteProduct: async function (id) {
      if (!confirm('Are you sure you want to remove this product from CRAV catalog?')) return;
      var res = await AdminApp.api('/api/admin/products/' + encodeURIComponent(id), 'DELETE');
      if (res.ok && res.data.success) {
        AdminApp.showToast('Product removed.', 'success');
        AdminApp.loadProducts();
      } else {
        AdminApp.showToast(res.data.message || 'Error deleting product.', 'error');
      }
    },

    // 12. Categories Management
    loadCategories: async function () {
      var res = await AdminApp.api('/api/admin/categories');
      var $body = $('#categoriesTableBody');
      var $prodFilter = $('#prodCategoryFilter');
      $body.empty();
      $prodFilter.html('<option value="all">All Categories</option>');

      if (!res.ok || !res.data.success || !res.data.categories.length) {
        $body.html('<tr><td colspan="6" class="text-center py-5 text-muted">No categories configured.</td></tr>');
        return;
      }

      currentCategoriesCache = res.data.categories;

      res.data.categories.forEach(function (c) {
        $prodFilter.append('<option value="' + esc(c.id || c.slug) + '">' + esc(c.name) + '</option>');
        $body.append(
          '<tr>' +
            '<td><span class="badge bg-light text-dark border">' + (c.displayOrder || 1) + '</span></td>' +
            '<td><b>' + esc(c.name) + '</b></td>' +
            '<td><code>' + esc(c.id || c.slug) + '</code></td>' +
            '<td><span class="badge bg-danger">' + (c.productCount || 0) + ' items</span></td>' +
            '<td><span class="badge bg-success">' + esc(c.status || 'active') + '</span></td>' +
            '<td>' +
              '<button type="button" class="btn-action text-danger" onclick="AdminApp.deleteCategory(\'' + esc(c.id || c.slug) + '\')"><i class="fa-solid fa-trash"></i></button>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    openCategoryModal: function () {
      var name = prompt('Enter new Category Name (e.g. Pasta, Wraps, Desserts):');
      if (!name || !name.trim()) return;
      AdminApp.api('/api/admin/categories', 'POST', { name: name.trim() }).then(function (res) {
        if (res.ok && res.data.success) {
          AdminApp.showToast('Category created: ' + name, 'success');
          AdminApp.loadCategories();
        } else {
          AdminApp.showToast(res.data.message || 'Error creating category.', 'error');
        }
      });
    },

    deleteCategory: async function (id) {
      if (!confirm('Are you sure you want to remove this category?')) return;
      var res = await AdminApp.api('/api/admin/categories/' + encodeURIComponent(id), 'DELETE');
      if (res.ok && res.data.success) {
        AdminApp.showToast(res.data.message || 'Category deleted.', 'success');
        AdminApp.loadCategories();
      } else {
        AdminApp.showToast(res.data.message || 'Error deleting category.', 'error');
      }
    },

    // 13. Inventory Management
    loadInventory: async function () {
      var res = await AdminApp.api('/api/admin/inventory');
      var $body = $('#inventoryTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.inventory.length) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No inventory records found.</td></tr>');
        return;
      }

      res.data.inventory.forEach(function (it) {
        var isLow = Number(it.quantity) <= Number(it.minThreshold);
        var statusBadge = isLow
          ? '<span class="badge bg-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i> Low Stock</span>'
          : '<span class="badge bg-success">Optimal</span>';

        $body.append(
          '<tr>' +
            '<td><b>' + esc(it.name) + '</b></td>' +
            '<td>' + esc(it.category || 'General') + '</td>' +
            '<td><b class="' + (isLow ? 'text-danger' : '') + '">' + it.quantity + ' ' + esc(it.unit) + '</b></td>' +
            '<td>' + it.minThreshold + ' ' + esc(it.unit) + '</td>' +
            '<td><small>' + esc(it.supplier || 'N/A') + '</small></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn btn-outline-success btn-sm" onclick="AdminApp.promptAdjustStock(\'' + esc(it.id) + '\', 10)">+10</button>' +
                '<button type="button" class="btn btn-outline-danger btn-sm" onclick="AdminApp.promptAdjustStock(\'' + esc(it.id) + '\', -5)">-5</button>' +
              '</div>' +
            '</td>' +
            '<td>' +
              '<button type="button" class="btn-action text-danger" onclick="AdminApp.deleteInventoryItem(\'' + esc(it.id) + '\')"><i class="fa-solid fa-trash"></i></button>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    openInventoryModal: function () {
      var name = prompt('Item Name:');
      if (!name) return;
      var qty = prompt('Initial Quantity (numerical):', '50');
      var unit = prompt('Unit of Measurement (pcs, kg, litres):', 'kg');
      var supplier = prompt('Supplier / Vendor Name:', 'Metro Supplies');

      AdminApp.api('/api/admin/inventory', 'POST', {
        name: name,
        quantity: Number(qty) || 10,
        unit: unit || 'units',
        supplier: supplier
      }).then(function (res) {
        if (res.ok && res.data.success) {
          AdminApp.showToast('Inventory item created: ' + name, 'success');
          AdminApp.loadInventory();
        } else {
          AdminApp.showToast(res.data.message || 'Error adding inventory.', 'error');
        }
      });
    },

    promptAdjustStock: async function (id, defaultAmount) {
      var amt = prompt('Enter adjustment amount (+ to add intake, - to deduct usage):', defaultAmount);
      if (amt === null || amt === '') return;
      var reason = prompt('Reason for adjustment (Purchase, Kitchen prep, Wastage):', 'Operational Stock Adjustment');

      var res = await AdminApp.api('/api/admin/inventory/' + encodeURIComponent(id) + '/adjust', 'POST', {
        adjustment: Number(amt),
        reason: reason
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast(res.data.message || 'Stock updated.', 'success');
        AdminApp.loadInventory();
      } else {
        AdminApp.showToast(res.data.message || 'Error updating stock.', 'error');
      }
    },

    deleteInventoryItem: async function (id) {
      if (!confirm('Delete this inventory record?')) return;
      var res = await AdminApp.api('/api/admin/inventory/' + encodeURIComponent(id), 'DELETE');
      if (res.ok) {
        AdminApp.showToast('Item deleted.', 'success');
        AdminApp.loadInventory();
      }
    },

    // 14. Customers
    loadCustomers: async function () {
      var search = $('#customerSearchInput').val();
      var qs = search ? ('?search=' + encodeURIComponent(search)) : '';
      var res = await AdminApp.api('/api/admin/customers' + qs);
      var $body = $('#customersTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.customers.length) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No customers found.</td></tr>');
        return;
      }

      res.data.customers.forEach(function (c) {
        var statusBadge = (c.status === 'suspended')
          ? '<span class="badge bg-danger">Suspended</span>'
          : '<span class="badge bg-success">Active</span>';

        $body.append(
          '<tr>' +
            '<td>' +
              '<div class="fw-bold">' + esc(c.name) + '</div>' +
              '<small class="text-muted">' + esc(c.email) + '</small>' +
            '</td>' +
            '<td>' + esc(c.phone) + '</td>' +
            '<td><b>' + (c.ordersCount || 0) + '</b></td>' +
            '<td><b class="text-danger">₹' + (c.totalSpent || 0) + '</b></td>' +
            '<td>' + (c.isVerified ? '<i class="fa-solid fa-check text-success"></i>' : '<span class="text-muted">Unverified</span>') + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><small class="text-muted">' + AdminApp.formatDate(c.createdAt) + '</small></td>' +
            '<td>' +
              '<button type="button" class="btn-action ' + (c.status === 'suspended' ? 'text-success' : 'text-danger') + '" onclick="AdminApp.toggleCustomerStatus(\'' + esc(c.id) + '\', \'' + (c.status === 'suspended' ? 'active' : 'suspended') + '\')">' +
                (c.status === 'suspended' ? 'Activate' : 'Suspend') +
              '</button>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    toggleCustomerStatus: async function (id, newStatus) {
      var reason = '';
      if (newStatus === 'suspended') {
        reason = prompt('Reason for suspension (Terms violation, fraud suspicion):');
        if (!reason) return;
      }

      var res = await AdminApp.api('/api/admin/customers/' + encodeURIComponent(id) + '/status', 'PUT', {
        status: newStatus,
        reason: reason
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Customer account marked as ' + newStatus, 'success');
        AdminApp.loadCustomers();
      } else {
        AdminApp.showToast(res.data.message || 'Error updating customer.', 'error');
      }
    },

    // 15. Staff Management
    loadStaff: async function () {
      AdminApp.loadStaffRequests();
      var res = await AdminApp.api('/api/admin/staff');
      var $body = $('#staffTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.staff.length) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No staff accounts found.</td></tr>');
        return;
      }

      res.data.staff.forEach(function (s) {
        var roleBadge = '<span class="badge bg-dark">' + esc(s.role) + '</span>';
        var statusBadge = (s.status === 'active')
          ? '<span class="badge bg-success">Active</span>'
          : '<span class="badge bg-secondary">Inactive</span>';

        $body.append(
          '<tr>' +
            '<td><b>' + esc(s.firstName + ' ' + s.lastName) + '</b></td>' +
            '<td>' + esc(s.email) + '</td>' +
            '<td>' + esc(s.phone || 'N/A') + '</td>' +
            '<td>' + roleBadge + '</td>' +
            '<td><small class="text-muted">' + (Array.isArray(s.permissions) ? s.permissions.join(', ') : '*') + '</small></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><small class="text-muted">' + (s.lastLogin ? AdminApp.formatTimeAgo(s.lastLogin) : 'Never') + '</small></td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn-action" onclick="AdminApp.promptResetStaffPass(\'' + esc(s.id) + '\', \'' + esc(s.email) + '\')" title="Reset Password"><i class="fa-solid fa-key"></i></button>' +
                '<button type="button" class="btn-action text-danger" onclick="AdminApp.deleteStaff(\'' + esc(s.id) + '\', \'' + esc(s.email) + '\')" title="Delete Staff Account"><i class="fa-solid fa-trash"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    loadStaffRequests: async function () {
      var res = await AdminApp.api('/api/admin/staff/requests');
      var $container = $('#staffRequestsCard');
      var $badge = $('#staffPendingBadge');
      var $countBadge = $('#staffRequestsCountBadge');
      var $tableBody = $('#staffRequestsTableBody');

      if (!res.ok || !res.data || !res.data.requests) return;

      var reqs = res.data.requests;
      if (reqs.length > 0) {
        $badge.text(reqs.length).show();
        $countBadge.text(reqs.length + ' Pending Approval');
        $container.show();
        $tableBody.empty();
        reqs.forEach(function (r) {
          $tableBody.append(
            '<tr>' +
              '<td><b>' + esc(r.name) + '</b></td>' +
              '<td>' + esc(r.email) + '</td>' +
              '<td>' + esc(r.phone || 'N/A') + '</td>' +
              '<td><span class="badge bg-warning text-dark font-monospace px-2 py-1"><i class="fa-solid fa-id-badge me-1"></i>' + esc(r.requestedRole.replace(/_/g, ' ')) + '</span></td>' +
              '<td><small class="text-muted">' + AdminApp.formatTimeAgo(r.requestedAt) + '</small></td>' +
              '<td>' +
                '<div class="d-flex gap-2">' +
                  '<button type="button" class="btn btn-sm btn-success py-1 px-3" onclick="AdminApp.approveStaffRequest(\'' + esc(r.id) + '\', \'' + esc(r.requestedRole) + '\', \'' + esc(r.name) + '\')">' +
                    '<i class="fa-solid fa-check me-1"></i> Approve & Unlock' +
                  '</button>' +
                  '<button type="button" class="btn btn-sm btn-outline-danger py-1 px-2" onclick="AdminApp.rejectStaffRequest(\'' + esc(r.id) + '\', \'' + esc(r.name) + '\')">' +
                    '<i class="fa-solid fa-xmark me-1"></i> Reject' +
                  '</button>' +
                '</div>' +
              '</td>' +
            '</tr>'
          );
        });
      } else {
        $badge.hide();
        $container.hide();
        $tableBody.empty();
      }
    },

    approveStaffRequest: async function (id, role, name) {
      if (!confirm('Approve staff application for ' + name + ' as ' + role.replace(/_/g, ' ') + '?\nThis will immediately activate their account and unlock their station.')) return;
      var res = await AdminApp.api('/api/admin/staff/requests/' + encodeURIComponent(id) + '/approve', 'POST', { assignedRole: role });
      if (res.ok && res.data.success) {
        AdminApp.showToast('✅ Approved! ' + name + ' can now sign in and access the ' + role.replace(/_/g, ' ') + ' station.', 'success');
        AdminApp.loadStaff();
      } else {
        AdminApp.showToast(res.data.message || 'Error approving request.', 'error');
      }
    },

    rejectStaffRequest: async function (id, name) {
      var reason = prompt('Reason for rejecting ' + name + ' access request (optional):', 'Opening filled');
      if (reason === null) return;
      var res = await AdminApp.api('/api/admin/staff/requests/' + encodeURIComponent(id) + '/reject', 'POST', { reason: reason });
      if (res.ok && res.data.success) {
        AdminApp.showToast('Request rejected for ' + name, 'info');
        AdminApp.loadStaff();
      } else {
        AdminApp.showToast(res.data.message || 'Error rejecting request.', 'error');
      }
    },

    openStaffModal: function () {
      $('#staffModalTitle').text('Create Staff Account');
      $('#staffFormId').val('');
      $('#staffForm')[0].reset();
      $('#staffPassGroup').show();
      $('#staffStatusGroup').hide();

      var modal = new bootstrap.Modal(document.getElementById('staffModal'));
      modal.show();
    },

    saveStaff: async function (e) {
      e.preventDefault();
      var id = $('#staffFormId').val();
      var payload = {
        firstName: $('#staffFormFname').val(),
        lastName: $('#staffFormLname').val(),
        email: $('#staffFormEmail').val(),
        phone: $('#staffFormPhone').val(),
        role: $('#staffFormRole').val()
      };

      if (!id) {
        payload.password = $('#staffFormPassword').val();
      }

      var url = id ? ('/api/admin/staff/' + encodeURIComponent(id)) : '/api/admin/staff';
      var method = id ? 'PUT' : 'POST';

      var res = await AdminApp.api(url, method, payload);
      if (res.ok && res.data.success) {
        AdminApp.showToast(res.data.message || 'Staff account saved.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('staffModal')).hide();
        AdminApp.loadStaff();
      } else {
        AdminApp.showToast(res.data.message || 'Error saving staff account.', 'error');
      }
    },

    promptResetStaffPass: async function (id, email) {
      var pass = prompt('Enter new password for ' + email + ' (min 6 characters):');
      if (!pass) return;

      var res = await AdminApp.api('/api/admin/staff/' + encodeURIComponent(id) + '/reset-password', 'POST', {
        newPassword: pass
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Password reset successfully for ' + email, 'success');
      } else {
        AdminApp.showToast(res.data.message || 'Error resetting password.', 'error');
      }
    },

    deleteStaff: async function (id, email) {
      if (!confirm('Permanently remove staff account for ' + email + '?')) return;
      var res = await AdminApp.api('/api/admin/staff/' + encodeURIComponent(id), 'DELETE');
      if (res.ok && res.data.success) {
        AdminApp.showToast(res.data.message || 'Staff deleted.', 'success');
        AdminApp.loadStaff();
      } else {
        AdminApp.showToast(res.data.message || 'Action blocked.', 'error');
      }
    },

    // 16. Table Reservations
    loadReservations: async function () {
      var status = $('#reservationStatusFilter').val();
      var qs = (status && status !== 'all') ? ('?status=' + encodeURIComponent(status)) : '';
      var res = await AdminApp.api('/api/admin/reservations' + qs);
      var $body = $('#reservationsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.reservations.length) {
        $body.html('<tr><td colspan="7" class="text-center py-5 text-muted">No reservations found.</td></tr>');
        return;
      }

      res.data.reservations.forEach(function (r) {
        var s = (r.status || 'pending').toLowerCase();
        var statusBadge = (s === 'confirmed')
          ? '<span class="badge bg-success">Confirmed</span>'
          : (s === 'completed' ? '<span class="badge bg-primary">Completed</span>' : (s === 'rejected' ? '<span class="badge bg-danger">Rejected</span>' : '<span class="badge bg-warning text-dark">Pending</span>'));

        $body.append(
          '<tr>' +
            '<td><b class="text-danger">#' + esc(r.bookingId || r.id) + '</b></td>' +
            '<td><b>' + esc(r.guestName || r.name || 'Guest') + '</b><br><small class="text-muted">' + esc(r.email) + '</small></td>' +
            '<td><span class="badge bg-light text-dark border">' + (r.guests || 2) + ' Guests</span></td>' +
            '<td><b>' + esc(r.date) + '</b> @ ' + esc(r.time) + '</td>' +
            '<td>' + esc(r.phone || 'N/A') + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn btn-outline-success btn-sm" onclick="AdminApp.updateReservation(\'' + esc(r.id || r.bookingId) + '\', \'confirmed\')" title="Confirm"><i class="fa-solid fa-check"></i></button>' +
                '<button type="button" class="btn btn-outline-danger btn-sm" onclick="AdminApp.updateReservation(\'' + esc(r.id || r.bookingId) + '\', \'rejected\')" title="Reject"><i class="fa-solid fa-xmark"></i></button>' +
                '<button type="button" class="btn btn-outline-primary btn-sm" onclick="AdminApp.updateReservation(\'' + esc(r.id || r.bookingId) + '\', \'completed\')" title="Complete"><i class="fa-solid fa-flag-checkered"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    updateReservation: async function (id, targetStatus) {
      var reason = '';
      if (targetStatus === 'rejected') {
        reason = prompt('Reason for rejecting reservation:');
        if (!reason) return;
      }

      var res = await AdminApp.api('/api/admin/reservations/' + encodeURIComponent(id) + '/status', 'PUT', {
        status: targetStatus,
        reason: reason
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Reservation marked as ' + targetStatus, 'success');
        AdminApp.loadReservations();
      } else {
        AdminApp.showToast(res.data.message || 'Error updating reservation.', 'error');
      }
    },

    // 17. Payments & Billing
    loadPayments: async function () {
      var res = await AdminApp.api('/api/admin/payments');
      var $body = $('#paymentsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No payments recorded.</td></tr>');
        return;
      }

      var m = res.data.metrics || {};
      $('#payTotalCollected').text('₹' + (m.totalCollected || 0).toLocaleString());
      $('#payDemoSimulated').text('₹' + (m.demoSimulatedTotal || 0).toLocaleString());
      $('#payPending').text('₹' + (m.pendingTotal || 0).toLocaleString());

      res.data.payments.forEach(function (p) {
        var isDemoBadge = p.isDemo
          ? '<span class="badge bg-warning text-dark"><i class="fa-solid fa-vial me-1"></i> Demo Simulated</span>'
          : '<span class="badge bg-success"><i class="fa-solid fa-shield-check me-1"></i> Verified Cash</span>';

        var statusBadge = (p.status.toLowerCase() === 'paid')
          ? '<span class="badge bg-success">Paid</span>'
          : '<span class="badge bg-warning text-dark">Pending</span>';

        $body.append(
          '<tr>' +
            '<td><b class="text-danger">#' + esc(p.orderId) + '</b></td>' +
            '<td><b>' + esc(p.customerName) + '</b></td>' +
            '<td><b>₹' + p.total + '</b></td>' +
            '<td>' + esc(p.method) + '</td>' +
            '<td>' + isDemoBadge + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><small class="text-muted">' + (p.paidAt ? AdminApp.formatDate(p.paidAt) : 'Pending') + '</small></td>' +
            '<td>' +
              (p.status.toLowerCase() !== 'paid' ?
                '<button type="button" class="btn btn-outline-success btn-sm" onclick="AdminApp.openCashModal(\'' + esc(p.orderId) + '\', ' + p.total + ')"><i class="fa-solid fa-hand-holding-dollar me-1"></i> Cash</button>' :
                '<span class="text-muted small">Completed</span>'
              ) +
            '</td>' +
          '</tr>'
        );
      });
    },

    openCashModal: function (orderId, total) {
      $('#cashOrderId').val(orderId);
      $('#cashOrderDisplayId').val('#' + orderId);
      $('#cashAmount').val(total);
      var modal = new bootstrap.Modal(document.getElementById('cashPaymentModal'));
      modal.show();
    },

    submitCashPayment: async function (e) {
      e.preventDefault();
      var orderId = $('#cashOrderId').val();
      var amount = $('#cashAmount').val();
      var notes = $('#cashNotes').val();

      var res = await AdminApp.api('/api/admin/payments/' + encodeURIComponent(orderId) + '/cash', 'POST', {
        amountReceived: amount,
        notes: notes
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Cash payment recorded successfully.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('cashPaymentModal')).hide();
        AdminApp.loadPayments();
      } else {
        AdminApp.showToast(res.data.message || 'Error recording cash payment.', 'error');
      }
    },

    // 18. Sales Reports
    loadSalesReport: async function () {
      var period = $('#reportPeriodSelect').val() || 'monthly';
      var res = await AdminApp.api('/api/admin/reports/sales?period=' + encodeURIComponent(period));
      var $body = $('#reportsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.report.length) {
        $body.html('<tr><td colspan="6" class="text-center py-5 text-muted">No sales data for this period.</td></tr>');
        return;
      }

      res.data.report.forEach(function (r) {
        $body.append(
          '<tr>' +
            '<td><b>' + esc(r.period) + '</b></td>' +
            '<td>' + r.ordersCount + '</td>' +
            '<td><span class="text-success fw-bold">' + r.deliveredCount + '</span></td>' +
            '<td><span class="text-danger fw-bold">' + r.cancelledCount + '</span></td>' +
            '<td>₹' + Math.round(r.totalSales).toLocaleString() + '</td>' +
            '<td><b class="text-danger">₹' + Math.round(r.collectedRevenue).toLocaleString() + '</b></td>' +
          '</tr>'
        );
      });
    },

    exportReportCSV: function () {
      var table = document.getElementById('reportTable');
      if (!table) return;

      var csv = [];
      var rows = table.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');
        for (var j = 0; j < cols.length; j++) {
          row.push('"' + cols[j].innerText.replace(/"/g, '""').trim() + '"');
        }
        csv.push(row.join(','));
      }

      var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', 'CRAV_Sales_Report_' + new Date().toISOString().split('T')[0] + '.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      AdminApp.showToast('CSV report downloaded.', 'success');
    },

    // 19. Coupons
    loadCoupons: async function () {
      var res = await AdminApp.api('/api/admin/coupons');
      var $body = $('#couponsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.coupons.length) {
        $body.html('<tr><td colspan="8" class="text-center py-5 text-muted">No coupons created.</td></tr>');
        return;
      }

      res.data.coupons.forEach(function (c) {
        var typeBadge = (c.type === 'percentage')
          ? '<span class="badge bg-primary">' + c.discountValue + '% OFF</span>'
          : '<span class="badge bg-success">₹' + c.discountValue + ' FLAT</span>';

        $body.append(
          '<tr>' +
            '<td><b class="text-danger">' + esc(c.code) + '</b></td>' +
            '<td>' + typeBadge + '</td>' +
            '<td>' + (c.type === 'percentage' ? c.discountValue + '% (Max ₹' + (c.maxDiscount || 'N/A') + ')' : '₹' + c.discountValue) + '</td>' +
            '<td>₹' + (c.minOrderAmount || 0) + '</td>' +
            '<td>' + (c.usedCount || 0) + ' / ' + (c.usageLimit || 100) + '</td>' +
            '<td><small>' + esc(c.validUntil || '2027-12-31') + '</small></td>' +
            '<td><span class="badge bg-success">' + esc(c.status) + '</span></td>' +
            '<td>' +
              '<button type="button" class="btn-action text-danger" onclick="AdminApp.deleteCoupon(\'' + esc(c.id) + '\')"><i class="fa-solid fa-trash"></i></button>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    openCouponModal: function () {
      $('#couponForm')[0].reset();
      var modal = new bootstrap.Modal(document.getElementById('couponModal'));
      modal.show();
    },

    saveCoupon: async function (e) {
      e.preventDefault();
      var payload = {
        code: $('#couponFormCode').val(),
        type: $('#couponFormType').val(),
        discountValue: Number($('#couponFormVal').val()),
        minOrderAmount: Number($('#couponFormMin').val()),
        maxDiscount: $('#couponFormMax').val() ? Number($('#couponFormMax').val()) : null,
        validUntil: $('#couponFormExpiry').val(),
        description: $('#couponFormDesc').val()
      };

      var res = await AdminApp.api('/api/admin/coupons', 'POST', payload);
      if (res.ok && res.data.success) {
        AdminApp.showToast('Coupon created: ' + payload.code, 'success');
        bootstrap.Modal.getInstance(document.getElementById('couponModal')).hide();
        AdminApp.loadCoupons();
      } else {
        AdminApp.showToast(res.data.message || 'Error creating coupon.', 'error');
      }
    },

    deleteCoupon: async function (id) {
      if (!confirm('Delete this coupon code?')) return;
      var res = await AdminApp.api('/api/admin/coupons/' + encodeURIComponent(id), 'DELETE');
      if (res.ok) {
        AdminApp.showToast('Coupon removed.', 'success');
        AdminApp.loadCoupons();
      }
    },

    // 20. Reviews Moderation
    loadReviews: async function () {
      var res = await AdminApp.api('/api/admin/reviews');
      var $body = $('#reviewsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.reviews.length) {
        $body.html('<tr><td colspan="7" class="text-center py-5 text-muted">No reviews submitted yet.</td></tr>');
        return;
      }

      res.data.reviews.forEach(function (r) {
        var stars = '';
        for (var i = 0; i < (r.rating || 5); i++) stars += '<i class="fa-solid fa-star text-warning"></i>';

        $body.append(
          '<tr>' +
            '<td><b>' + esc(r.name) + '</b></td>' +
            '<td>' + stars + '</td>' +
            '<td><small>' + esc(r.comment) + '</small></td>' +
            '<td><span class="badge bg-secondary">' + esc(r.status || 'pending') + '</span></td>' +
            '<td><small>' + (r.adminReply?.text ? esc(r.adminReply.text) : '<span class="text-muted">None</span>') + '</small></td>' +
            '<td><small class="text-muted">' + AdminApp.formatDate(r.createdAt) + '</small></td>' +
            '<td>' +
              '<div class="btn-group btn-group-sm">' +
                '<button type="button" class="btn btn-outline-success btn-sm" onclick="AdminApp.moderateReview(\'' + esc(r.id) + '\', \'approved\')"><i class="fa-solid fa-check"></i></button>' +
                '<button type="button" class="btn btn-outline-danger btn-sm" onclick="AdminApp.moderateReview(\'' + esc(r.id) + '\', \'hidden\')"><i class="fa-solid fa-eye-slash"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      });
    },

    moderateReview: async function (id, status) {
      var reply = prompt('Reply to customer (optional):', '');
      var res = await AdminApp.api('/api/admin/reviews/' + encodeURIComponent(id) + '/moderate', 'PUT', {
        status: status,
        reply: reply || undefined
      });

      if (res.ok && res.data.success) {
        AdminApp.showToast('Review marked as ' + status, 'success');
        AdminApp.loadReviews();
      } else {
        AdminApp.showToast('Error moderating review.', 'error');
      }
    },

    // 21. Audit Logs
    loadAuditLogs: async function () {
      var search = $('#auditSearchInput').val();
      var qs = search ? ('?search=' + encodeURIComponent(search)) : '';
      var res = await AdminApp.api('/api/admin/audit-logs' + qs);
      var $body = $('#auditLogsTableBody');
      $body.empty();

      if (!res.ok || !res.data.success || !res.data.logs.length) {
        $body.html('<tr><td colspan="6" class="text-center py-5 text-muted">No audit logs recorded yet.</td></tr>');
        return;
      }

      res.data.logs.forEach(function (l) {
        $body.append(
          '<tr>' +
            '<td><small class="text-muted">' + AdminApp.formatDate(l.timestamp) + '</small></td>' +
            '<td><b>' + esc(l.actor?.name || l.actor?.email) + '</b> <span class="badge bg-dark" style="font-size:10px;">' + esc(l.actor?.role) + '</span></td>' +
            '<td><b class="text-danger">' + esc(l.action) + '</b></td>' +
            '<td><code>' + esc(l.recordId || '-') + '</code></td>' +
            '<td><small>' + esc(l.details || '-') + '</small></td>' +
            '<td><small class="text-muted">' + esc(l.ip) + '</small></td>' +
          '</tr>'
        );
      });
    },

    // 22. Settings
    loadSettings: async function () {
      var res = await AdminApp.api('/api/admin/settings');
      if (!res.ok || !res.data.success || !res.data.settings) return;

      var s = res.data.settings;
      $('#settingOpeningHours').val(s.openingHours || 'Every Day 11:00 AM to 11:00 PM');
      $('#settingPhone').val(s.phone || '+91 90000 00000');
      $('#settingEmail').val(s.email || 'hello@crav.example');
      $('#settingDeliveryFee').val(s.deliveryFee !== undefined ? s.deliveryFee : 40);
      $('#settingTaxPercent').val(s.taxPercent !== undefined ? s.taxPercent : 5);
      $('#settingMinOrder').val(s.minOrderAmount !== undefined ? s.minOrderAmount : 99);
      $('#settingAddress').val(s.address || 'Online Demonstration Platform (College Software Project)');
      $('#settingAnnouncement').val(s.announcement || 'Welcome to CRAV!');
    },

    saveSettings: async function (e) {
      e.preventDefault();
      var payload = {
        openingHours: $('#settingOpeningHours').val(),
        phone: $('#settingPhone').val(),
        email: $('#settingEmail').val(),
        deliveryFee: Number($('#settingDeliveryFee').val()),
        taxPercent: Number($('#settingTaxPercent').val()),
        minOrderAmount: Number($('#settingMinOrder').val()),
        address: $('#settingAddress').val(),
        announcement: $('#settingAnnouncement').val()
      };

      var res = await AdminApp.api('/api/admin/settings', 'PUT', payload);
      if (res.ok && res.data.success) {
        AdminApp.showToast('CRAV platform settings updated.', 'success');
      } else {
        AdminApp.showToast(res.data.message || 'Error updating settings.', 'error');
      }
    },

    // 23. Thermal Receipt Printing
    quickPrintReceipt: async function (orderId) {
      var res = await AdminApp.api('/api/admin/orders/' + encodeURIComponent(orderId));
      if (!res.ok || !res.data.success) return;
      currentOrderForReceipt = res.data.order;
      AdminApp.printOrderReceipt();
    },

    printOrderReceipt: function () {
      if (!currentOrderForReceipt) return;
      var o = currentOrderForReceipt;

      var itemsHtml = '';
      if (Array.isArray(o.items)) {
        itemsHtml = o.items.map(function (it) {
          var p = Number(it.price) || 0;
          var q = Number(it.quantity) || 1;
          return '<div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">' +
            '<span>' + q + 'x ' + esc(it.name || it.title) + '</span>' +
            '<span>₹' + (p * q) + '</span>' +
          '</div>';
        }).join('');
      }

      var receiptHtml = '' +
        '<div style="max-width:320px; margin:0 auto; font-family:monospace; color:#000; padding:10px; border:1px solid #ddd;">' +
          '<div style="text-align:center; margin-bottom:12px;">' +
            '<h3 style="margin:0; font-size:22px; font-weight:900;">CRAV</h3>' +
            '<p style="margin:2px 0; font-size:11px;">From Craving to Doorstep.</p>' +
            '<p style="margin:2px 0; font-size:10px;">Phone: +91 90000 00000 &bull; hello@crav.example</p>' +
            '<div style="border-top:1px dashed #000; margin:8px 0;"></div>' +
            '<div style="font-size:12px; font-weight:bold;">ORDER RECEIPT #' + esc(o.id) + '</div>' +
            '<div style="font-size:10px;">' + AdminApp.formatDate(o.createdAt) + '</div>' +
          '</div>' +
          '<div style="margin-bottom:10px;">' +
            '<div style="font-size:11px;"><b>Customer:</b> ' + esc(o.customer?.name || (o.customer?.firstName ? o.customer.firstName + ' ' + (o.customer.lastName || '') : 'Guest')) + '</div>' +
            '<div style="font-size:11px;"><b>Phone:</b> ' + esc(o.customer?.phone || 'N/A') + '</div>' +
            '<div style="font-size:11px;"><b>Address:</b> ' + esc(o.customer?.address || 'Doorstep Delivery') + '</div>' +
          '</div>' +
          '<div style="border-top:1px dashed #000; border-bottom:1px dashed #000; padding:8px 0; margin-bottom:8px;">' + itemsHtml + '</div>' +
          '<div style="font-size:11px; margin-bottom:12px;">' +
            '<div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>₹' + (o.subtotal || o.total) + '</span></div>' +
            '<div style="display:flex; justify-content:space-between;"><span>Delivery Fee:</span><span>₹' + (o.delivery || 0) + '</span></div>' +
            (o.discount ? '<div style="display:flex; justify-content:space-between;"><span>Discount:</span><span>-₹' + o.discount + '</span></div>' : '') +
            '<div style="display:flex; justify-content:space-between; font-size:14px; font-weight:bold; border-top:1px solid #000; padding-top:4px; margin-top:4px;">' +
              '<span>TOTAL DUE:</span><span>₹' + o.total + '</span>' +
            '</div>' +
            '<div style="margin-top:6px; font-size:10px;">Payment: ' + esc(o.payment?.method || 'Demo QR') + ' (' + (o.payment?.status || 'Pending') + ')</div>' +
          '</div>' +
          '<div style="text-align:center; font-size:10px; border-top:1px dashed #000; padding-top:8px;">' +
            'Thank you for ordering with CRAV!<br>Freshly prepared with love.' +
          '</div>' +
        '</div>';

      var $printArea = $('#printableReceiptArea');
      $printArea.html(receiptHtml).show();
      window.print();
      $printArea.hide();
    },

    // 24. Event Bindings
    bindEvents: function () {
      $('.nav-item-btn').on('click', function () {
        var view = $(this).data('view');
        AdminApp.switchView(view);
      });

      $('#toggleSidebarBtn').on('click', function () {
        $('#adminSidebar').toggleClass('show');
      });

      $('#refreshDataBtn').on('click', function () {
        var activeView = $('.view-panel.active').attr('id').replace('view-', '');
        AdminApp.loadViewData(activeView);
        AdminApp.showToast('Data refreshed.', 'success');
      });

      $('#sidebarLogoutBtn').on('click', function () {
        if (confirm('Log out of CRAV Control Center?')) {
          AdminApp.logout();
        }
      });
    },

    startLivePolling: function () {
      if (AdminApp.livePollTimer) clearInterval(AdminApp.livePollTimer);

      AdminApp.livePollTimer = setInterval(async function () {
        try {
          var res = await AdminApp.api('/api/admin/overview');
          if (!res.ok || !res.data || !res.data.success) return;

          var m = res.data.metrics || {};
          var counts = m.counts || {};
          var recent = res.data.recentOrders || [];
          var newestOrder = recent[0] || null;

          var currentSummary = (counts.total || 0) + ':' + (newestOrder ? newestOrder.id : '') + ':' + (newestOrder ? newestOrder.stage : '');

          if (AdminApp.lastKnownOrdersSummary !== null && AdminApp.lastKnownOrdersSummary !== currentSummary) {
            // A new order has been received or order status updated!
            var customerName = newestOrder ? (newestOrder.customer?.name || (newestOrder.customer?.firstName ? newestOrder.customer.firstName + ' ' + (newestOrder.customer.lastName || '') : 'Customer')) : 'Customer';
            var orderAmt = newestOrder ? ('₹' + Number(newestOrder.total || 0)) : '';

            // Play synthetic bell chime
            AdminApp.playOrderNotificationSound();

            // Show real-time alert toast
            AdminApp.showToast('🔔 Live Update: Order #' + (newestOrder ? newestOrder.id : '') + ' (' + orderAmt + ') from ' + customerName, 'success');

            // Refresh current active view
            AdminApp.loadViewData(AdminApp.currentView);
          }

          AdminApp.lastKnownOrdersSummary = currentSummary;

          // Always update nav badges in real time
          $('#navOrdersBadge').text((counts.pending || 0) + (counts.confirmed || 0));
          $('#navKitchenBadge').text(counts.preparing || 0);

          // If currently on overview, update the top KPI cards smoothly
          if (AdminApp.currentView === 'overview') {
            $('#ovTodayRevenue').text('₹' + (m.todayRevenue || 0).toLocaleString());
            $('#ovTodayOrders').text(counts.today || 0);
            $('#ovActiveDeliveries').text(counts.outForDelivery || 0);
            $('#ovPendingReservations').text(m.pendingReservations || 0);
          }

          // Check pending staff applications in background for Super Admin
          if (currentUser && (currentUser.role === 'SUPER_ADMIN' || (currentUser.permissions || []).includes('manage_staff') || (currentUser.permissions || []).includes('*'))) {
            AdminApp.api('/api/admin/staff/requests').then(function(r) {
              if (r.ok && r.data && r.data.requests) {
                var count = r.data.requests.length;
                var $badge = $('#staffPendingBadge');
                if (count > 0) {
                  $badge.text(count).show();
                } else {
                  $badge.hide();
                }
              }
            }).catch(function() {});
          }
        } catch (e) {
          // Heartbeat silent catch
        }
      }, 3000);
    },

    playOrderNotificationSound: function () {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        var ctx = new AudioCtx();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.14); // A5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } catch (e) {}
    },

    logout: function () {
      localStorage.removeItem('crav_admin_token');
      localStorage.removeItem('crav_admin_user');
      window.location.replace('admin-login.html');
    },

    // 25. Helpers
    showToast: function (msg, type) {
      type = type || 'success';
      var icon = type === 'success' ? 'fa-solid fa-circle-check text-success' : 'fa-solid fa-circle-exclamation text-danger';
      var $toast = $(
        '<div class="admin-toast toast-' + type + '">' +
          '<i class="' + icon + ' fs-5"></i>' +
          '<div>' + esc(msg) + '</div>' +
        '</div>'
      );
      $('#adminToastContainer').append($toast);
      setTimeout(function () {
        $toast.fadeOut(300, function () { $(this).remove(); });
      }, 3500);
    },

    getStatusBadge: function (stage) {
      stage = (stage || 'ORDER PLACED').toUpperCase();
      switch (stage) {
        case 'ORDER PLACED': return '<span class="badge-pill badge-placed"><i class="fa-regular fa-clock"></i> Placed</span>';
        case 'ORDER CONFIRMED': return '<span class="badge-pill badge-confirmed"><i class="fa-solid fa-check"></i> Confirmed</span>';
        case 'PREPARING': return '<span class="badge-pill badge-preparing"><i class="fa-solid fa-fire"></i> Preparing</span>';
        case 'READY FOR PICKUP': return '<span class="badge-pill badge-ready"><i class="fa-solid fa-bell"></i> Ready</span>';
        case 'ASSIGNED TO DELIVERY BOY': return '<span class="badge-pill badge-delivery"><i class="fa-solid fa-motorcycle"></i> Assigned</span>';
        case 'PICKED UP': return '<span class="badge-pill badge-delivery"><i class="fa-solid fa-box-open"></i> Picked Up</span>';
        case 'OUT FOR DELIVERY': return '<span class="badge-pill badge-delivery"><i class="fa-solid fa-route"></i> Out for Delivery</span>';
        case 'DELIVERED': return '<span class="badge-pill badge-delivered"><i class="fa-solid fa-circle-check"></i> Delivered</span>';
        case 'CANCELLED': case 'REJECTED': return '<span class="badge-pill badge-cancelled"><i class="fa-solid fa-ban"></i> Cancelled</span>';
        default: return '<span class="badge-pill badge-placed">' + esc(stage) + '</span>';
      }
    },

    formatDate: function (isoStr) {
      if (!isoStr) return 'N/A';
      try {
        var d = new Date(isoStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return isoStr;
      }
    },

    formatTimeAgo: function (isoStr) {
      if (!isoStr) return 'Just now';
      var sec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
      if (sec < 60) return sec + 's ago';
      var min = Math.floor(sec / 60);
      if (min < 60) return min + 'm ago';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'h ago';
      return Math.floor(hr / 24) + 'd ago';
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.AdminApp = AdminApp;

  $(document).ready(function () {
    AdminApp.init();
  });

})(window, document, jQuery);
