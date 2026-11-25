const { Reviews } = require('../config/db');
const { logAudit } = require('../utils/auditLogger');

async function getReviews(req, res) {
  try {
    const { status, rating } = req.query;
    let reviews = Reviews.find();

    if (status && status !== 'all') {
      reviews = reviews.filter(r => (r.status || 'pending').toLowerCase() === status.toLowerCase());
    }

    if (rating) {
      reviews = reviews.filter(r => Number(r.rating) === Number(rating));
    }

    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: reviews.length, reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving reviews.' });
  }
}

async function moderateReview(req, res) {
  try {
    const { id } = req.params;
    const { status, reply } = req.body;

    const review = Reviews.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    const payload = {};
    if (status) payload.status = status; // approved, hidden, rejected
    if (reply !== undefined) {
      payload.adminReply = {
        text: reply.trim(),
        repliedBy: `${req.user.firstName} ${req.user.lastName}`,
        timestamp: new Date().toISOString()
      };
    }

    const updated = Reviews.findByIdAndUpdate(id, payload);

    logAudit({
      actor: req.user,
      action: 'REVIEW_MODERATED',
      recordId: id,
      details: `Review #${id} moderated. Status=${updated.status}`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Review moderated successfully.', review: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error moderating review.' });
  }
}

async function deleteReview(req, res) {
  try {
    const { id } = req.params;
    Reviews.findByIdAndDelete(id);
    res.json({ success: true, message: 'Review removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting review.' });
  }
}

// Public endpoint for submitting review
async function submitReviewPublic(req, res) {
  try {
    const { name, rating, comment, orderId } = req.body;
    if (!name || !rating || !comment) {
      return res.status(400).json({ success: false, message: 'Name, rating, and comment are required.' });
    }

    const newReview = Reviews.insert({
      name: name.trim(),
      rating: Math.min(5, Math.max(1, Number(rating))),
      comment: comment.trim(),
      orderId: orderId || null,
      status: 'pending',
      adminReply: null
    });

    res.status(201).json({
      success: true,
      message: 'Thank you for your review! It will be visible after moderation.',
      review: newReview
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error submitting review.' });
  }
}

module.exports = {
  getReviews,
  moderateReview,
  deleteReview,
  submitReviewPublic
};
