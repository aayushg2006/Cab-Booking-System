const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// 🆕 Estimate Fare (Must come before other routes if possible, or just keep it organized)
router.post('/estimate', authMiddleware, bookingController.estimateFare);

router.post('/request', authMiddleware, bookingController.requestRide);
router.post('/accept', authMiddleware, bookingController.acceptRide);
router.post('/start', authMiddleware, bookingController.startRide);
router.post('/end', authMiddleware, bookingController.endRide);
router.get('/history', authMiddleware, bookingController.getHistory);
router.post('/pay', authMiddleware, bookingController.confirmPayment);
// 🆕 NEW ROUTES (Phase 5)
router.post('/sos', authMiddleware, bookingController.triggerSOS);
router.post('/rate', authMiddleware, bookingController.rateRide);

module.exports = router;