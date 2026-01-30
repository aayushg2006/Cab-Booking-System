// backend/controllers/bookingController.js
const pool = require('../config/db');

// ⏳ TIMEOUT MANAGER
const bookingTimeouts = new Map(); // Stores { bookingId: timeoutID }

// Helper: Calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 🆕 Helper: Start 15s Timer for a Driver
const startBookingTimer = (bookingId, driverId, io) => {
    // Clear existing if any
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
    }

    const timer = setTimeout(() => {
        console.log(`⏰ Booking ${bookingId} timed out for Driver ${driverId}`);
        
        // 1. Notify the Driver that they were too slow (Close their modal)
        const driverSocketId = global.driverSockets ? global.driverSockets.get(driverId) : null;
        if (driverSocketId && io) {
            io.to(driverSocketId).emit('requestTimeout'); 
        }

        // 2. Treat as Rejection -> Find Next Driver
        exports.handleRejection(bookingId, driverId, io);
        
    }, 15000); // ⏱️ 15 SECONDS

    bookingTimeouts.set(bookingId, timer);
};

// 🆕 Helper: Find Next Driver
const findAndNotifyDriver = (bookingId, pickupLat, pickupLng, excludedDriverIds, io, res = null) => {
    let query = `
        SELECT id, lat, lng, 
        ( 6371 * acos( cos( radians(?) ) * cos( radians( lat ) ) * cos( radians( lng ) - radians(?) ) + sin( radians(?) ) * sin( radians( lat ) ) ) ) AS distance 
        FROM drivers 
        WHERE status = 'online' 
    `;

    const queryParams = [pickupLat, pickupLng, pickupLat];

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
            console.log(`⚠️ No more drivers available for Booking ${bookingId}`);
            if (res) return res.status(404).json({ message: "No drivers available" });
            return;
        }

        const nextDriver = rows[0];
        
        // Update Booking with new Driver Candidate
        pool.query(`UPDATE bookings SET driver_id = ? WHERE id = ?`, [nextDriver.id, bookingId], (err) => {
            if (err) console.error("Update Booking Error:", err);

            // Notify Driver
            const driverSocketId = global.driverSockets ? global.driverSockets.get(nextDriver.id) : null;
            if (driverSocketId && io) {
                // Fetch extra details
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

                    // ⏳ START TIMER FOR THIS NEW DRIVER
                    startBookingTimer(bookingId, nextDriver.id, io);
                });
            }

            if (res) res.json({ message: "Request sent to next driver", driverId: nextDriver.id });
        });
    });
};

exports.requestRide = (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare } = req.body;
    
    const otp = Math.floor(1000 + Math.random() * 9000);
    const sql = `INSERT INTO bookings (rider_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, fare, status, otp, rejected_drivers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '[]')`;

    pool.query(sql, [riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, otp], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const bookingId = result.insertId;
        const io = req.app.get('socketio');

        findAndNotifyDriver(bookingId, pickupLat, pickupLng, [], io, res);
    });
};

exports.handleRejection = (bookingId, driverId, io) => {
    // 🛑 STOP TIMER if rejection was manual
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    pool.query(`SELECT rejected_drivers, pickup_lat, pickup_lng FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) return;

        const booking = rows[0];
        let rejectedList = booking.rejected_drivers || [];
        
        if (!rejectedList.includes(driverId)) {
            rejectedList.push(driverId);
        }

        pool.query(`UPDATE bookings SET rejected_drivers = ? WHERE id = ?`, [JSON.stringify(rejectedList), bookingId], (err) => {
            if (err) return;
            console.log(`🚫 Driver ${driverId} rejected/timed out. Finding next...`);
            findAndNotifyDriver(bookingId, booking.pickup_lat, booking.pickup_lng, rejectedList, io);
        });
    });
};

exports.acceptRide = (req, res) => {
    const { bookingId, driverId } = req.body;
    
    // 🛑 STOP TIMER
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    // 🔒 Security Check: Only accept if the booking is currently assigned to THIS driver
    // (Prevents a driver from accepting AFTER timeout)
    const safetySql = `UPDATE bookings SET status = 'accepted' WHERE id = ? AND driver_id = ? AND status = 'pending'`;

    pool.query(safetySql, [bookingId, driverId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Ride request expired or already taken." });
        }

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

exports.confirmPayment = (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: "Booking ID is required" });
    const sql = `UPDATE bookings SET payment_status = 'paid' WHERE id = ?`;
    pool.query(sql, [bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Payment successful", status: 'paid' });
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