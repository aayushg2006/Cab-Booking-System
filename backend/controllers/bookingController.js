const pool = require('../config/db');

// --- HELPER FUNCTIONS ---
function getDistance(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) { return deg * (Math.PI / 180); }
function generateOTP() { return Math.floor(1000 + Math.random() * 9000).toString(); }

// --- FIND NEAREST DRIVER ---
function findNearestDriver(pickupLat, pickupLng, excludeDriverIds = []) {
    let nearestDriver = null;
    let minDistance = 50; // 50km radius

    if (!global.activeDrivers) return null;

    global.activeDrivers.forEach((driverData, driverId) => {
        if (excludeDriverIds.includes(driverId)) return; // Skip rejected drivers

        const dist = getDistance(pickupLat, pickupLng, driverData.lat, driverData.lng);
        if (dist < minDistance) {
            minDistance = dist;
            nearestDriver = { id: driverId, ...driverData };
        }
    });
    return nearestDriver;
}

// @route POST /api/bookings/request
exports.requestRide = async (req, res) => {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress } = req.body;
    
    // 1. Calc Fare (Base $2.50 + $1.5 per km)
    const dist = getDistance(pickupLat, pickupLng, dropLat, dropLng);
    const fare = (2.5 + (dist * 1.5)).toFixed(2);
    const otp = generateOTP();

    // 2. Find Driver
    const nearestDriver = findNearestDriver(pickupLat, pickupLng);

    if (!nearestDriver) {
        return res.status(404).json({ message: 'No drivers available nearby' });
    }

    try {
        // 3. Create Booking
        const query = `INSERT INTO bookings 
            (rider_id, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, status, fare, otp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`;
        
        const [result] = await pool.promise().query(query, [
            riderId, nearestDriver.id, pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress, fare, otp
        ]);

        // 4. Notify Driver
        const io = req.app.get('socketio');
        if (io) {
            io.to(nearestDriver.socketId).emit('newRideRequest', {
                bookingId: result.insertId,
                pickupAddress,
                fare,
                distance: dist.toFixed(1) + ' km'
            });
        }

        res.status(200).json({ 
            message: 'Driver found', 
            bookingId: result.insertId, 
            driverId: nearestDriver.id,
            otp: otp 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// @route POST /api/bookings/accept
exports.acceptRide = async (req, res) => {
    const { bookingId, driverId } = req.body;

    try {
        const [result] = await pool.promise().query(
            `UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ?`, 
            [driverId, bookingId]
        );

        if (result.affectedRows === 0) return res.status(404).json({ message: 'Booking not found' });

        // Get Rider ID
        const [rows] = await pool.promise().query('SELECT rider_id FROM bookings WHERE id = ?', [bookingId]);
        const riderId = rows[0].rider_id;

        // Notify Rider
        const io = req.app.get('socketio');
        const riderSocket = global.activeRiders ? global.activeRiders.get(riderId) : null;
        
        if (riderSocket) {
            io.to(riderSocket).emit('rideAccepted', {
                message: 'Driver is on the way!',
                driverId,
                bookingId
            });
        }
        res.status(200).json({ message: 'Ride Accepted' });

    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
};

// @route POST /api/bookings/reject
exports.rejectRide = async (req, res) => {
    const { bookingId, driverId } = req.body;

    try {
        const [bookings] = await pool.promise().query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found' });
        const booking = bookings[0];

        // Find NEXT driver (excluding current one)
        const nextDriver = findNearestDriver(booking.pickup_lat, booking.pickup_lng, [driverId]);

        const io = req.app.get('socketio');

        if (nextDriver) {
            // Assign to new driver
            await pool.promise().query('UPDATE bookings SET driver_id = ? WHERE id = ?', [nextDriver.id, bookingId]);
            
            io.to(nextDriver.socketId).emit('newRideRequest', {
                bookingId: booking.id,
                pickupAddress: booking.pickup_address,
                fare: booking.fare
            });
            res.json({ message: 'Request passed to next driver' });
        } else {
            // No drivers left
            await pool.promise().query('UPDATE bookings SET status = "cancelled" WHERE id = ?', [bookingId]);
            
            const riderSocket = global.activeRiders ? global.activeRiders.get(booking.rider_id) : null;
            if(riderSocket) io.to(riderSocket).emit('noDriversFound', { message: 'All drivers busy' });

            res.json({ message: 'No other drivers available' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @route POST /api/bookings/start
exports.startRide = async (req, res) => {
    const { bookingId, otp } = req.body;

    try {
        const [rows] = await pool.promise().query('SELECT otp, rider_id FROM bookings WHERE id = ?', [bookingId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

        if (rows[0].otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        await pool.promise().query("UPDATE bookings SET status = 'ongoing' WHERE id = ?", [bookingId]);

        const io = req.app.get('socketio');
        const riderSocket = global.activeRiders.get(rows[0].rider_id);
        if(riderSocket) io.to(riderSocket).emit('rideStarted', { message: 'Ride has started!' });

        res.json({ message: 'Ride Started Successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @route POST /api/bookings/end
exports.endRide = async (req, res) => {
    const { bookingId } = req.body;

    try {
        await pool.promise().query("UPDATE bookings SET status = 'completed', payment_status = 'paid' WHERE id = ?", [bookingId]);

        const [rows] = await pool.promise().query('SELECT rider_id, fare FROM bookings WHERE id = ?', [bookingId]);
        const { rider_id, fare } = rows[0];

        const io = req.app.get('socketio');
        const riderSocket = global.activeRiders.get(rider_id);
        if(riderSocket) io.to(riderSocket).emit('rideCompleted', { message: 'Ride Completed!', fare });

        res.json({ message: 'Ride Completed', fare });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @route GET /api/bookings/history
exports.getRideHistory = async (req, res) => {
    const userId = req.user.id; 
    try {
        const [userRows] = await pool.promise().query('SELECT role FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const role = userRows[0].role;
        let query, params;

        if (role === 'driver') {
            const [driverRows] = await pool.promise().query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
            if (driverRows.length === 0) return res.status(200).json([]);
            
            query = `SELECT * FROM bookings WHERE driver_id = ? ORDER BY created_at DESC`;
            params = [driverRows[0].id];
        } else {
            query = `SELECT * FROM bookings WHERE rider_id = ? ORDER BY created_at DESC`;
            params = [userId];
        }

        const [history] = await pool.promise().query(query, params);
        res.status(200).json(history);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
};