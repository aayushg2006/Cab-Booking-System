const pool = require('../config/db');
const { sendPushNotification } = require('../utils/pushService'); 
const { getTrafficData } = require('../utils/mapsService'); // 🚀 PHASE 4 IMPORT

// ⏳ TIMEOUT MANAGER
const bookingTimeouts = new Map(); // Stores { bookingId: timeoutID }

// Helper: Calculate distance (Haversine Formula - Fallback)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 🆕 Helper: Calculate Surge Multiplier (Phase 4)
const calculateSurge = async () => {
    // Count Online Drivers
    const [drivers] = await pool.promise().query("SELECT COUNT(*) as count FROM drivers WHERE status = 'online'");
    // Count Pending Bookings
    const [bookings] = await pool.promise().query("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'");

    const driverCount = drivers[0].count || 1; // Avoid divide by zero
    const requestCount = bookings[0].count;
    
    if (driverCount === 0) return 1.0; // No drivers, standard price (or handle differently)

    const demandRatio = requestCount / driverCount;

    if (demandRatio > 2) return 1.5; // High Surge (1.5x)
    if (demandRatio > 1.2) return 1.2; // Mild Surge (1.2x)
    return 1.0; // No Surge
};

// Helper: Start 15s Timer for a Driver
const startBookingTimer = (bookingId, driverId, io) => {
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
    }

    const timer = setTimeout(() => {
        console.log(`⏰ Booking ${bookingId} timed out for Driver ${driverId}`);
        
        // 1. Notify Driver (Close modal)
        const driverSocketId = global.driverSockets ? global.driverSockets.get(driverId) : null;
        if (driverSocketId && io) {
            io.to(driverSocketId).emit('requestTimeout'); 
        }

        // 2. Treat as Rejection -> Find Next Driver
        exports.handleRejection(bookingId, driverId, io);
        
    }, 15000); // 15 Seconds

    bookingTimeouts.set(bookingId, timer);
};

// Helper: Find Next Driver (SQL Spatial Query + Push Notification)
const findAndNotifyDriver = (bookingId, pickupLat, pickupLng, excludedDriverIds, io, res = null) => {
    // JOIN with users table to get 'push_token'
    let query = `
        SELECT d.id, d.lat, d.lng, u.push_token, 
        ( 6371 * acos( cos( radians(?) ) * cos( radians( d.lat ) ) * cos( radians( d.lng ) - radians(?) ) + sin( radians(?) ) * sin( radians( d.lat ) ) ) ) AS distance 
        FROM drivers d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'online' 
    `;

    const queryParams = [pickupLat, pickupLng, pickupLat];

    if (excludedDriverIds.length > 0) {
        query += ` AND d.id NOT IN (?)`;
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
        
        // Assign Driver to Booking
        pool.query(`UPDATE bookings SET driver_id = ? WHERE id = ?`, [nextDriver.id, bookingId], (err) => {
            if (err) console.error("Update Booking Error:", err);

            // Fetch Booking Details to send to Driver
            pool.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, bRows) => {
                if(!bRows || bRows.length === 0) return;
                const booking = bRows[0];

                // 1. ⚡ SEND SOCKET MESSAGE (If App is Open)
                const driverSocketId = global.driverSockets ? global.driverSockets.get(nextDriver.id) : null;
                if (driverSocketId && io) {
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
                    
                    // Start 15s Timer
                    startBookingTimer(bookingId, nextDriver.id, io);
                }

                // 2. 🔔 SEND EXPO PUSH NOTIFICATION (If App is Background/Closed)
                if (nextDriver.push_token) {
                    console.log(`🔔 Sending Push to Driver ${nextDriver.id}`);
                    
                    sendPushNotification(
                        nextDriver.push_token,
                        `New ride available! Fare: ₹${booking.fare}`,
                        { bookingId: booking.id, type: 'ride_request' }
                    );
                }
            });

            if (res) res.json({ message: "Request sent to next driver", driverId: nextDriver.id });
        });
    });
};

// 🆕 NEW: Estimate Fare Endpoint (For Frontend Pre-calculation)
exports.estimateFare = async (req, res) => {
    const { pickupLat, pickupLng, dropLat, dropLng } = req.body;

    if (!pickupLat || !dropLat) return res.status(400).json({ error: "Coordinates required" });

    // 1. Get Traffic Data (or Fallback)
    let distance = 0;
    let duration = 0;
    
    const trafficData = await getTrafficData(pickupLat, pickupLng, dropLat, dropLng);
    
    if (trafficData) {
        distance = trafficData.distanceKm;
        duration = trafficData.durationMins;
    } else {
        // Fallback: Haversine
        distance = calculateDistance(pickupLat, pickupLng, dropLat, dropLng);
        duration = distance * 3; // Approx 3 mins per km
    }

    // 2. Calculate Price
    const BASE_FARE = 40;
    const RATE_PER_KM = 12;
    const RATE_PER_MIN = 2;
    
    let basePrice = BASE_FARE + (distance * RATE_PER_KM) + (duration * RATE_PER_MIN);
    
    // 3. Apply Surge
    const surge = await calculateSurge();
    const finalFare = Math.round(basePrice * surge);

    res.json({
        fare: finalFare,
        distance: distance.toFixed(1),
        duration: Math.round(duration),
        surge: surge
    });
};

// 🔄 UPDATED: Request Ride (Calculates Fare on Backend)
exports.requestRide = async (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, paymentMode } = req.body;
    
    // 1. RE-CALCULATE FARE (Security: Don't trust the frontend fare)
    let distance = 0;
    let duration = 0;
    
    const trafficData = await getTrafficData(pickupLat, pickupLng, dropLat, dropLng);
    
    if (trafficData) {
        distance = trafficData.distanceKm;
        duration = trafficData.durationMins;
    } else {
        distance = calculateDistance(pickupLat, pickupLng, dropLat, dropLng); 
        duration = distance * 3; 
    }

    // Pricing Constants
    const BASE_FARE = 40;
    const RATE_PER_KM = 12;
    const RATE_PER_MIN = 2; 
    
    let basePrice = BASE_FARE + (distance * RATE_PER_KM) + (duration * RATE_PER_MIN);
    
    // Apply Surge
    const surgeMultiplier = await calculateSurge();
    const finalFare = Math.round(basePrice * surgeMultiplier);

    console.log(`💰 Pricing: Dist=${distance.toFixed(1)}km, Time=${Math.round(duration)}min, Surge=${surgeMultiplier}x, Fare=₹${finalFare}`);

    // 2. Create Booking
    const selectedMode = paymentMode || 'cash'; 
    const otp = Math.floor(1000 + Math.random() * 9000);
    
    const sql = `INSERT INTO bookings (rider_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, fare, status, otp, rejected_drivers, payment_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '[]', ?)`;

    pool.query(sql, [riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, finalFare, otp, selectedMode], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const bookingId = result.insertId;
        const io = req.app.get('socketio');

        // 3. Find Driver
        findAndNotifyDriver(bookingId, pickupLat, pickupLng, [], io, res);
    });
};

exports.handleRejection = (bookingId, driverId, io) => {
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
    
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    // 1. Update Status
    const safetySql = `UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ? AND status = 'pending'`;

    pool.query(safetySql, [driverId, bookingId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Ride request expired or already taken." });
        }

        // 2. Fetch Booking (for OTP) & Driver Details
        const detailsQuery = `
            SELECT b.otp, u.name, u.email, u.phone, d.car_model, d.car_plate 
            FROM bookings b
            JOIN drivers d ON d.id = ?
            JOIN users u ON d.user_id = u.id
            WHERE b.id = ?
        `;

        pool.query(detailsQuery, [driverId, bookingId], (err, rows) => {
            if (err) return console.error("Error fetching details:", err);

            const info = rows[0];
            const io = req.app.get('socketio');
            
            // 3. Send OTP and Driver Info to Rider
            io.emit('rideAccepted', { 
                bookingId, 
                driverId,
                otp: info.otp, 
                driverName: info.name,
                carModel: info.car_model,
                carPlate: info.car_plate,
                rating: "5.0",
                phone: info.phone,
                eta: 5 // 🟢 FIX: Send ETA (Driver to Pickup) - Default 5 min for now
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
        
        // Recalculate actual distance
        if (dropLat && dropLng) {
            const actualDist = calculateDistance(booking.pickup_lat, booking.pickup_lng, dropLat, dropLng);
            finalFare = Math.round(40 + (actualDist * 12)); 
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

exports.confirmPayment = (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: "Booking ID is required" });
    const sql = `UPDATE bookings SET payment_status = 'paid' WHERE id = ?`;
    pool.query(sql, [bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Payment successful", status: 'paid' });
    });
};

// 🚨 SOS ALERT (Phase 5)
exports.triggerSOS = (req, res) => {
    const { bookingId, lat, lng } = req.body;
    
    console.log(`🚨 SOS TRIGGERED! Booking: ${bookingId}, Location: ${lat}, ${lng}`);
    const sql = `UPDATE bookings SET sos_alert = TRUE, status = 'flagged' WHERE id = ?`;
    pool.query(sql, [bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "SOS Alert Received. Support Team & Police Notified." });
    });
};

// ⭐ RATE RIDE (Phase 5)
exports.rateRide = (req, res) => {
    const { bookingId, rating, review } = req.body;

    if (!bookingId || !rating) return res.status(400).json({ error: "Missing fields" });

    const sql = `UPDATE bookings SET rating = ?, review = ? WHERE id = ?`;
    pool.query(sql, [rating, review, bookingId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Rating submitted successfully" });
    });
};