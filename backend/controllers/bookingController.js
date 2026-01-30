const pool = require('../config/db');

// Helper: Calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

exports.confirmPayment = (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: "Booking ID is required" });
    const sql = `UPDATE bookings SET payment_status = 'paid' WHERE id = ?`;
    pool.query(sql, [bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Payment successful", status: 'paid' });
    });
};

// 🆕 Helper Function: Find Next Driver (Used by Request & Rejection)
const findAndNotifyDriver = (bookingId, pickupLat, pickupLng, excludedDriverIds, io, res = null) => {
    let query = `
        SELECT id, lat, lng, 
        ( 6371 * acos( cos( radians(?) ) * cos( radians( lat ) ) * cos( radians( lng ) - radians(?) ) + sin( radians(?) ) * sin( radians( lat ) ) ) ) AS distance 
        FROM drivers 
        WHERE status = 'online' 
    `;

    const queryParams = [pickupLat, pickupLng, pickupLat];

    // 🛡️ EXCLUDE rejected drivers
    if (excludedDriverIds.length > 0) {
        query += ` AND id NOT IN (?)`;
        queryParams.push(excludedDriverIds);
    }

    query += ` HAVING distance < 50 ORDER BY distance ASC LIMIT 1`;

    pool.query(query, queryParams, (err, rows) => {
        if (err) {
            console.error("Find Driver Error:", err);
            if (res) return res.status(500).json({ error: "Database error" });
            return;
        }

        if (rows.length === 0) {
            // No drivers left!
            if (res) return res.status(404).json({ message: "No drivers available" });
            
            // Notify Rider via Socket that search failed
            // (We'd need to fetch riderId to do this properly, but for now we log it)
            console.log(`⚠️ No more drivers available for Booking ${bookingId}`);
            return;
        }

        const nextDriver = rows[0];
        
        // Update Booking with new Driver Candidate
        pool.query(`UPDATE bookings SET driver_id = ? WHERE id = ?`, [nextDriver.id, bookingId], (err) => {
            if (err) console.error("Update Booking Error:", err);

            // Notify Driver
            const driverSocketId = global.driverSockets ? global.driverSockets.get(nextDriver.id) : null;
            if (driverSocketId && io) {
                // Fetch extra booking details if needed (simplified here)
                pool.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, bRows) => {
                    if(!bRows || bRows.length === 0) return;
                    const booking = bRows[0];
                    
                    io.to(driverSocketId).emit('newRideRequest', {
                        bookingId: booking.id,
                        riderId: booking.rider_id,
                        pickupLat: booking.pickup_lat,
                        pickupLng: booking.pickup_lng,
                        dropLat: booking.drop_lat,
                        dropLng: booking.drop_lng,
                        pickupAddress: booking.pickup_address,
                        dropAddress: booking.drop_address,
                        fare: booking.fare,
                        dist: nextDriver.distance.toFixed(1)
                    });
                });
            }

            if (res) res.json({ message: "Request sent to next driver", driverId: nextDriver.id });
        });
    });
};

exports.requestRide = (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare } = req.body;
    
    // 1. Create Booking FIRST (with empty rejected list)
    const otp = Math.floor(1000 + Math.random() * 9000);
    const sql = `INSERT INTO bookings (rider_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, fare, status, otp, rejected_drivers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '[]')`;

    pool.query(sql, [riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, otp], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const bookingId = result.insertId;
        const io = req.app.get('socketio');

        // 2. Find First Driver
        findAndNotifyDriver(bookingId, pickupLat, pickupLng, [], io, res);
    });
};

// 🆕 NEW: Handle Rejection
exports.handleRejection = (bookingId, driverId, io) => {
    // 1. Get current list of rejected drivers
    pool.query(`SELECT rejected_drivers, pickup_lat, pickup_lng FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return;

        const booking = rows[0];
        let rejectedList = booking.rejected_drivers || [];
        
        // Add current driver to reject list
        if (!rejectedList.includes(driverId)) {
            rejectedList.push(driverId);
        }

        // 2. Save updated list to DB
        pool.query(`UPDATE bookings SET rejected_drivers = ? WHERE id = ?`, [JSON.stringify(rejectedList), bookingId], (err) => {
            if (err) return;

            // 3. Find NEXT Driver
            console.log(`🚫 Driver ${driverId} declined. Finding next...`);
            findAndNotifyDriver(bookingId, booking.pickup_lat, booking.pickup_lng, rejectedList, io);
        });
    });
};

exports.acceptRide = (req, res) => {
    const { bookingId, driverId } = req.body;
    pool.query(`UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ?`, [driverId, bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Fetch Driver Details to send to Rider
        const driverQuery = `SELECT u.name, u.email, u.phone, d.car_model, d.car_plate FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = ?`;
        pool.query(driverQuery, [driverId], (err, rows) => {
            const driverInfo = rows && rows[0] ? rows[0] : {};
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
            try {
                const io = req.app.get('socketio');
                if(io) io.emit('rideStarted', { bookingId });
            } catch(e) { console.error("Socket error", e); }
            res.json({ message: "Ride Started" });
        });
    });
};

exports.endRide = (req, res) => {
    const { bookingId, dropLat, dropLng } = req.body;

    pool.query(`SELECT pickup_lat, pickup_lng, fare FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return res.status(500).json({error: "Booking not found"});
        
        const booking = rows[0];
        let finalFare = booking.fare;

        if (dropLat && dropLng) {
            const actualDist = calculateDistance(booking.pickup_lat, booking.pickup_lng, dropLat, dropLng);
            finalFare = Math.round(50 + (actualDist * 15)); 
        }

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

    if (role === 'driver') {
        pool.query(`SELECT id FROM drivers WHERE user_id = ?`, [userId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length === 0) return res.json([]); 

            const driverId = rows[0].id;
            pool.query(`SELECT * FROM bookings WHERE driver_id = ? ORDER BY created_at DESC`, [driverId], (err, results) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(results);
            });
        });
    } else {
        pool.query(`SELECT * FROM bookings WHERE rider_id = ? ORDER BY created_at DESC`, [userId], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    }
};