const fs = require('fs');
const path = require('path');

// Safe .env loader (works with or without the dotenv package)
try {
  require('dotenv').config();
} catch (e) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value.trim();
      }
    });
  }
}

// Check for express and cors
let express, cors;
try {
  express = require('express');
  cors = require('cors');
} catch (err) {
  console.error('\n======================================================');
  console.error('❌ Missing dependencies in node_modules!');
  console.error('👉 Please run this command in your terminal first:');
  console.error('   npm install');
  console.error('======================================================\n');
  process.exit(1);
}

const { seedInitialData } = require('./server/config/db');
const authRoutes = require('./server/routes/authRoutes');
const userRoutes = require('./server/routes/userRoutes');
const paymentRoutes = require('./server/routes/paymentRoutes');
const orderRoutes = require('./server/routes/orderRoutes');
const reservationRoutes = require('./server/routes/reservationRoutes');
const adminRoutes = require('./server/routes/adminRoutes');
const publicRoutes = require('./server/routes/publicRoutes');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve all static frontend files directly from current folder
app.use(express.static(path.join(__dirname)));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: 'CRAV - From Craving to Doorstep',
    mode: 'Academic / Demo Mode',
    timestamp: new Date().toISOString()
  });
});

// Start Server
if (require.main === module) {
  app.listen(PORT, async () => {
    await seedInitialData();
    console.log(`\n======================================================`);
    console.log(`🚀 CRAV Full-Stack Server Running on Port ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`🛡️ Admin Control Center: http://localhost:${PORT}/admin-login.html`);
    console.log(`📱 Demo QR Payment URL: http://localhost:${PORT}/pay-mobile.html`);
    console.log(`🍴 Mode: Realistic Demo Simulation (No real payments)`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
