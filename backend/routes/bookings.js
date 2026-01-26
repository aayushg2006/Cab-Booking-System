const express = require('express');
const router = express.Router();
const { 
    requestRide, 
    acceptRide, 
    rejectRide, 
    startRide, 
    endRide,
    getRideHistory 
} = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

router.post('/request', protect, requestRide);
router.post('/accept', protect, acceptRide); 
router.post('/reject', protect, rejectRide);
router.post('/start', protect, startRide);
router.post('/end', protect, endRide);
router.get('/history', protect, getRideHistory);

module.exports = router;