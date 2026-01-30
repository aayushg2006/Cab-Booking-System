const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Debugging: Check if functions are loaded correctly
if (typeof bookingController.requestRide !== 'function') {
    console.error("❌ ERROR: bookingController.requestRide is not a function. Check controller exports.");
}
if (typeof authMiddleware !== 'function') {
    console.error("❌ ERROR: authMiddleware is not a function. Check middleware exports.");
}

// Routes
router.post('/request', authMiddleware, bookingController.requestRide);
router.post('/accept', authMiddleware, bookingController.acceptRide);
router.post('/start', authMiddleware, bookingController.startRide);
router.post('/end', authMiddleware, bookingController.endRide);
router.get('/history', authMiddleware, bookingController.getHistory);

router.post('/pay', authMiddleware, bookingController.confirmPayment);
module.exports = router;