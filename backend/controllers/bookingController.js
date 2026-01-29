// backend/controllers/bookingController.js
const pool = require('../config/db');

exports.requestRide = async (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress } = req.body;

    // 1. Validate Input
    if (!riderId || !pickupLat || !pickupLng) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`\n🔍 SEARCH STARTED: Rider ${riderId} at [${pickupLat}, ${pickupLng}]`);
    console.log(`🚗 Total Online Drivers: ${global.activeDrivers.size}`);

    // 2. Check if any drivers are online
    if (global.activeDrivers.size === 0) {
        console.log("❌ Result: No drivers are currently online.");
        return res.status(404).json({ message: "No drivers are currently online. Please go online from a driver account." });
    }

    // 3. Find Nearest Driver
    let nearestDriver = null;
    let minDistance = Infinity;
    const MAX_RADIUS_KM = 5000; // Large radius for testing

    // Loop through all online drivers
    for (let [driverKey, driverData] of global.activeDrivers.entries()) {
        const dist = calculateDistance(pickupLat, pickupLng, driverData.lat, driverData.lng);
        
        console.log(`   👉 Driver ID: ${driverKey} | Location: [${driverData.lat}, ${driverData.lng}] | Distance: ${dist.toFixed(2)} km`);

        // Check availability (Active and not in a ride)
        if (dist <= MAX_RADIUS_KM && dist < minDistance) {
            minDistance = dist;
            nearestDriver = { id: driverKey, ...driverData };
        }
    }

    if (!nearestDriver) {
        console.log("❌ Result: Drivers are online, but too far away.");
        return res.status(404).json({ message: "No drivers found nearby." });
    }

    console.log(`✅ MATCH FOUND: Driver ${nearestDriver.id} (${minDistance.toFixed(2)} km away)`);

    // 4. Create Booking in Database
    const otp = Math.floor(1000 + Math.random() * 9000);
    const fare = (minDistance * 2.5 + 10).toFixed(2); // Simple fare algorithm

    const sql = `INSERT INTO bookings (rider_id, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, fare, status, otp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`;
    
    pool.query(sql, [riderId, nearestDriver.id, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, otp], (err, result) => {
        if (err) {
            console.error("❌ Database Error:", err);
            return res.status(500).json({ error: "Database error" });
        }

        const bookingId = result.insertId;

        // 5. Notify Driver via Socket
        const io = req.app.get('socketio');
        if (nearestDriver.socketId) {
            console.log(`📡 Sending 'newRideRequest' to Socket ID: ${nearestDriver.socketId}`);
            io.to(nearestDriver.socketId).emit('newRideRequest', {
                bookingId,
                riderId,
                pickupLat,
                pickupLng,
                pickupAddress,
                dropAddress,
                fare,
                dist: minDistance.toFixed(1)
            });
        } else {
            console.log("⚠️ Warning: Matched driver has no socket ID.");
        }

        res.json({ message: "Driver found", bookingId, driverId: nearestDriver.id, otp });
    });
};

exports.acceptRide = async (req, res) => {
    const { bookingId, driverId } = req.body;
    const sql = `UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ?`;
    
    pool.query(sql, [driverId, bookingId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // Notify Rider
        const io = req.app.get('socketio');
        // Find Rider Socket (This would require tracking rider sockets in a real map)
        // For now, we broadcast or rely on client polling, OR use the activeRiders map
        // io.emit('rideAccepted', { bookingId, driverId }); // Simple broadcast for MVP
        
        // Better: Find rider from booking (Need to query DB or pass riderId)
        res.json({ message: "Ride Accepted" });
    });
};

exports.startRide = async (req, res) => {
    const { bookingId, otp } = req.body;
    
    // Verify OTP first
    pool.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({error: "Booking not found"});
        
        const booking = rows[0];
        if (String(booking.otp) !== String(otp)) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        // OTP Matches -> Start Ride
        pool.query(`UPDATE bookings SET status = 'ongoing', start_time = NOW() WHERE id = ?`, [bookingId], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const io = req.app.get('socketio');
            io.emit('rideStarted', { bookingId }); // Broadcast to room in real app
            res.json({ message: "Ride Started" });
        });
    });
};

exports.endRide = async (req, res) => {
    const { bookingId } = req.body;
    
    pool.query(`UPDATE bookings SET status = 'completed', end_time = NOW() WHERE id = ?`, [bookingId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Get Fare to send back
        pool.query(`SELECT fare FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
             const fare = rows[0]?.fare || 0;
             const io = req.app.get('socketio');
             io.emit('rideCompleted', { bookingId, fare });
             res.json({ message: "Ride Completed", fare });
        });
    });
};

exports.getHistory = async (req, res) => {
    // Assuming authMiddleware adds req.user
    const userId = req.user.id; 
    const role = req.user.role;
    
    let sql = '';
    if (role === 'driver') {
        sql = `SELECT * FROM bookings WHERE driver_id = ? ORDER BY created_at DESC`;
    } else {
        sql = `SELECT * FROM bookings WHERE rider_id = ? ORDER BY created_at DESC`;
    }

    pool.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// Helper function
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}