const { Coupons } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getCoupons(req, res) {
  try {
    const coupons = Coupons.find();
    coupons.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, count: coupons.length, coupons });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving coupons.' });
  }
}

async function createCoupon(req, res) {
  try {
    const { code, type, maxDiscount, minOrderAmount, validUntil, usageLimit, description } = req.body;
    const discountValue = req.body.discountValue !== undefined ? req.body.discountValue : req.body.discount;

    if (!code || discountValue === undefined) {
      return res.status(400).json({ success: false, message: 'Coupon code and discount value are required.' });
    }

    const cleanCode = String(code).trim().toUpperCase();
    const existing = Coupons.findOne({ code: cleanCode });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A coupon with this code already exists.' });
    }

    const newCoupon = Coupons.insert({
      code: cleanCode,
      type: type === 'fixed' ? 'fixed' : 'percentage',
      discountValue: Number(discountValue),
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      minOrderAmount: Number(minOrderAmount) || 0,
      validUntil: validUntil || '2027-12-31',
      usageLimit: Number(usageLimit) || 100,
      usedCount: 0,
      status: 'active',
      description: (description || '').trim()
    });

    logAudit({
      actor: req.user,
      action: 'COUPON_CREATED',
      recordId: newCoupon.id,
      details: `Created coupon ${newCoupon.code} (${newCoupon.type}: ${newCoupon.discountValue})`,
      ip: req.ip
    });

    res.status(201).json({ success: true, message: `Coupon ${newCoupon.code} created successfully.`, coupon: newCoupon });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating coupon.' });
  }
}

async function updateCoupon(req, res) {
  try {
    const { id } = req.params;
    const { discountValue, maxDiscount, minOrderAmount, validUntil, usageLimit, status, description } = req.body;

    const coupon = Coupons.findById(id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    const payload = {};
    if (discountValue !== undefined) payload.discountValue = Number(discountValue);
    if (maxDiscount !== undefined) payload.maxDiscount = Number(maxDiscount);
    if (minOrderAmount !== undefined) payload.minOrderAmount = Number(minOrderAmount);
    if (validUntil !== undefined) payload.validUntil = validUntil;
    if (usageLimit !== undefined) payload.usageLimit = Number(usageLimit);
    if (status !== undefined) payload.status = status;
    if (description !== undefined) payload.description = description.trim();

    const updated = Coupons.findByIdAndUpdate(id, payload);

    logAudit({
      actor: req.user,
      action: 'COUPON_UPDATED',
      recordId: id,
      details: `Updated coupon ${updated.code} status=${updated.status}`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Coupon updated successfully.', coupon: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating coupon.' });
  }
}

async function deleteCoupon(req, res) {
  try {
    const { id } = req.params;
    const coupon = Coupons.findById(id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    Coupons.findByIdAndDelete(id);

    logAudit({
      actor: req.user,
      action: 'COUPON_DELETED',
      recordId: id,
      details: `Deleted coupon: ${coupon.code}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Coupon ${coupon.code} removed.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting coupon.' });
  }
}

// Public endpoint for cart discount verification
async function validateCouponPublic(req, res) {
  try {
    const { code } = req.body;
    const orderTotal = req.body.orderTotal !== undefined ? req.body.orderTotal : req.body.orderAmount;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code required.' });
    }

    const cleanCode = String(code).trim().toUpperCase();
    const coupon = Coupons.findOne({ code: cleanCode, status: 'active' });

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Invalid or expired coupon code.' });
    }

    // Check expiration
    if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) {
      return res.status(400).json({ success: false, message: 'This coupon has expired.' });
    }

    // Check usage limit
    if (coupon.usageLimit && (coupon.usedCount || 0) >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit has been reached.' });
    }

    const total = Number(orderTotal) || 0;
    if (total < Number(coupon.minOrderAmount || 0)) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}.`
      });
    }

    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (total * Number(coupon.discountValue)) / 100;
      if (coupon.maxDiscount && discount > Number(coupon.maxDiscount)) {
        discount = Number(coupon.maxDiscount);
      }
    } else {
      discount = Number(coupon.discountValue);
    }

    discount = Math.min(total, Math.round(discount));

    res.json({
      success: true,
      code: coupon.code,
      discount,
      finalTotal: Math.max(0, total - discount),
      description: coupon.description
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error validating coupon.' });
  }
}

module.exports = {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCouponPublic
};
