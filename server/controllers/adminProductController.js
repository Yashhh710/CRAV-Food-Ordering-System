const { Products, Categories } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getProducts(req, res) {
  try {
    const { categoryId, search, isAvailable, isVeg, page = 1, limit = 50 } = req.query;
    let products = Products.find();

    if (categoryId && categoryId !== 'all') {
      products = products.filter(p => p.categoryId === categoryId);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      products = products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }

    if (isAvailable !== undefined && isAvailable !== '') {
      const boolVal = isAvailable === 'true' || isAvailable === true;
      products = products.filter(p => p.isAvailable === boolVal);
    }

    if (isVeg !== undefined && isVeg !== '') {
      const boolVal = isVeg === 'true' || isVeg === true;
      products = products.filter(p => p.isVeg === boolVal);
    }

    const total = products.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = products.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      products: paginated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving products.' });
  }
}

async function createProduct(req, res) {
  try {
    const { name, price, description, image, isVeg, stockQuantity, isAvailable, isFeatured, isPopular } = req.body;
    const categoryId = req.body.categoryId || req.body.category;

    if (!name || !categoryId || price === undefined) {
      return res.status(400).json({ success: false, message: 'Product name, category and price are required.' });
    }

    const category = Categories.findById(categoryId) || Categories.findOne({ id: categoryId });
    const categoryName = category ? category.name : categoryId;

    const newProd = Products.insert({
      name: name.trim(),
      categoryId,
      categoryName,
      price: Number(price),
      description: (description || '').trim(),
      image: image || 'assets/models/menu/bbq-chicken-pizza.png',
      isVeg: Boolean(isVeg),
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : 50,
      isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : true,
      isFeatured: Boolean(isFeatured),
      isPopular: Boolean(isPopular)
    });

    logAudit({
      actor: req.user,
      action: 'PRODUCT_CREATED',
      recordId: newProd.id,
      details: `Created new menu product: ${newProd.name} (₹${newProd.price}) in category ${categoryName}`,
      ip: req.ip
    });

    res.status(201).json({ success: true, message: 'Product created successfully.', product: newProd });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ success: false, message: 'Server error creating product.' });
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, price, description, image, isVeg, stockQuantity, isAvailable, isFeatured, isPopular } = req.body;
    const categoryId = req.body.categoryId || req.body.category;

    const existing = Products.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const updatePayload = {};
    if (name) updatePayload.name = name.trim();
    if (price !== undefined) updatePayload.price = Number(price);
    if (description !== undefined) updatePayload.description = description.trim();
    if (image !== undefined) updatePayload.image = image.trim();
    if (isVeg !== undefined) updatePayload.isVeg = Boolean(isVeg);
    if (stockQuantity !== undefined) updatePayload.stockQuantity = Number(stockQuantity);
    if (isAvailable !== undefined) updatePayload.isAvailable = Boolean(isAvailable);
    if (isFeatured !== undefined) updatePayload.isFeatured = Boolean(isFeatured);
    if (isPopular !== undefined) updatePayload.isPopular = Boolean(isPopular);

    if (categoryId) {
      updatePayload.categoryId = categoryId;
      const cat = Categories.findById(categoryId) || Categories.findOne({ id: categoryId });
      if (cat) updatePayload.categoryName = cat.name;
    }

    const updated = Products.findByIdAndUpdate(id, updatePayload);

    logAudit({
      actor: req.user,
      action: 'PRODUCT_UPDATED',
      recordId: id,
      details: `Updated product ${updated.name}: Price=₹${updated.price}, Stock=${updated.stockQuantity}, Available=${updated.isAvailable}`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Product updated successfully.', product: updated });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ success: false, message: 'Server error updating product.' });
  }
}

async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const existing = Products.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    Products.findByIdAndDelete(id);

    logAudit({
      actor: req.user,
      action: 'PRODUCT_DELETED',
      recordId: id,
      details: `Deleted product: ${existing.name} (${existing.categoryName})`,
      ip: req.ip
    });

    res.json({ success: true, message: `Product ${existing.name} removed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting product.' });
  }
}

async function getCategories(req, res) {
  try {
    const categories = Categories.find();
    const products = Products.find();

    const enriched = categories.map(c => {
      const count = products.filter(p => p.categoryId === c.id || p.categoryId === c.slug).length;
      return { ...c, productCount: count };
    });

    enriched.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    res.json({ success: true, categories: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving categories.' });
  }
}

async function createCategory(req, res) {
  try {
    const { name, description, image, displayOrder } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newCat = Categories.insert({
      id: slug,
      name: name.trim(),
      slug,
      description: description || '',
      image: image || '',
      displayOrder: Number(displayOrder) || Categories.count() + 1,
      status: 'active'
    });

    logAudit({
      actor: req.user,
      action: 'CATEGORY_CREATED',
      recordId: newCat.id,
      details: `Created new menu category: ${newCat.name}`,
      ip: req.ip
    });

    res.status(201).json({ success: true, message: 'Category created successfully.', category: newCat });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating category.' });
  }
}

async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, description, image, displayOrder, status } = req.body;

    const existing = Categories.findById(id) || Categories.findOne({ id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const payload = {};
    if (name) payload.name = name.trim();
    if (description !== undefined) payload.description = description.trim();
    if (image !== undefined) payload.image = image.trim();
    if (displayOrder !== undefined) payload.displayOrder = Number(displayOrder);
    if (status !== undefined) payload.status = status;

    const updated = Categories.findByIdAndUpdate(existing.id, payload);

    logAudit({
      actor: req.user,
      action: 'CATEGORY_UPDATED',
      recordId: id,
      details: `Updated category ${updated.name}`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Category updated successfully.', category: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating category.' });
  }
}

async function deleteCategory(req, res) {
  try {
    const { id } = req.params;
    const existing = Categories.findById(id) || Categories.findOne({ id });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    // Safe deletion: Check if products belong to this category
    const linkedProducts = Products.find({ categoryId: existing.id });
    if (linkedProducts.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category "${existing.name}". It contains ${linkedProducts.length} active products. Reassign or delete those products first.`
      });
    }

    Categories.findByIdAndDelete(existing.id);

    logAudit({
      actor: req.user,
      action: 'CATEGORY_DELETED',
      recordId: id,
      details: `Deleted category: ${existing.name}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Category "${existing.name}" removed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting category.' });
  }
}

// Public API endpoint for customer menu sync
async function getPublicMenu(req, res) {
  try {
    const categories = Categories.find({ status: 'active' });
    const products = Products.find({ isAvailable: true });

    categories.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    const menu = categories.map(cat => ({
      id: cat.id || cat.slug,
      name: cat.name,
      description: cat.description,
      items: products.filter(p => p.categoryId === cat.id || p.categoryId === cat.slug)
    })).filter(cat => cat.items.length > 0);

    res.json({ success: true, categories: menu, products: products });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching menu.' });
  }
}

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getPublicMenu
};
