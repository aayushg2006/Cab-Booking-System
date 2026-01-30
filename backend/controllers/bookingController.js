const pool = require('../config/db');

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

exports.requestRide = async (req, res) => {
    // 🛠 Receive carType and fare
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, carType } = req.body;

    if (!riderId || !pickupLat || !pickupLng) return res.status(400).json({ error: "Missing required fields" });
    if (!global.activeDrivers || global.activeDrivers.size === 0) return res.status(404).json({ message: "No drivers are currently online." });

    let nearestDriver = null;
    let minDistance = Infinity;
    const MAX_RADIUS_KM = 5000; 

    // 🕵️ FILTER BY CAR CATEGORY (Assuming we stored carType in driverData when they went online)
    // NOTE: For MVP, we allow any driver if carType logic isn't fully in DB yet, but ideally:
    // if (driverData.carType !== carType) continue;

    for (let [driverKey, driverData] of global.activeDrivers.entries()) {
        const dist = calculateDistance(pickupLat, pickupLng, driverData.lat, driverData.lng);
        
        // Simple optimization: Pick nearest
        if (dist <= MAX_RADIUS_KM && dist < minDistance) {
            minDistance = dist;
            nearestDriver = { id: driverKey, ...driverData };
        }
    }

    if (!nearestDriver) return res.status(404).json({ message: "No drivers found nearby." });

    const otp = Math.floor(1000 + Math.random() * 9000);
    
    const sql = `INSERT INTO bookings (rider_id, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, fare, status, otp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`;
    
    pool.query(sql, [riderId, nearestDriver.id, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, otp], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const bookingId = result.insertId;
        const io = req.app.get('socketio');
        
        if (nearestDriver.socketId) {
            io.to(nearestDriver.socketId).emit('newRideRequest', {
                bookingId,
                riderId,
                pickupLat,
                pickupLng,
                pickupAddress,
                dropAddress,
                fare: fare, // Send agreed fare
                dist: minDistance.toFixed(1)
            });
        }

        res.json({ message: "Driver found", bookingId, driverId: nearestDriver.id, otp, fare });
    });
};

exports.acceptRide = (req, res) => {
    const { bookingId, driverId } = req.body;
    pool.query(`UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ?`, [driverId, bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Safe Driver Query
        const driverQuery = `SELECT u.name, u.email, u.phone, d.car_model, d.car_plate FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = ?`;

        pool.query(driverQuery, [driverId], (err, rows) => {
            const driverInfo = rows && rows[0] ? rows[0] : { name: "Driver", car_model: "Car", car_plate: "", phone: "" };
            const io = req.app.get('socketio');
            
            io.emit('rideAccepted', { 
                bookingId, 
                driverId,
                driverName: driverInfo.name,
                carModel: driverInfo.car_model,
                carPlate: driverInfo.car_plate,
                rating: "5.0",
                phone: driverInfo.phone
            });
            res.json({ message: "Ride Accepted" });
        });
    });
};

exports.startRide = (req, res) => {
    const { bookingId, otp } = req.body;
    pool.query(`SELECT otp FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ error: "Booking not found" });
        if (String(rows[0].otp) !== String(otp)) return res.status(400).json({ error: "Invalid OTP" });
        
        pool.query(`UPDATE bookings SET status = 'ongoing', start_time = NOW() WHERE id = ?`, [bookingId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Try/Catch for Socket to prevent crash
            try {
                const io = req.app.get('socketio');
                if(io) io.emit('rideStarted', { bookingId });
            } catch(e) { console.error("Socket emit failed", e); }
            
            res.json({ message: "Ride Started" });
        });
    });
};

exports.endRide = (req, res) => {
    const { bookingId, dropLat, dropLng } = req.body;

    // 1. Get Pickup Coordinates to Calc Actual Distance
    pool.query(`SELECT pickup_lat, pickup_lng, fare FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return res.status(500).json({error: "Booking not found"});
        
        const booking = rows[0];
        let finalFare = booking.fare;

        // 💰 RECALCULATE FARE if new coords provided
        if (dropLat && dropLng) {
            const actualDist = calculateDistance(booking.pickup_lat, booking.pickup_lng, dropLat, dropLng);
            finalFare = Math.round(50 + (actualDist * 15)); // Base 50 + 15/km
        }

        // 2. Update DB
        pool.query(`UPDATE bookings SET status = 'completed', end_time = NOW(), fare = ? WHERE id = ?`, [finalFare, bookingId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            try {
                req.app.get('socketio').emit('rideCompleted', { bookingId, fare: finalFare });
            } catch(e) { console.error("Socket error", e); }
            
            res.json({ message: "Ride Completed", fare: finalFare });
        });
    });
};

exports.getHistory = (req, res) => {
    const userId = req.user.id; 
    const role = req.user.role;
    let sql = role === 'driver' ? `SELECT * FROM bookings WHERE driver_id = ?` : `SELECT * FROM bookings WHERE rider_id = ?`;
    pool.query(sql + ` ORDER BY created_at DESC`, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};