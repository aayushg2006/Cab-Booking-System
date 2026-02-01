const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');

// Route: POST /api/payments/create-order
router.post('/create-order', authMiddleware, paymentController.createOrder);

// Route: POST /api/payments/verify
router.post('/verify', authMiddleware, paymentController.verifyPayment);

module.exports = router;