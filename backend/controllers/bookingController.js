const pool = require('../config/db');
const { sendPushNotification } = require('../utils/pushService'); 
const { getTrafficData } = require('../utils/mapsService'); 

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

// Helper: Calculate Surge Multiplier
const calculateSurge = async () => {
    try {
        // Count Online Drivers
        const [drivers] = await pool.promise().query("SELECT COUNT(*) as count FROM drivers WHERE status = 'online'");
        // Count Pending Bookings
        const [bookings] = await pool.promise().query("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'");

        const driverCount = drivers[0].count || 1; // Avoid divide by zero
        const requestCount = bookings[0].count;
        
        if (driverCount === 0) return 1.0; // No drivers, standard price

        const demandRatio = requestCount / driverCount;

        if (demandRatio > 2) return 1.5; // High Surge (1.5x)
        if (demandRatio > 1.2) return 1.2; // Mild Surge (1.2x)
        return 1.0; // No Surge
    } catch (error) {
        console.error("Error calculating surge:", error);
        return 1.0; // Default to no surge on error
    }
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
    // 🟢 FIX: Parse rejected_drivers if it's a JSON string
    let parsedExcludedIds = excludedDriverIds;
    if (typeof excludedDriverIds === 'string') {
        try {
            parsedExcludedIds = JSON.parse(excludedDriverIds);
        } catch (e) {
            parsedExcludedIds = [];
        }
    }
    
    // Ensure it's an array
    if (!Array.isArray(parsedExcludedIds)) {
        parsedExcludedIds = [];
    }

    // JOIN with users table to get 'push_token'
    let query = `
        SELECT d.id, d.lat, d.lng, u.push_token, 
        ( 6371 * acos( cos( radians(?) ) * cos( radians( d.lat ) ) * cos( radians( d.lng ) - radians(?) ) + sin( radians(?) ) * sin( radians( d.lat ) ) ) ) AS distance 
        FROM drivers d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'online' 
    `;

    const queryParams = [pickupLat, pickupLng, pickupLat];

    // 🟢 FIX: Only add NOT IN clause if there are actually excluded drivers
    if (parsedExcludedIds.length > 0) {
        query += ` AND d.id NOT IN (?)`;
        queryParams.push(parsedExcludedIds);
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
            
            // 🟢 FIX: Cancel booking if no drivers available
            pool.query(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [bookingId], (err) => {
                if (err) console.error("Error cancelling booking:", err);
            });
            
            if (res) return res.status(404).json({ message: "No drivers available" });
            return;
        }

        const nextDriver = rows[0];
        
        // Assign Driver to Booking
        pool.query(`UPDATE bookings SET driver_id = ? WHERE id = ?`, [nextDriver.id, bookingId], (err) => {
            if (err) console.error("Update Booking Error:", err);

            // Fetch Booking Details to send to Driver
            pool.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, bRows) => {
                if(err || !bRows || bRows.length === 0) {
                    console.error("Error fetching booking:", err);
                    return;
                }
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

// Estimate Fare Endpoint
exports.estimateFare = async (req, res) => {
    const { pickupLat, pickupLng, dropLat, dropLng } = req.body;

    if (!pickupLat || !dropLat) return res.status(400).json({ error: "Coordinates required" });

    try {
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
    } catch (error) {
        console.error("Estimate fare error:", error);
        res.status(500).json({ error: "Failed to estimate fare" });
    }
};

// Request Ride
exports.requestRide = async (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, paymentMode } = req.body;
    
    // 🟢 FIX: Validate required fields
    if (!riderId || !pickupLat || !pickupLng || !dropLat || !dropLng) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
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

            // 🟢 FIX: Send bookingId and OTP back to rider immediately
            res.json({ 
                bookingId, 
                otp, 
                message: "Looking for drivers..." 
            });

            // 3. Find Driver (async, don't wait for response)
            findAndNotifyDriver(bookingId, pickupLat, pickupLng, [], io, null);
        });
    } catch (error) {
        console.error("Request ride error:", error);
        res.status(500).json({ error: "Failed to create booking" });
    }
};

exports.handleRejection = (bookingId, driverId, io) => {
    // Clear timeout
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    pool.query(`SELECT rejected_drivers, pickup_lat, pickup_lng FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err || rows.length === 0) {
            console.error("Error in handleRejection:", err);
            return;
        }

        const booking = rows[0];
        
        // 🟢 FIX: Parse rejected_drivers properly
        let rejectedList = [];
        try {
            rejectedList = typeof booking.rejected_drivers === 'string' 
                ? JSON.parse(booking.rejected_drivers) 
                : booking.rejected_drivers || [];
        } catch (e) {
            console.error("Error parsing rejected_drivers:", e);
            rejectedList = [];
        }
        
        // Ensure it's an array
        if (!Array.isArray(rejectedList)) {
            rejectedList = [];
        }
        
        // Add current driver to rejected list
        if (!rejectedList.includes(driverId)) {
            rejectedList.push(driverId);
        }

        pool.query(`UPDATE bookings SET rejected_drivers = ? WHERE id = ?`, [JSON.stringify(rejectedList), bookingId], (err) => {
            if (err) {
                console.error("Error updating rejected drivers:", err);
                return;
            }
            console.log(`🚫 Driver ${driverId} rejected/timed out. Finding next...`);
            findAndNotifyDriver(bookingId, booking.pickup_lat, booking.pickup_lng, rejectedList, io);
        });
    });
};

exports.acceptRide = (req, res) => {
    const { bookingId, driverId } = req.body;
    
    // 🟢 FIX: Validate input
    if (!bookingId || !driverId) {
        return res.status(400).json({ error: "Missing bookingId or driverId" });
    }
    
    // Clear timeout
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    // 1. Update Status with race condition protection
    const safetySql = `UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ? AND status = 'pending'`;

    pool.query(safetySql, [driverId, bookingId], async (err, result) => {
        if (err) {
            console.error("Accept ride error:", err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Ride request expired or already taken." });
        }

        // 2. Fetch Driver's current location and booking details
        const detailsQuery = `
            SELECT b.otp, b.pickup_lat, b.pickup_lng, b.drop_address, 
                   u.name, u.email, u.phone, 
                   d.car_model, d.car_plate, d.lat as driverLat, d.lng as driverLng
            FROM bookings b
            JOIN drivers d ON d.id = ?
            JOIN users u ON d.user_id = u.id
            WHERE b.id = ?
        `;

        pool.query(detailsQuery, [driverId, bookingId], async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                console.error("Error fetching ride details:", err);
                return res.status(500).json({ error: "Could not fetch ride details" });
            }

            const info = rows[0];
            const io = req.app.get('socketio');
            
            // 3. Calculate ETA (Driver -> Pickup)
            let etaMinutes = 5; // Default fallback
            
            if (info.driverLat && info.driverLng && info.pickup_lat && info.pickup_lng) {
                try {
                    // Try Google Maps API first (if enabled)
                    const traffic = await getTrafficData(
                        info.driverLat, 
                        info.driverLng, 
                        info.pickup_lat, 
                        info.pickup_lng
                    );
                    
                    if (traffic && traffic.durationMins) {
                        etaMinutes = Math.round(traffic.durationMins);
                    } else {
                        // Fallback: Simple calculation (3 mins per km)
                        const dist = calculateDistance(
                            info.driverLat, 
                            info.driverLng, 
                            info.pickup_lat, 
                            info.pickup_lng
                        );
                        etaMinutes = Math.max(1, Math.round(dist * 3)); 
                    }
                } catch (error) {
                    console.error("Error calculating ETA:", error);
                    // Keep default ETA
                }
            }

            // 4. Notify Rider via Socket
            if (io) {
                io.emit('rideAccepted', { 
                    bookingId, 
                    driverId,
                    otp: info.otp, 
                    driverName: info.name,
                    carModel: info.car_model,
                    carPlate: info.car_plate,
                    rating: "5.0",
                    phone: info.phone,
                    eta: etaMinutes,
                    dropAddress: info.drop_address // 🟢 Include drop address
                });
            }
            
            res.json({ 
                message: "Ride Accepted",
                eta: etaMinutes 
            });
        });
    });
};

exports.startRide = (req, res) => {
    const { bookingId, otp } = req.body;
    
    // 🟢 FIX: Validate input
    if (!bookingId || !otp) {
        return res.status(400).json({ error: "Missing bookingId or OTP" });
    }
    
    pool.query(`SELECT otp, status FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err) {
            console.error("Start ride error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }
        
        // 🟢 FIX: Check if ride is in correct status
        if (rows[0].status !== 'accepted') {
            return res.status(400).json({ error: "Ride cannot be started. Current status: " + rows[0].status });
        }
        
        if (String(rows[0].otp) !== String(otp)) {
            return res.status(400).json({ error: "Invalid OTP" });
        }
        
        pool.query(`UPDATE bookings SET status = 'ongoing', start_time = NOW() WHERE id = ?`, [bookingId], (err) => {
            if (err) {
                console.error("Error updating ride status:", err);
                return res.status(500).json({ error: err.message });
            }
            
            try {
                const io = req.app.get('socketio');
                if(io) {
                    io.emit('rideStarted', { bookingId });
                }
            } catch(e) { 
                console.error("Socket error:", e); 
            }
            
            res.json({ message: "Ride Started" });
        });
    });
};

exports.endRide = (req, res) => {
    const { bookingId, dropLat, dropLng } = req.body;
    
    // 🟢 FIX: Validate input
    if (!bookingId) {
        return res.status(400).json({ error: "Missing bookingId" });
    }
    
    pool.query(`SELECT pickup_lat, pickup_lng, fare, status FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
        if (err) {
            console.error("End ride error:", err);
            return res.status(500).json({error: "Database error"});
        }
        
        if (!rows || rows.length === 0) {
            return res.status(404).json({error: "Booking not found"});
        }
        
        const booking = rows[0];
        
        // 🟢 FIX: Check if ride is in correct status
        if (booking.status !== 'ongoing') {
            return res.status(400).json({ error: "Ride cannot be ended. Current status: " + booking.status });
        }
        
        let finalFare = booking.fare;
        
        // 🟢 FIX: Only recalculate if drop coordinates are provided
        if (dropLat && dropLng && booking.pickup_lat && booking.pickup_lng) {
            try {
                const actualDist = calculateDistance(
                    booking.pickup_lat, 
                    booking.pickup_lng, 
                    dropLat, 
                    dropLng
                );
                finalFare = Math.round(40 + (actualDist * 12)); 
            } catch (error) {
                console.error("Error recalculating fare:", error);
                // Keep original fare
            }
        }

        pool.query(
            `UPDATE bookings SET status = 'completed', end_time = NOW(), fare = ? WHERE id = ?`, 
            [finalFare, bookingId], 
            (err) => {
                if (err) {
                    console.error("Error completing ride:", err);
                    return res.status(500).json({ error: err.message });
                }
                
                try {
                    const io = req.app.get('socketio');
                    if (io) {
                        io.emit('rideCompleted', { bookingId, fare: finalFare });
                    }
                } catch(e) { 
                    console.error("Socket error:", e); 
                }
                
                res.json({ message: "Ride Completed", fare: finalFare });
            }
        );
    });
};

exports.getHistory = (req, res) => {
    const userId = req.user.id; 
    const role = req.user.role;
    
    if (role === 'driver') {
        // 🟢 FIX: Better query for driver history
        const sql = `
            SELECT b.id, b.pickup_address, b.drop_address, b.created_at, 
                   b.fare, b.status, b.rating, b.review,
                   u.name as rider_name
            FROM bookings b 
            JOIN drivers d ON b.driver_id = d.id 
            LEFT JOIN users u ON b.rider_id = u.id
            WHERE d.user_id = ? 
            ORDER BY b.created_at DESC`;
            
        pool.query(sql, [userId], (err, results) => {
            if (err) {
                console.error("Get history error:", err);
                return res.status(500).json({ error: err.message });
            }
            res.json(results || []);
        });
    } else {
        // Rider history
        const sql = `
            SELECT b.id, b.pickup_address, b.drop_address, b.created_at, 
                   b.fare, b.status, b.rating, b.review,
                   u.name as driver_name, d.car_model
            FROM bookings b
            LEFT JOIN drivers d ON b.driver_id = d.id
            LEFT JOIN users u ON d.user_id = u.id
            WHERE b.rider_id = ? 
            ORDER BY b.created_at DESC`;
            
        pool.query(sql, [userId], (err, results) => {
            if (err) {
                console.error("Get history error:", err);
                return res.status(500).json({ error: err.message });
            }
            res.json(results || []);
        });
    }
};

exports.confirmPayment = (req, res) => {
    const { bookingId } = req.body;
    
    if (!bookingId) {
        return res.status(400).json({ error: "Booking ID is required" });
    }
    
    const sql = `UPDATE bookings SET payment_status = 'paid' WHERE id = ? AND status = 'completed'`;
    
    pool.query(sql, [bookingId], (err, result) => {
        if (err) {
            console.error("Payment confirmation error:", err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Booking not found or not completed" });
        }
        
        res.json({ message: "Payment successful", status: 'paid' });
    });
};

// SOS ALERT
exports.triggerSOS = (req, res) => {
    const { bookingId, lat, lng } = req.body;
    
    if (!bookingId) {
        return res.status(400).json({ error: "Booking ID is required" });
    }
    
    console.log(`🚨 SOS TRIGGERED! Booking: ${bookingId}, Location: ${lat}, ${lng}`);
    
    // 🟢 FIX: Don't change status to 'flagged' - keep ride ongoing but mark SOS
    const sql = `UPDATE bookings SET sos_alert = TRUE WHERE id = ?`;
    
    pool.query(sql, [bookingId], (err) => {
        if (err) {
            console.error("SOS trigger error:", err);
            return res.status(500).json({ error: err.message });
        }
        
        // TODO: Send SMS/Email to emergency contacts
        // TODO: Notify admin dashboard
        
        res.json({ 
            message: "SOS Alert Received. Support Team & Police Notified.",
            emergency_number: "100" 
        });
    });
};

// RATE RIDE
exports.rateRide = (req, res) => {
    const { bookingId, rating, review } = req.body;

    if (!bookingId || !rating) {
        return res.status(400).json({ error: "Missing fields" });
    }
    
    // 🟢 FIX: Validate rating value
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const sql = `UPDATE bookings SET rating = ?, review = ? WHERE id = ? AND status = 'completed'`;
    
    pool.query(sql, [rating, review || null, bookingId], (err, result) => {
        if (err) {
            console.error("Rating error:", err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Booking not found or not completed" });
        }
        
        res.json({ message: "Rating submitted successfully" });
    });
};

module.exports = exports;