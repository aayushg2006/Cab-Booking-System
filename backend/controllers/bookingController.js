const pool = require('../config/db');

// Helper: Calculate distance between two coordinates (Haversine Formula)
function getDistanceFromLatLonInKmYB(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// @desc    Rider requests a ride
// @route   POST /api/bookings/request
exports.requestRide = async (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress } = req.body;

    console.log(`🔎 Searching for driver near [${pickupLat}, ${pickupLng}]...`);

    // 1. Find the nearest active driver from our memory (global.activeDrivers)
    let nearestDriver = null;
    let minDistance = 10000; // Start with a huge distance

    // Loop through all active drivers
    global.activeDrivers.forEach((driverData, driverId) => {
        const dist = getDistanceFromLatLonInKmYB(pickupLat, pickupLng, driverData.lat, driverData.lng);
        
        // If this driver is closer than previous best, pick them
        if (dist < minDistance) {
            minDistance = dist;
            nearestDriver = { id: driverId, ...driverData };
        }
    });

    if (!nearestDriver) {
        return res.status(404).json({ message: 'No drivers available nearby' });
    }

    console.log(`✅ Found Driver ${nearestDriver.id} (${minDistance.toFixed(2)}km away)`);

    // 2. Create Booking in MySQL (Pending Status)
    try {
        const query = `INSERT INTO bookings (rider_id, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, status, fare) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0.00)`; // Price 0 for now
        
        const [result] = await pool.promise().query(query, [
            riderId, nearestDriver.id, pickupLat, pickupLng, dropLat, dropLng, pickupAddress
        ]);

        const bookingId = result.insertId;

        // 3. THE MAGIC: Alert the Driver via Socket!
        // We use the io object attached to the request (We need to add this in server.js next)
        const io = req.app.get('socketio'); 
        
        io.to(nearestDriver.socketId).emit('newRideRequest', {
            bookingId: bookingId,
            pickupAddress: pickupAddress,
            distance: minDistance.toFixed(1) + ' km'
        });

        res.status(200).json({ 
            message: 'Ride requested! Waiting for driver...', 
            driverFound: nearestDriver.id,
            bookingId: bookingId 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};

// @desc    Driver accepts a booking
// @route   POST /api/bookings/accept
exports.acceptRide = async (req, res) => {
    const { bookingId, driverId } = req.body;

    try {
        // 1. Update Booking Status in Database
        const query = `UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ?`;
        const [result] = await pool.promise().query(query, [driverId, bookingId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Booking not found or already taken' });
        }

        // 2. Notify the Rider (Real-time)
        // In a real app, we would send this to the specific Rider's socket ID.
        // For now, we will broadcast it so we can see it in logs.
        const io = req.app.get('socketio');
        io.emit('rideAccepted', { 
            message: `Driver ${driverId} accepted your ride!`,
            bookingId: bookingId,
            driverId: driverId
        });

        res.status(200).json({ message: 'Ride Accepted Successfully' });
        console.log(`cw Driver ${driverId} ACCEPTED booking ${bookingId}`);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};