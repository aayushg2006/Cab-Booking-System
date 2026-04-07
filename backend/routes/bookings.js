const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Fare estimate
router.post('/estimate', authMiddleware, bookingController.estimateFare);
router.post('/apply-promo', authMiddleware, bookingController.applyPromo);

// Public shared trip tracking (tokenized link)
router.get('/track/:token', bookingController.getSharedTripStatus);

router.get('/saved-places', authMiddleware, bookingController.getSavedPlaces);
router.post('/saved-places', authMiddleware, bookingController.savePlace);
router.delete('/saved-places/:placeId', authMiddleware, bookingController.deleteSavedPlace);
router.get('/upcoming', authMiddleware, bookingController.getUpcomingRides);
router.get('/receipt/:bookingId', authMiddleware, bookingController.getRideReceipt);
router.get('/driver/earnings', authMiddleware, bookingController.getDriverEarningsSummary);

router.post('/request', authMiddleware, bookingController.requestRide);
router.post('/share-link', authMiddleware, bookingController.createTripShareLink);
router.post('/driver/availability', authMiddleware, bookingController.updateDriverAvailability);
router.post('/driver-location', authMiddleware, bookingController.updateDriverLocation);
router.post('/accept', authMiddleware, bookingController.acceptRide);
router.post('/start', authMiddleware, bookingController.startRide);
router.post('/end', authMiddleware, bookingController.endRide);
router.post('/cancel', authMiddleware, bookingController.cancelRide);
router.get('/history', authMiddleware, bookingController.getHistory);
router.post('/pay', authMiddleware, bookingController.confirmPayment);
router.post('/sos', authMiddleware, bookingController.triggerSOS);
router.post('/rate', authMiddleware, bookingController.rateRide);

module.exports = router;
