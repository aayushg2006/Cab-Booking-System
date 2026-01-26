const express = require('express');
const router = express.Router();
const { requestRide } = require('../controllers/bookingController');
// In real app, add 'protect' middleware here to ensure user is logged in

router.post('/request', requestRide);
router.post('/accept', acceptRide); 

module.exports = router;