const { Orders, Users, Reservations, Inventory, Products, AuditLogs } = require('../config/db');

async function getDashboardOverview(req, res) {
  try {
    const orders = Orders.find();
    const users = Users.find();
    const reservations = Reservations.find();
    const inventory = Inventory.find();
    const products = Products.find();
    const auditLogs = AuditLogs.find();

    const todayStr = new Date().toISOString().split('T')[0];

    // Filter today's orders
    const todayOrders = orders.filter(o => (o.createdAt || '').startsWith(todayStr));

    // Revenue calculations (from actual database records)
    const totalCollected = orders
      .filter(o => ['DELIVERED', 'PAID'].includes((o.stage || '').toUpperCase()) || o.payment?.status === 'Paid')
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const todayCollected = todayOrders
      .filter(o => ['DELIVERED', 'PAID'].includes((o.stage || '').toUpperCase()) || o.payment?.status === 'Paid')
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const totalVolume = orders
      .filter(o => !['CANCELLED', 'REJECTED'].includes((o.stage || '').toUpperCase()))
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const todayVolume = todayOrders
      .filter(o => !['CANCELLED', 'REJECTED'].includes((o.stage || '').toUpperCase()))
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const totalRevenue = totalCollected > 0 ? totalCollected : totalVolume;
    const todayRevenue = todayCollected > 0 ? todayCollected : todayVolume;

    // Order status tallies
    const counts = {
      total: orders.length,
      today: todayOrders.length,
      pending: orders.filter(o => ['ORDER PLACED', 'PENDING'].includes((o.stage || '').toUpperCase())).length,
      confirmed: orders.filter(o => (o.stage || '').toUpperCase() === 'ORDER CONFIRMED').length,
      preparing: orders.filter(o => (o.stage || '').toUpperCase() === 'PREPARING').length,
      ready: orders.filter(o => (o.stage || '').toUpperCase() === 'READY FOR PICKUP').length,
      outForDelivery: orders.filter(o => ['ASSIGNED TO DELIVERY BOY', 'PICKED UP', 'OUT FOR DELIVERY'].includes((o.stage || '').toUpperCase())).length,
      delivered: orders.filter(o => (o.stage || '').toUpperCase() === 'DELIVERED').length,
      cancelled: orders.filter(o => ['CANCELLED', 'REJECTED'].includes((o.stage || '').toUpperCase())).length
    };

    // Customer & Staff counts
    const registeredCustomers = users.filter(u => !u.role || u.role.toLowerCase() === 'customer').length;
    const activeDeliveryBoys = users.filter(u => (u.role || '').toUpperCase() === 'DELIVERY_BOY' && u.availability !== 'offline').length;
    const pendingReservations = reservations.filter(r => (r.status || 'pending').toLowerCase() === 'pending').length;
    const lowStockAlerts = inventory.filter(i => Number(i.quantity) <= Number(i.minThreshold)).length;

    // 7-Day Sales Trend (Last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const dayOrders = orders.filter(o => (o.createdAt || '').startsWith(dateKey));
      const dayRevenue = dayOrders
        .filter(o => !['CANCELLED', 'REJECTED'].includes((o.stage || '').toUpperCase()))
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

      last7Days.push({
        date: dateKey,
        label: dayLabel,
        orders: dayOrders.length,
        revenue: Math.round(dayRevenue)
      });
    }

    // Popular products calculated from actual order records
    const productTally = {};
    orders.forEach(o => {
      if (Array.isArray(o.items)) {
        o.items.forEach(it => {
          const name = it.name || it.title || 'Special Item';
          if (!productTally[name]) {
            productTally[name] = { name, count: 0, revenue: 0, image: it.image || '' };
          }
          productTally[name].count += (Number(it.quantity) || 1);
          productTally[name].revenue += ((Number(it.price) || 0) * (Number(it.quantity) || 1));
        });
      }
    });

    let popularProducts = Object.values(productTally).sort((a, b) => b.count - a.count).slice(0, 5);

    // If zero orders exist yet, fall back to featured products from catalog
    if (popularProducts.length === 0) {
      popularProducts = products.slice(0, 5).map(p => ({
        name: p.name,
        count: 0,
        revenue: 0,
        image: p.image
      }));
    }

    // Recent orders (latest 6)
    const sortedOrders = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recentOrders = sortedOrders.slice(0, 6);

    // Recent audit logs (latest 6)
    const sortedLogs = [...auditLogs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentAudit = sortedLogs.slice(0, 6);

    res.json({
      success: true,
      metrics: {
        totalRevenue: Math.round(totalRevenue),
        todayRevenue: Math.round(todayRevenue),
        counts,
        registeredCustomers,
        activeDeliveryBoys,
        pendingReservations,
        lowStockAlerts
      },
      charts: {
        salesTrend: last7Days
      },
      popularProducts,
      recentOrders,
      recentAudit
    });
  } catch (err) {
    console.error('Dashboard overview error:', err);
    res.status(500).json({ success: false, message: 'Server error compiling dashboard overview.' });
  }
}

async function getSalesReport(req, res) {
  try {
    const { period = 'monthly', startDate, endDate } = req.query;
    const orders = Orders.find();

    let filtered = orders;
    if (startDate && endDate) {
      filtered = filtered.filter(o => {
        const d = (o.createdAt || '').split('T')[0];
        return d >= startDate && d <= endDate;
      });
    }

    // Grouping
    const groupings = {};
    filtered.forEach(o => {
      const created = new Date(o.createdAt || Date.now());
      let key = created.toISOString().split('T')[0]; // Daily default
      if (period === 'monthly') {
        key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      } else if (period === 'weekly') {
        const weekNum = Math.ceil(created.getDate() / 7);
        key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')} (W${weekNum})`;
      }

      if (!groupings[key]) {
        groupings[key] = {
          period: key,
          ordersCount: 0,
          deliveredCount: 0,
          cancelledCount: 0,
          totalSales: 0,
          collectedRevenue: 0
        };
      }

      groupings[key].ordersCount++;
      const stage = (o.stage || '').toUpperCase();
      if (stage === 'DELIVERED') groupings[key].deliveredCount++;
      if (['CANCELLED', 'REJECTED'].includes(stage)) groupings[key].cancelledCount++;
      groupings[key].totalSales += (Number(o.total) || 0);
      if (o.payment?.status === 'Paid' || stage === 'DELIVERED') {
        groupings[key].collectedRevenue += (Number(o.total) || 0);
      }
    });

    const reportRows = Object.values(groupings).sort((a, b) => b.period.localeCompare(a.period));

    res.json({
      success: true,
      period,
      totalOrders: filtered.length,
      report: reportRows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error generating sales report.' });
  }
}

module.exports = {
  getDashboardOverview,
  getSalesReport
};
