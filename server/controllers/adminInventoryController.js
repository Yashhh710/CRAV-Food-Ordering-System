const { Inventory } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getInventory(req, res) {
  try {
    const { category, search, lowStock } = req.query;
    let items = Inventory.find();

    if (category && category !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === category.toLowerCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(i => (i.name || '').toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q));
    }

    if (lowStock === 'true' || lowStock === true) {
      items = items.filter(i => Number(i.quantity) <= Number(i.minThreshold));
    }

    const lowStockCount = Inventory.find().filter(i => Number(i.quantity) <= Number(i.minThreshold)).length;

    res.json({
      success: true,
      totalItems: items.length,
      lowStockCount,
      inventory: items
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving inventory.' });
  }
}

async function createInventoryItem(req, res) {
  try {
    const { name, category, quantity, unit, minThreshold, supplier } = req.body;

    if (!name || quantity === undefined) {
      return res.status(400).json({ success: false, message: 'Item name and quantity are required.' });
    }

    const newItem = Inventory.insert({
      name: name.trim(),
      category: category || 'General',
      quantity: Number(quantity),
      unit: unit || 'units',
      minThreshold: Number(minThreshold) || 10,
      supplier: (supplier || 'Local Supplier').trim(),
      history: [
        {
          type: 'INITIAL_STOCK',
          amount: Number(quantity),
          resultingQuantity: Number(quantity),
          reason: 'Initial inventory intake',
          actor: `${req.user.firstName} ${req.user.lastName}`,
          timestamp: new Date().toISOString()
        }
      ]
    });

    logAudit({
      actor: req.user,
      action: 'INVENTORY_ITEM_CREATED',
      recordId: newItem.id,
      details: `Added new inventory item: ${newItem.name} (${newItem.quantity} ${newItem.unit})`,
      ip: req.ip
    });

    res.status(201).json({ success: true, message: 'Inventory item added successfully.', item: newItem });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error adding inventory item.' });
  }
}

async function adjustStock(req, res) {
  try {
    const { id } = req.params;
    const { reason, type } = req.body;
    const adjustment = req.body.adjustment !== undefined ? req.body.adjustment : req.body.changeAmount;

    if (adjustment === undefined || isNaN(adjustment)) {
      return res.status(400).json({ success: false, message: 'Valid numerical adjustment amount is required.' });
    }

    const item = Inventory.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Inventory item not found.' });
    }

    const change = Number(adjustment);
    const newQty = Math.max(0, Number(item.quantity) + change);
    const history = Array.isArray(item.history) ? item.history : [];

    history.push({
      type: type || (change >= 0 ? 'STOCK_IN' : 'STOCK_OUT'),
      amount: change,
      resultingQuantity: newQty,
      reason: reason || 'Manual stock adjustment',
      actor: `${req.user.firstName} ${req.user.lastName}`,
      timestamp: new Date().toISOString()
    });

    const updated = Inventory.findByIdAndUpdate(id, {
      quantity: newQty,
      history
    });

    logAudit({
      actor: req.user,
      action: 'STOCK_ADJUSTED',
      recordId: id,
      details: `Stock adjusted for ${item.name}: ${change >= 0 ? '+' : ''}${change} ${item.unit}. New balance: ${newQty}. Reason: ${reason || 'N/A'}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Stock updated for ${item.name}. New quantity: ${newQty} ${item.unit}.`,
      item: updated,
      inventory: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error adjusting stock.' });
  }
}

async function deleteInventoryItem(req, res) {
  try {
    const { id } = req.params;
    const item = Inventory.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Inventory item not found.' });
    }

    Inventory.findByIdAndDelete(id);

    logAudit({
      actor: req.user,
      action: 'INVENTORY_ITEM_DELETED',
      recordId: id,
      details: `Removed inventory record: ${item.name}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Inventory item ${item.name} removed.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting inventory item.' });
  }
}

module.exports = {
  getInventory,
  createInventoryItem,
  adjustStock,
  deleteInventoryItem
};
