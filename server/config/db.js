const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultData = {
  users: [],
  otps: [],
  addresses: [],
  orders: [],
  reservations: [],
  products: [],
  categories: [],
  inventory: [],
  coupons: [],
  reviews: [],
  notifications: [],
  auditLogs: [],
  settings: []
};

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
      return JSON.parse(JSON.stringify(defaultData));
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    // Ensure all required collections exist
    Object.keys(defaultData).forEach(key => {
      if (!parsed[key]) parsed[key] = defaultData[key];
    });
    return parsed;
  } catch (err) {
    console.error('Error reading database file:', err);
    return defaultData;
  }
}

function writeDb(data) {
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Error writing database file:', err);
  }
}

// Model helper to provide MongoDB-like collection methods
function createCollection(collectionName) {
  return {
    find: (filter = {}) => {
      const db = readDb();
      const list = db[collectionName] || [];
      if (!filter || Object.keys(filter).length === 0) return [...list];
      return list.filter(item => {
        return Object.keys(filter).every(k => {
          if (filter[k] === undefined) return true;
          return item[k] === filter[k];
        });
      });
    },
    findOne: (filter = {}) => {
      const db = readDb();
      const list = db[collectionName] || [];
      return list.find(item => {
        return Object.keys(filter).every(k => {
          if (filter[k] === undefined) return true;
          return item[k] === filter[k];
        });
      }) || null;
    },
    findById: (id) => {
      const db = readDb();
      const list = db[collectionName] || [];
      return list.find(item => item.id === id || item._id === id) || null;
    },
    insert: (doc) => {
      const db = readDb();
      if (!db[collectionName]) db[collectionName] = [];
      const newDoc = {
        id: doc.id || doc._id || ('crav_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
        createdAt: doc.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...doc
      };
      db[collectionName].push(newDoc);
      writeDb(db);
      return newDoc;
    },
    update: (filter, updateData) => {
      const db = readDb();
      const list = db[collectionName] || [];
      let updatedCount = 0;
      let updatedItem = null;
      db[collectionName] = list.map(item => {
        const matches = Object.keys(filter).every(k => item[k] === filter[k]);
        if (matches) {
          updatedCount++;
          updatedItem = { ...item, ...updateData, updatedAt: new Date().toISOString() };
          return updatedItem;
        }
        return item;
      });
      if (updatedCount > 0) {
        writeDb(db);
      }
      return updatedItem;
    },
    findByIdAndUpdate: (id, updateData) => {
      const db = readDb();
      const list = db[collectionName] || [];
      let updatedItem = null;
      db[collectionName] = list.map(item => {
        if (item.id === id || item._id === id) {
          updatedItem = { ...item, ...updateData, updatedAt: new Date().toISOString() };
          return updatedItem;
        }
        return item;
      });
      if (updatedItem) {
        writeDb(db);
      }
      return updatedItem;
    },
    delete: (filter) => {
      const db = readDb();
      const list = db[collectionName] || [];
      const remaining = list.filter(item => {
        return !Object.keys(filter).every(k => item[k] === filter[k]);
      });
      db[collectionName] = remaining;
      writeDb(db);
      return true;
    },
    findByIdAndDelete: (id) => {
      const db = readDb();
      const list = db[collectionName] || [];
      const remaining = list.filter(item => item.id !== id && item._id !== id);
      db[collectionName] = remaining;
      writeDb(db);
      return true;
    },
    count: (filter = {}) => {
      const db = readDb();
      const list = db[collectionName] || [];
      if (!filter || Object.keys(filter).length === 0) return list.length;
      return list.filter(item => {
        return Object.keys(filter).every(k => item[k] === filter[k]);
      }).length;
    }
  };
}

const Users = createCollection('users');
const Otps = createCollection('otps');
const Addresses = createCollection('addresses');
const Orders = createCollection('orders');
const Reservations = createCollection('reservations');
const Products = createCollection('products');
const Categories = createCollection('categories');
const Inventory = createCollection('inventory');
const Coupons = createCollection('coupons');
const Reviews = createCollection('reviews');
const Notifications = createCollection('notifications');
const AuditLogs = createCollection('auditLogs');
const Settings = createCollection('settings');

// Bootstrap seeder for initial CRAV setup
async function seedInitialData() {
  try {
    // 1. Seed Super Admin account
    const yash = Users.findOne({ email: 'tambadeyash96@gmail.com' });
    if (yash) {
      Users.findByIdAndUpdate(yash.id, {
        firstName: 'Yash',
        lastName: 'Tambade',
        role: 'SUPER_ADMIN',
        permissions: ['*'],
        status: 'active',
        isVerified: true
      });
      console.log('✅ Yash Tambade promoted to Super Admin (tambadeyash96@gmail.com)');
    }

    const superAdmin = Users.findOne({ role: 'SUPER_ADMIN' });
    if (!superAdmin) {
      const hashedPassword = await bcrypt.hash('Admin@CRAV2026!', 10);
      Users.insert({
        firstName: 'Yash',
        lastName: 'Tambade',
        email: 'tambadeyash96@gmail.com',
        phone: '+91 90000 00000',
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        permissions: ['*'],
        status: 'active',
        isVerified: true,
        lastLogin: null
      });
      console.log('✅ Super Admin account bootstrapped: tambadeyash96@gmail.com');
    }

    // 2. Seed Default Settings if empty
    const currentSettings = Settings.findOne({ key: 'general' });
    if (!currentSettings) {
      Settings.insert({
        key: 'general',
        restaurantName: 'CRAV',
        tagline: 'From Craving to Doorstep.',
        openingHours: 'Every Day 11:00 AM to 11:00 PM',
        phone: '+91 90000 00000',
        email: 'hello@crav.example',
        address: 'Online Demonstration Platform (College Software Project)',
        currency: '₹',
        deliveryFee: 40,
        taxPercent: 5,
        minOrderAmount: 99,
        announcement: 'Welcome to CRAV! Enjoy fresh, hot food delivered to your doorstep.'
      });
    }

    // 3. Seed Products and Categories from crav_menu.json if products collection is empty
    if (Products.count() === 0) {
      const menuPath = path.join(__dirname, '../../assets/js/crav_menu.json');
      if (fs.existsSync(menuPath)) {
        const menuRaw = fs.readFileSync(menuPath, 'utf-8');
        const menuData = JSON.parse(menuRaw);
        if (menuData.categories && Array.isArray(menuData.categories)) {
          let orderSeq = 1;
          menuData.categories.forEach(cat => {
            const catId = cat.id || cat.name.toLowerCase().replace(/\s+/g, '-');
            Categories.insert({
              id: catId,
              name: cat.name,
              slug: catId,
              displayOrder: orderSeq++,
              status: 'active',
              description: `Delicious ${cat.name} selection made fresh.`
            });

            if (cat.items && Array.isArray(cat.items)) {
              cat.items.forEach(it => {
                const isVeg = !/chicken|pepperoni|meat|beef|fish|prawn/i.test(it.name);
                Products.insert({
                  id: it.id || ('prod_' + Math.random().toString(36).substr(2, 8)),
                  name: it.name,
                  categoryId: catId,
                  categoryName: cat.name,
                  price: Number(it.price) || 199,
                  description: `${it.name} - freshly prepared with premium ingredients and authentic seasonings.`,
                  image: it.image || 'assets/models/menu/bbq-chicken-pizza.png',
                  isVeg: isVeg,
                  stockQuantity: 50,
                  isAvailable: true,
                  isFeatured: Math.random() > 0.6,
                  isPopular: Math.random() > 0.5
                });
              });
            }
          });
          console.log(`✅ Menu synchronized: ${Categories.count()} categories and ${Products.count()} products populated into database.`);
        }
      }
    }

    // 4. Seed sample inventory items if inventory is empty
    if (Inventory.count() === 0) {
      const sampleInventory = [
        { name: 'Pizza Dough Base (Regular)', category: 'Ingredients', quantity: 150, unit: 'pcs', minThreshold: 30, supplier: 'CRAV Bakery Supplies' },
        { name: 'Mozzarella Cheese Blend', category: 'Dairy', quantity: 45, unit: 'kg', minThreshold: 10, supplier: 'Metro Dairy Farm' },
        { name: 'Fresh Paneer Cubes', category: 'Dairy', quantity: 25, unit: 'kg', minThreshold: 5, supplier: 'Fresh Dairy Co' },
        { name: 'Boneless Chicken Breast', category: 'Meat', quantity: 40, unit: 'kg', minThreshold: 12, supplier: 'Royal Poultry' },
        { name: 'CRAV Signature Pizza Sauce', category: 'Sauces', quantity: 60, unit: 'litres', minThreshold: 15, supplier: 'In-House Prep' },
        { name: 'Burger Buns (Brioche)', category: 'Bakery', quantity: 120, unit: 'pcs', minThreshold: 25, supplier: 'CRAV Bakery Supplies' },
        { name: 'Food Grade Tamper-Proof Boxes', category: 'Packaging', quantity: 300, unit: 'pcs', minThreshold: 50, supplier: 'EcoPack India' }
      ];
      sampleInventory.forEach(item => Inventory.insert(item));
    }

    // 5. Seed default coupons if coupons collection is empty
    if (Coupons.count() === 0) {
      Coupons.insert({
        code: 'WELCOME50',
        type: 'percentage',
        discountValue: 20,
        maxDiscount: 100,
        minOrderAmount: 299,
        validUntil: '2027-12-31',
        usageLimit: 500,
        usedCount: 14,
        status: 'active',
        description: 'Get 20% off up to ₹100 on orders above ₹299.'
      });
      Coupons.insert({
        code: 'CRAVFLAT100',
        type: 'fixed',
        discountValue: 100,
        maxDiscount: 100,
        minOrderAmount: 499,
        validUntil: '2027-12-31',
        usageLimit: 300,
        usedCount: 28,
        status: 'active',
        description: 'Flat ₹100 off on gourmet feasts above ₹499.'
      });
    }

  } catch (err) {
    console.error('Error during database seeding:', err);
  }
}

module.exports = {
  readDb,
  writeDb,
  createCollection,
  seedInitialData,
  Users,
  Otps,
  Addresses,
  Orders,
  Reservations,
  Products,
  Categories,
  Inventory,
  Coupons,
  Reviews,
  Notifications,
  AuditLogs,
  Settings
};
