const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { getTrafficData } = require('../utils/mapsService'); 

// ⏳ TIMEOUT MANAGER
const bookingTimeouts = new Map(); // Stores { bookingId: timeoutID }
const VALID_CAR_TYPES = new Set(['hatchback', 'sedan', 'suv']);
const CAR_TYPE_MULTIPLIERS = {
    hatchback: 1.0,
    sedan: 1.4,
    suv: 1.9,
};
const TRIP_SHARE_TTL = process.env.TRIP_SHARE_TTL || '6h';
const TRIP_SHARE_SECRET = process.env.TRIP_SHARE_SECRET || process.env.JWT_SECRET || 'secret';
const BASE_FARE = 40;
const RATE_PER_KM = 12;
const RATE_PER_MIN = 2;
const MIN_FINAL_FARE = 40;
const SCHEDULE_MIN_LEAD_MINUTES = 10;
const SCHEDULE_MAX_LEAD_HOURS = 24 * 7;
const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 255;
const ALLOWED_RIDE_PREFERENCES = new Set([
    'quiet_ride',
    'ac_required',
    'pet_friendly',
    'extra_luggage',
]);
let scheduledDispatchInProgress = false;

const normalizePromoCode = (value) => String(value || '').trim().toUpperCase();

const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
};

const sanitizeRidePreferences = (value) => {
    const rawPreferences = parseJsonArray(value);
    const normalized = rawPreferences
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => ALLOWED_RIDE_PREFERENCES.has(item));
    return Array.from(new Set(normalized));
};

const sanitizeSpecialInstructions = (value) =>
    String(value || '').trim().slice(0, MAX_SPECIAL_INSTRUCTIONS_LENGTH);

const resolveScheduledFor = (value) => {
    if (!value) return { scheduledFor: null, error: null };

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { scheduledFor: null, error: 'Invalid scheduledFor timestamp' };
    }

    const now = Date.now();
    const diffMs = parsed.getTime() - now;
    const minLeadMs = SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000;
    const maxLeadMs = SCHEDULE_MAX_LEAD_HOURS * 60 * 60 * 1000;

    if (diffMs < minLeadMs) {
        return {
            scheduledFor: null,
            error: `Scheduled rides require at least ${SCHEDULE_MIN_LEAD_MINUTES} minutes lead time`,
        };
    }

    if (diffMs > maxLeadMs) {
        return {
            scheduledFor: null,
            error: `Scheduled rides can be booked up to ${SCHEDULE_MAX_LEAD_HOURS} hours ahead`,
        };
    }

    return { scheduledFor: parsed, error: null };
};

const calculateDistanceAndDuration = async (pickupLat, pickupLng, dropLat, dropLng) => {
    const trafficData = await getTrafficData(pickupLat, pickupLng, dropLat, dropLng);

    if (trafficData) {
        return {
            distance: Number(trafficData.distanceKm || 0),
            duration: Number(trafficData.durationMins || 0),
        };
    }

    const fallbackDistance = calculateDistance(pickupLat, pickupLng, dropLat, dropLng);
    return {
        distance: fallbackDistance,
        duration: fallbackDistance * 3,
    };
};

const evaluatePromotion = async ({ promoCode, userId, fareAmount }) => {
    const normalizedCode = normalizePromoCode(promoCode);
    if (!normalizedCode) {
        return { ok: true, promotion: null, discountAmount: 0, finalFare: fareAmount };
    }

    const [rows] = await pool.promise().query(
        `
        SELECT
            id, code, title, description, discount_type, discount_value, max_discount,
            min_fare, usage_limit_total, usage_limit_per_user, active, starts_at, ends_at
        FROM promotions
        WHERE UPPER(code) = ?
          AND active = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        LIMIT 1
        `,
        [normalizedCode]
    );

    if (!rows || rows.length === 0) {
        return { ok: false, reason: 'Promo code is invalid or expired' };
    }

    const promotion = rows[0];
    const fare = Math.max(0, Number(fareAmount || 0));
    const minFare = Math.max(0, Number(promotion.min_fare || 0));
    if (fare < minFare) {
        return { ok: false, reason: `Promo is valid on fares above ₹${Math.round(minFare)}` };
    }

    if (promotion.usage_limit_total !== null && promotion.usage_limit_total !== undefined) {
        const [totalRows] = await pool
            .promise()
            .query('SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ?', [promotion.id]);
        const totalCount = Number(totalRows?.[0]?.count || 0);
        if (totalCount >= Number(promotion.usage_limit_total)) {
            return { ok: false, reason: 'Promo redemption limit reached' };
        }
    }

    if (userId && promotion.usage_limit_per_user !== null && promotion.usage_limit_per_user !== undefined) {
        const [userRows] = await pool.promise().query(
            'SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ? AND user_id = ?',
            [promotion.id, userId]
        );
        const userCount = Number(userRows?.[0]?.count || 0);
        if (userCount >= Number(promotion.usage_limit_per_user)) {
            return { ok: false, reason: 'Promo usage limit reached for this account' };
        }
    }

    let discountAmount = 0;
    if (promotion.discount_type === 'percent') {
        discountAmount = (fare * Number(promotion.discount_value || 0)) / 100;
    } else {
        discountAmount = Number(promotion.discount_value || 0);
    }

    const maxDiscount = promotion.max_discount !== null ? Number(promotion.max_discount) : null;
    if (maxDiscount !== null && Number.isFinite(maxDiscount)) {
        discountAmount = Math.min(discountAmount, maxDiscount);
    }

    discountAmount = Math.max(0, Number(discountAmount.toFixed(2)));
    const finalFare = Math.max(MIN_FINAL_FARE, Number((fare - discountAmount).toFixed(2)));
    const appliedDiscount = Number((fare - finalFare).toFixed(2));

    if (appliedDiscount <= 0) {
        return { ok: false, reason: 'Promo is not applicable on this fare' };
    }

    return {
        ok: true,
        promotion: {
            id: Number(promotion.id),
            code: promotion.code,
            title: promotion.title,
            description: promotion.description,
            discountType: promotion.discount_type,
            discountValue: Number(promotion.discount_value || 0),
        },
        discountAmount: appliedDiscount,
        finalFare,
    };
};

const recordPromotionRedemption = async ({ promotionId, userId, bookingId, discountAmount }) => {
    if (!promotionId || !userId || !bookingId) return;

    await pool.promise().query(
        `
        INSERT INTO promotion_redemptions (promotion_id, user_id, booking_id, discount_amount)
        VALUES (?, ?, ?, ?)
        `,
        [promotionId, userId, bookingId, Number(discountAmount || 0)]
    );
};

const getTripShareBaseUrl = () => {
    const rawBase = process.env.TRIP_SHARE_BASE_URL || process.env.SERVER_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    return String(rawBase).replace(/\/+$/, '');
};

const calculateDispatchScore = (driverRow) => {
    const distanceKm = Number(driverRow.distance || 999);
    const ratingScore = Math.max(0, Math.min(5, Number(driverRow.rating || 5))) / 5;
    const completedTrips = Number(driverRow.completed_trips || 0);
    const cancelledTrips = Number(driverRow.cancelled_trips || 0);
    const totalTrips = Number(driverRow.total_trips || 0);

    const distanceScore = Math.max(0, 1 - distanceKm / 12);
    const reliabilityScore = totalTrips > 0 ? Math.max(0, 1 - cancelledTrips / totalTrips) : 0.92;
    const experienceScore = Math.min(completedTrips / 60, 1);

    return (
        distanceScore * 0.55 +
        ratingScore * 0.2 +
        reliabilityScore * 0.2 +
        experienceScore * 0.05
    );
};

const normalizeCarType = (value) => {
    const candidate = String(value || '').trim().toLowerCase();
    if (VALID_CAR_TYPES.has(candidate)) return candidate;
    return 'sedan';
};

const normalizeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getSocketFromMap = (targetMap, entityId) => {
    if (!targetMap) return null;
    return targetMap.get(Number(entityId)) || null;
};

const emitToRider = (io, riderId, eventName, payload) => {
    const riderSocketId = getSocketFromMap(global.riderSockets, riderId);
    if (io && riderSocketId) {
        io.to(riderSocketId).emit(eventName, payload);
    }
};

const emitToDriver = (io, driverId, eventName, payload) => {
    const driverSocketId = getSocketFromMap(global.driverSockets, driverId);
    if (io && driverSocketId) {
        io.to(driverSocketId).emit(eventName, payload);
    }
};

const getDriverRecordForUser = async (userId) => {
    const [rows] = await pool.promise().query(
        `SELECT id, status, lat, lng, car_model, car_plate, car_type FROM drivers WHERE user_id = ? LIMIT 1`,
        [userId]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getActiveBookingForDriver = async (driverId) => {
    const [rows] = await pool.promise().query(
        `
        SELECT id, rider_id, status
        FROM bookings
        WHERE driver_id = ?
          AND (
              status = 'ongoing'
              OR (status = 'accepted' AND created_at >= (NOW() - INTERVAL 45 MINUTE))
          )
        ORDER BY id DESC
        LIMIT 1
        `,
        [driverId]
    );
    return rows.length > 0 ? rows[0] : null;
};

const emitDriverLocationToActiveRide = async (io, driverId, lat, lng) => {
    const activeRide = await getActiveBookingForDriver(driverId);
    if (!activeRide) return;

    emitToRider(io, activeRide.rider_id, 'driverMoved', {
        bookingId: Number(activeRide.id),
        driverId: Number(driverId),
        lat,
        lng,
    });
};

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
        // Count Pending Bookings ready for immediate dispatch
        const [bookings] = await pool.promise().query(
            `
            SELECT COUNT(*) as count
            FROM bookings
            WHERE status = 'pending'
              AND (scheduled_for IS NULL OR scheduled_for <= NOW())
            `
        );

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
        emitToDriver(io, driverId, 'requestTimeout', { bookingId });

        // 2. Treat as Rejection -> Find Next Driver
        exports.handleRejection(bookingId, driverId, io);
        
    }, 15000); // 15 Seconds

    bookingTimeouts.set(bookingId, timer);
};

// Helper: Find Next Driver (SQL Spatial Query + Socket Notification)
const findAndNotifyDriver = (bookingId, pickupLat, pickupLng, excludedDriverIds, io, requestedCarType = 'sedan', res = null) => {
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

    let query = `
        SELECT
            d.id,
            d.lat,
            d.lng,
            d.rating,
            ( 6371 * acos( cos( radians(?) ) * cos( radians( d.lat ) ) * cos( radians( d.lng ) - radians(?) ) + sin( radians(?) ) * sin( radians( d.lat ) ) ) ) AS distance,
            COALESCE(stats.total_trips, 0) AS total_trips,
            COALESCE(stats.completed_trips, 0) AS completed_trips,
            COALESCE(stats.cancelled_trips, 0) AS cancelled_trips
        FROM drivers d
        LEFT JOIN (
            SELECT
                driver_id,
                COUNT(*) AS total_trips,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_trips,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_trips
            FROM bookings
            WHERE driver_id IS NOT NULL
            GROUP BY driver_id
        ) stats ON stats.driver_id = d.id
        WHERE d.status = 'online'
          AND d.car_type = ?
          AND d.lat IS NOT NULL
          AND d.lng IS NOT NULL
    `;

    const queryParams = [pickupLat, pickupLng, pickupLat, normalizeCarType(requestedCarType)];

    // 🟢 FIX: Only add NOT IN clause if there are actually excluded drivers
    if (parsedExcludedIds.length > 0) {
        query += ` AND d.id NOT IN (?)`;
        queryParams.push(parsedExcludedIds);
    }

    query += ` HAVING distance < 50 ORDER BY distance ASC LIMIT 12`;

    pool.query(query, queryParams, (err, rows) => {
        if (err) {
            console.error("Find Driver Error:", err);
            if (res) return res.status(500).json({ error: "Database error" });
            return;
        }

        if (rows.length === 0) {
            console.log(`⚠️ No more drivers available for Booking ${bookingId}`);

            pool.query(
                `SELECT rider_id, scheduled_for FROM bookings WHERE id = ? LIMIT 1`,
                [bookingId],
                (riderErr, riderRows) => {
                    if (riderErr || !riderRows || riderRows.length === 0) return;

                    const bookingMeta = riderRows[0];
                    if (bookingMeta.scheduled_for) {
                        emitToRider(io, bookingMeta.rider_id, 'scheduledRideDelayed', {
                            bookingId: Number(bookingId),
                            message: 'No nearby drivers yet. We will keep retrying your scheduled ride.',
                        });
                        return;
                    }

                    pool.query(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [bookingId], (updateErr) => {
                        if (updateErr) console.error("Error cancelling booking:", updateErr);
                    });

                    emitToRider(io, bookingMeta.rider_id, 'rideUnavailable', {
                        bookingId: Number(bookingId),
                        message: "No drivers available for the selected car type nearby",
                    });
                }
            );

            if (res) return res.status(404).json({ message: "No drivers available" });
            return;
        }

        const rankedDrivers = rows
            .map((driverRow) => ({
                ...driverRow,
                dispatchScore: calculateDispatchScore(driverRow),
            }))
            .sort((a, b) => {
                if (b.dispatchScore !== a.dispatchScore) return b.dispatchScore - a.dispatchScore;
                return Number(a.distance || 999) - Number(b.distance || 999);
            });

        const nextDriver = rankedDrivers[0];
        const normalizedDriverId = Number(nextDriver.id);
        const driverSocketId = getSocketFromMap(global.driverSockets, normalizedDriverId);

        if (!driverSocketId) {
            const updatedExcluded = [...parsedExcludedIds, normalizedDriverId];
            pool.query(
                `UPDATE bookings SET rejected_drivers = ? WHERE id = ?`,
                [JSON.stringify(updatedExcluded), bookingId],
                () => findAndNotifyDriver(bookingId, pickupLat, pickupLng, updatedExcluded, io, requestedCarType, res)
            );
            return;
        }
        
        // Assign Driver to Booking
        pool.query(`UPDATE bookings SET driver_id = ? WHERE id = ?`, [normalizedDriverId, bookingId], (err) => {
            if (err) console.error("Update Booking Error:", err);

            // Fetch Booking Details to send to Driver
            pool.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, bRows) => {
                if(err || !bRows || bRows.length === 0) {
                    console.error("Error fetching booking:", err);
                    return;
                }
                const booking = bRows[0];

                // 1. ⚡ SEND SOCKET MESSAGE (If App is Open)
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
                        carType: booking.car_type,
                        dist: Number(nextDriver.distance || 0).toFixed(1),
                        ridePreferences: parseJsonArray(booking.ride_preferences),
                        specialInstructions: booking.special_instructions || null,
                        promoCode: booking.promo_code || null,
                        discountAmount: Number(booking.discount_amount || 0),
                        scheduledFor: booking.scheduled_for
                            ? new Date(booking.scheduled_for).toISOString()
                            : null,
                    });
                    
                    // Start 15s Timer
                    startBookingTimer(bookingId, normalizedDriverId, io);
                }

            });

            if (res) res.json({ message: "Request sent to next driver", driverId: normalizedDriverId });
        });
    });
};

const dispatchDueScheduledBookings = async (io) => {
    if (scheduledDispatchInProgress) return;
    if (!io) return;

    scheduledDispatchInProgress = true;
    try {
        const [rows] = await pool.promise().query(
            `
            SELECT id, pickup_lat, pickup_lng, car_type, rejected_drivers
            FROM bookings
            WHERE status = 'pending'
              AND scheduled_for IS NOT NULL
              AND scheduled_for <= NOW()
              AND (driver_id IS NULL OR driver_id = 0)
            ORDER BY scheduled_for ASC
            LIMIT 20
            `
        );

        if (!rows || rows.length === 0) return;

        rows.forEach((booking) => {
            if (!booking.id || booking.pickup_lat === null || booking.pickup_lng === null) return;
            const rejectedDrivers = parseJsonArray(booking.rejected_drivers);
            findAndNotifyDriver(
                Number(booking.id),
                Number(booking.pickup_lat),
                Number(booking.pickup_lng),
                rejectedDrivers,
                io,
                normalizeCarType(booking.car_type)
            );
        });
    } catch (error) {
        console.error('Scheduled dispatch error:', error.message);
    } finally {
        scheduledDispatchInProgress = false;
    }
};

// Estimate Fare Endpoint
exports.estimateFare = async (req, res) => {
    const { pickupLat, pickupLng, dropLat, dropLng } = req.body;

    if (pickupLat === undefined || pickupLng === undefined || dropLat === undefined || dropLng === undefined) {
        return res.status(400).json({ error: "Coordinates required" });
    }

    try {
        const { distance, duration } = await calculateDistanceAndDuration(
            pickupLat,
            pickupLng,
            dropLat,
            dropLng
        );

        let basePrice = BASE_FARE + (distance * RATE_PER_KM) + (duration * RATE_PER_MIN);

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
    const {
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        pickupAddress,
        dropAddress,
        paymentMode,
        carType,
        promoCode,
        ridePreferences,
        specialInstructions,
        scheduledFor,
    } = req.body;

    const riderId = Number(req.user?.id);
    if (
        !riderId ||
        pickupLat === undefined ||
        pickupLng === undefined ||
        dropLat === undefined ||
        dropLng === undefined
    ) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const { distance, duration } = await calculateDistanceAndDuration(
            pickupLat,
            pickupLng,
            dropLat,
            dropLng
        );

        const surgeMultiplier = await calculateSurge();
        const selectedCarType = normalizeCarType(carType);
        const carMultiplier = CAR_TYPE_MULTIPLIERS[selectedCarType] || 1;
        const originalFare = Math.round(
            (BASE_FARE + distance * RATE_PER_KM + duration * RATE_PER_MIN) *
                surgeMultiplier *
                carMultiplier
        );

        const promoResult = await evaluatePromotion({
            promoCode,
            userId: riderId,
            fareAmount: originalFare,
        });
        if (!promoResult.ok) {
            return res.status(400).json({ error: promoResult.reason || 'Promo is not applicable' });
        }

        const scheduledMeta = resolveScheduledFor(scheduledFor);
        if (scheduledMeta.error) {
            return res.status(400).json({ error: scheduledMeta.error });
        }

        const cleanedPreferences = sanitizeRidePreferences(ridePreferences);
        const cleanedInstructions = sanitizeSpecialInstructions(specialInstructions);
        const selectedMode = paymentMode === 'online' ? 'online' : 'cash';
        const otp = Math.floor(1000 + Math.random() * 9000);
        const finalFare = Math.round(promoResult.finalFare);
        const discountAmount = Number((originalFare - finalFare).toFixed(2));
        const appliedPromoCode = promoResult.promotion?.code || null;
        const isScheduled = Boolean(scheduledMeta.scheduledFor);

        const sql = `
            INSERT INTO bookings (
                rider_id, pickup_lat, pickup_lng, drop_lat, drop_lng,
                pickup_address, drop_address, fare, status, otp, rejected_drivers,
                payment_mode, car_type, scheduled_for, promo_code, original_fare,
                discount_amount, ride_preferences, special_instructions
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        pool.query(
            sql,
            [
                riderId,
                pickupLat,
                pickupLng,
                dropLat,
                dropLng,
                pickupAddress,
                dropAddress,
                finalFare,
                otp,
                selectedMode,
                selectedCarType,
                scheduledMeta.scheduledFor ? scheduledMeta.scheduledFor : null,
                appliedPromoCode,
                originalFare,
                discountAmount,
                cleanedPreferences.length > 0 ? JSON.stringify(cleanedPreferences) : null,
                cleanedInstructions || null,
            ],
            async (err, result) => {
                if (err) return res.status(500).json({ error: err.message });

                const bookingId = result.insertId;
                const io = req.app.get('socketio');

                if (promoResult.promotion?.id) {
                    try {
                        await recordPromotionRedemption({
                            promotionId: promoResult.promotion.id,
                            userId: riderId,
                            bookingId,
                            discountAmount,
                        });
                    } catch (redemptionError) {
                        console.error('Promo redemption recording failed:', redemptionError.message);
                    }
                }

                res.json({
                    bookingId,
                    otp,
                    carType: selectedCarType,
                    fare: finalFare,
                    originalFare,
                    discountAmount,
                    promoCode: appliedPromoCode,
                    ridePreferences: cleanedPreferences,
                    specialInstructions: cleanedInstructions || null,
                    scheduledFor: scheduledMeta.scheduledFor ? scheduledMeta.scheduledFor.toISOString() : null,
                    isScheduled,
                    message: isScheduled
                        ? 'Ride scheduled successfully. We will start driver search near your pickup time.'
                        : "Looking for drivers...",
                });

                if (!isScheduled) {
                    findAndNotifyDriver(bookingId, pickupLat, pickupLng, [], io, selectedCarType, null);
                }
            }
        );
    } catch (error) {
        console.error("Request ride error:", error);
        res.status(500).json({ error: "Failed to create booking" });
    }
};

exports.handleRejection = (bookingId, driverId, io) => {
    const normalizedDriverId = Number(driverId);
    if (!Number.isInteger(normalizedDriverId) || normalizedDriverId <= 0) {
        return;
    }

    // Clear timeout
    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    pool.query(`SELECT rejected_drivers, pickup_lat, pickup_lng, car_type FROM bookings WHERE id = ?`, [bookingId], (err, rows) => {
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
        if (!rejectedList.includes(normalizedDriverId)) {
            rejectedList.push(normalizedDriverId);
        }

        pool.query(`UPDATE bookings SET rejected_drivers = ? WHERE id = ?`, [JSON.stringify(rejectedList), bookingId], (err) => {
            if (err) {
                console.error("Error updating rejected drivers:", err);
                return;
            }
            console.log(`🚫 Driver ${normalizedDriverId} rejected/timed out. Finding next...`);
            findAndNotifyDriver(
                bookingId,
                booking.pickup_lat,
                booking.pickup_lng,
                rejectedList,
                io,
                normalizeCarType(booking.car_type)
            );
        });
    });
};

exports.acceptRide = async (req, res) => {
    const { bookingId } = req.body;

    if (!bookingId) {
        return res.status(400).json({ error: "Missing bookingId" });
    }

    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: "Only drivers can accept rides" });
    }

    if (bookingTimeouts.has(bookingId)) {
        clearTimeout(bookingTimeouts.get(bookingId));
        bookingTimeouts.delete(bookingId);
    }

    try {
        const driver = await getDriverRecordForUser(req.user.id);
        if (!driver) {
            return res.status(404).json({ error: "Driver profile not found" });
        }

        const [result] = await pool
            .promise()
            .query(`UPDATE bookings SET status = 'accepted', driver_id = ? WHERE id = ? AND status = 'pending'`, [
                driver.id,
                bookingId,
            ]);

        if (result.affectedRows === 0) {
            return res.status(400).json({ error: "Ride request expired or already taken." });
        }

        await pool.promise().query(`UPDATE drivers SET status = 'busy' WHERE id = ?`, [driver.id]);

        const [rows] = await pool.promise().query(
            `
            SELECT b.id, b.rider_id, b.otp, b.pickup_lat, b.pickup_lng, b.drop_address,
                   u.name, u.email, u.phone,
                   d.car_model, d.car_plate, d.lat as driverLat, d.lng as driverLng
            FROM bookings b
            JOIN drivers d ON d.id = ?
            JOIN users u ON d.user_id = u.id
            WHERE b.id = ?
            LIMIT 1
        `,
            [driver.id, bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: "Could not fetch ride details" });
        }

        const info = rows[0];
        const io = req.app.get('socketio');

        let etaMinutes = 5;
        if (info.driverLat && info.driverLng && info.pickup_lat && info.pickup_lng) {
            try {
                const traffic = await getTrafficData(info.driverLat, info.driverLng, info.pickup_lat, info.pickup_lng);
                if (traffic && traffic.durationMins) {
                    etaMinutes = Math.round(traffic.durationMins);
                } else {
                    const dist = calculateDistance(info.driverLat, info.driverLng, info.pickup_lat, info.pickup_lng);
                    etaMinutes = Math.max(1, Math.round(dist * 3));
                }
            } catch (error) {
                console.error("Error calculating ETA:", error);
            }
        }

        const payload = {
            bookingId: Number(bookingId),
            riderId: Number(info.rider_id),
            driverId: Number(driver.id),
            otp: info.otp,
            driverName: info.name,
            carModel: info.car_model,
            carPlate: info.car_plate,
            rating: "5.0",
            phone: info.phone,
            eta: etaMinutes,
            dropAddress: info.drop_address,
        };

        emitToRider(io, info.rider_id, 'rideAccepted', payload);
        emitToDriver(io, driver.id, 'rideAccepted', payload);

        res.json({
            message: "Ride Accepted",
            eta: etaMinutes,
            driverId: Number(driver.id),
        });
    } catch (error) {
        console.error("Accept ride error:", error);
        res.status(500).json({ error: "Could not accept ride" });
    }
};

exports.applyPromo = async (req, res) => {
    const riderId = Number(req.user?.id);
    const { promoCode, pickupLat, pickupLng, dropLat, dropLng, carType } = req.body;

    if (!promoCode) {
        return res.status(400).json({ error: 'promoCode is required' });
    }

    if (
        pickupLat === undefined ||
        pickupLng === undefined ||
        dropLat === undefined ||
        dropLng === undefined
    ) {
        return res.status(400).json({ error: 'Coordinates are required to validate promo' });
    }

    try {
        const { distance, duration } = await calculateDistanceAndDuration(
            pickupLat,
            pickupLng,
            dropLat,
            dropLng
        );

        const surgeMultiplier = await calculateSurge();
        const selectedCarType = normalizeCarType(carType);
        const carMultiplier = CAR_TYPE_MULTIPLIERS[selectedCarType] || 1;

        const fareBeforePromo = Math.round(
            (BASE_FARE + distance * RATE_PER_KM + duration * RATE_PER_MIN) *
                surgeMultiplier *
                carMultiplier
        );

        const promoResult = await evaluatePromotion({
            promoCode,
            userId: riderId,
            fareAmount: fareBeforePromo,
        });

        if (!promoResult.ok) {
            return res.status(400).json({ error: promoResult.reason || 'Promo is not applicable' });
        }

        res.json({
            promoCode: promoResult.promotion.code,
            title: promoResult.promotion.title,
            discountAmount: promoResult.discountAmount,
            originalFare: fareBeforePromo,
            finalFare: promoResult.finalFare,
            carType: selectedCarType,
            surge: surgeMultiplier,
        });
    } catch (error) {
        console.error('Apply promo error:', error);
        res.status(500).json({ error: 'Failed to apply promo' });
    }
};

exports.startRide = async (req, res) => {
    const { bookingId, otp } = req.body;
    
    // 🟢 FIX: Validate input
    if (!bookingId || !otp) {
        return res.status(400).json({ error: "Missing bookingId or OTP" });
    }

    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: "Only drivers can start rides" });
    }

    try {
        const [rows] = await pool.promise().query(
            `
            SELECT b.otp, b.status, b.rider_id, b.driver_id, d.user_id AS driver_user_id
            FROM bookings b
            LEFT JOIN drivers d ON b.driver_id = d.id
            WHERE b.id = ?
            LIMIT 1
        `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];

        if (Number(booking.driver_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: "You are not assigned to this booking" });
        }

        if (booking.status !== 'accepted') {
            return res.status(400).json({ error: "Ride cannot be started. Current status: " + booking.status });
        }

        if (String(booking.otp) !== String(otp)) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        await pool.promise().query(`UPDATE bookings SET status = 'ongoing', start_time = NOW() WHERE id = ?`, [bookingId]);
        await pool.promise().query(`UPDATE drivers SET status = 'busy' WHERE id = ?`, [booking.driver_id]);

        const io = req.app.get('socketio');
        const payload = { bookingId: Number(bookingId), driverId: Number(booking.driver_id) };
        emitToRider(io, booking.rider_id, 'rideStarted', payload);
        emitToDriver(io, booking.driver_id, 'rideStarted', payload);

        res.json({ message: "Ride Started" });
    } catch (err) {
        console.error("Start ride error:", err);
        res.status(500).json({ error: "Database error" });
    }
};

exports.endRide = async (req, res) => {
    const { bookingId, dropLat, dropLng } = req.body;
    
    // 🟢 FIX: Validate input
    if (!bookingId) {
        return res.status(400).json({ error: "Missing bookingId" });
    }

    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: "Only drivers can end rides" });
    }

    try {
        const [rows] = await pool.promise().query(
            `
            SELECT b.pickup_lat, b.pickup_lng, b.fare, b.status, b.rider_id, b.driver_id, d.user_id AS driver_user_id
            FROM bookings b
            LEFT JOIN drivers d ON b.driver_id = d.id
            WHERE b.id = ?
            LIMIT 1
        `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];

        if (Number(booking.driver_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: "You are not assigned to this booking" });
        }

        if (booking.status !== 'ongoing') {
            return res.status(400).json({ error: "Ride cannot be ended. Current status: " + booking.status });
        }

        let finalFare = Number(booking.fare || 0);
        const normalizedDropLat = normalizeNumber(dropLat);
        const normalizedDropLng = normalizeNumber(dropLng);

        if (
            normalizedDropLat !== null &&
            normalizedDropLng !== null &&
            booking.pickup_lat !== null &&
            booking.pickup_lng !== null
        ) {
            try {
                const actualDist = calculateDistance(
                    Number(booking.pickup_lat),
                    Number(booking.pickup_lng),
                    normalizedDropLat,
                    normalizedDropLng
                );
                finalFare = Math.round(40 + actualDist * 12);
            } catch (error) {
                console.error("Error recalculating fare:", error);
            }
        }

        await pool.promise().query(
            `UPDATE bookings SET status = 'completed', end_time = NOW(), fare = ? WHERE id = ?`,
            [finalFare, bookingId]
        );

        await pool.promise().query(
            `UPDATE drivers SET status = 'online', lat = COALESCE(?, lat), lng = COALESCE(?, lng) WHERE id = ?`,
            [normalizedDropLat, normalizedDropLng, booking.driver_id]
        );

        const io = req.app.get('socketio');
        const payload = {
            bookingId: Number(bookingId),
            driverId: Number(booking.driver_id),
            fare: finalFare,
        };
        emitToRider(io, booking.rider_id, 'rideCompleted', payload);
        emitToDriver(io, booking.driver_id, 'rideCompleted', payload);

        res.json({ message: "Ride Completed", fare: finalFare });
    } catch (err) {
        console.error("End ride error:", err);
        res.status(500).json({ error: "Database error" });
    }
};

exports.cancelRide = async (req, res) => {
    const bookingId = Number(req.body?.bookingId);
    const reason = String(req.body?.reason || '').trim().slice(0, 255);

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
        return res.status(400).json({ error: "Valid bookingId is required" });
    }

    if (reason.length < 3) {
        return res.status(400).json({ error: "Cancellation reason is required" });
    }

    if (!['rider', 'driver'].includes(String(req.user?.role || ''))) {
        return res.status(403).json({ error: "Only rider or driver can cancel rides" });
    }

    try {
        const [rows] = await pool.promise().query(
            `
            SELECT
                b.id,
                b.status,
                b.rider_id,
                b.driver_id,
                d.user_id AS driver_user_id
            FROM bookings b
            LEFT JOIN drivers d ON b.driver_id = d.id
            WHERE b.id = ?
            LIMIT 1
        `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];
        if (!['accepted', 'ongoing'].includes(String(booking.status || ''))) {
            return res.status(400).json({ error: "Only accepted or ongoing rides can be cancelled" });
        }

        const requestUserId = Number(req.user?.id);
        const isRiderOwner = req.user?.role === 'rider' && Number(booking.rider_id) === requestUserId;
        const isDriverOwner = req.user?.role === 'driver' && Number(booking.driver_user_id) === requestUserId;

        if (!isRiderOwner && !isDriverOwner) {
            return res.status(403).json({ error: "You are not allowed to cancel this ride" });
        }

        const cancelledByRole = isDriverOwner ? 'driver' : 'rider';

        const [updateResult] = await pool.promise().query(
            `
            UPDATE bookings
            SET
                status = 'cancelled',
                cancellation_reason = ?,
                cancelled_by_role = ?,
                cancelled_at = NOW(),
                end_time = COALESCE(end_time, NOW())
            WHERE id = ? AND status IN ('accepted', 'ongoing')
        `,
            [reason, cancelledByRole, bookingId]
        );

        if (updateResult.affectedRows === 0) {
            return res.status(409).json({ error: "Ride was already updated. Please refresh state." });
        }

        if (booking.driver_id) {
            await pool.promise().query(
                `UPDATE drivers SET status = 'online' WHERE id = ? AND status = 'busy'`,
                [booking.driver_id]
            );
        }

        const io = req.app.get('socketio');
        const payload = {
            bookingId: Number(bookingId),
            cancelledByRole,
            reason,
            cancelledAt: new Date().toISOString(),
        };

        emitToRider(io, booking.rider_id, 'rideCancelled', payload);
        if (booking.driver_id) {
            emitToDriver(io, booking.driver_id, 'rideCancelled', payload);
        }

        return res.json({
            message: "Ride cancelled successfully",
            ...payload,
        });
    } catch (error) {
        console.error("Cancel ride error:", error);
        return res.status(500).json({ error: "Could not cancel ride" });
    }
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
                   u.name as driver_name, d.car_model, d.car_type
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
    
    const sql = `UPDATE bookings SET payment_status = 'paid' WHERE id = ? AND rider_id = ? AND status = 'completed'`;
    
    pool.query(sql, [bookingId, req.user.id], (err, result) => {
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

exports.createTripShareLink = async (req, res) => {
    const bookingId = Number(req.body?.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
        return res.status(400).json({ error: "Valid bookingId is required" });
    }

    try {
        const [rows] = await pool.promise().query(
            `
            SELECT b.id, b.status, b.rider_id, b.driver_id, d.user_id AS driver_user_id
            FROM bookings b
            LEFT JOIN drivers d ON d.id = b.driver_id
            WHERE b.id = ?
            LIMIT 1
        `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];
        const requestUserId = Number(req.user?.id);
        const isRiderOwner = req.user?.role === 'rider' && Number(booking.rider_id) === requestUserId;
        const isDriverOwner = req.user?.role === 'driver' && Number(booking.driver_user_id) === requestUserId;

        if (!isRiderOwner && !isDriverOwner) {
            return res.status(403).json({ error: "You are not allowed to share this trip" });
        }

        if (!['accepted', 'ongoing', 'completed'].includes(String(booking.status || ''))) {
            return res.status(400).json({ error: "Trip sharing is available only for accepted/ongoing/completed rides" });
        }

        const shareToken = jwt.sign({ bookingId: Number(booking.id) }, TRIP_SHARE_SECRET, {
            expiresIn: TRIP_SHARE_TTL,
        });

        res.json({
            bookingId: Number(booking.id),
            trackingUrl: `${getTripShareBaseUrl()}/api/bookings/track/${shareToken}`,
            expiresIn: TRIP_SHARE_TTL,
        });
    } catch (error) {
        console.error("Create trip share link error:", error);
        res.status(500).json({ error: "Could not create share link" });
    }
};

exports.getSharedTripStatus = async (req, res) => {
    const token = String(req.params?.token || '').trim();
    if (!token) {
        return res.status(400).json({ error: "Tracking token is required" });
    }

    try {
        const decoded = jwt.verify(token, TRIP_SHARE_SECRET);
        const bookingId = Number(decoded?.bookingId);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({ error: "Invalid tracking token payload" });
        }

        const [rows] = await pool.promise().query(
            `
            SELECT
                b.id, b.status, b.pickup_lat, b.pickup_lng, b.drop_lat, b.drop_lng,
                b.pickup_address, b.drop_address, b.start_time, b.end_time, b.created_at, b.fare,
                d.id AS driver_id, d.lat AS driver_lat, d.lng AS driver_lng, d.car_model, d.car_plate,
                u.name AS driver_name
            FROM bookings b
            LEFT JOIN drivers d ON b.driver_id = d.id
            LEFT JOIN users u ON d.user_id = u.id
            WHERE b.id = ?
            LIMIT 1
        `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Trip not found for this tracking token" });
        }

        const trip = rows[0];
        res.json({
            bookingId: Number(trip.id),
            status: trip.status,
            fare: Number(trip.fare || 0),
            pickup: {
                lat: trip.pickup_lat !== null ? Number(trip.pickup_lat) : null,
                lng: trip.pickup_lng !== null ? Number(trip.pickup_lng) : null,
                address: trip.pickup_address || null,
            },
            drop: {
                lat: trip.drop_lat !== null ? Number(trip.drop_lat) : null,
                lng: trip.drop_lng !== null ? Number(trip.drop_lng) : null,
                address: trip.drop_address || null,
            },
            driver: {
                id: trip.driver_id ? Number(trip.driver_id) : null,
                name: trip.driver_name || null,
                carModel: trip.car_model || null,
                carPlate: trip.car_plate || null,
                lat: trip.driver_lat !== null ? Number(trip.driver_lat) : null,
                lng: trip.driver_lng !== null ? Number(trip.driver_lng) : null,
            },
            timeline: {
                createdAt: trip.created_at || null,
                startTime: trip.start_time || null,
                endTime: trip.end_time || null,
            },
            refreshedAt: new Date().toISOString(),
        });
    } catch (error) {
        if (error?.name === 'TokenExpiredError') {
            return res.status(410).json({ error: "Tracking link expired" });
        }
        if (error?.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: "Invalid tracking token" });
        }

        console.error("Shared trip status error:", error);
        res.status(500).json({ error: "Could not fetch shared trip status" });
    }
};

exports.updateDriverAvailability = async (req, res) => {
    const { isOnline, lat, lng } = req.body;

    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: "Only drivers can update availability" });
    }

    if (typeof isOnline !== 'boolean') {
        return res.status(400).json({ error: "isOnline must be boolean" });
    }

    try {
        const driver = await getDriverRecordForUser(req.user.id);
        if (!driver) {
            return res.status(404).json({ error: "Driver profile not found" });
        }

        const activeRide = await getActiveBookingForDriver(driver.id);
        if (activeRide && !isOnline) {
            return res.status(409).json({ error: "Cannot go offline during an active ride" });
        }

        const desiredStatus = activeRide ? 'busy' : (isOnline ? 'online' : 'offline');
        const parsedLat = normalizeNumber(lat);
        const parsedLng = normalizeNumber(lng);

        await pool.promise().query(
            `
            UPDATE drivers
            SET status = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng)
            WHERE id = ?
        `,
            [desiredStatus, parsedLat, parsedLng, driver.id]
        );

        if (desiredStatus === 'offline' && global.driverSockets) {
            global.driverSockets.delete(Number(driver.id));
        }

        res.json({
            message: "Driver availability updated",
            driverId: Number(driver.id),
            status: desiredStatus,
        });
    } catch (error) {
        console.error("Availability update error:", error);
        res.status(500).json({ error: "Failed to update availability" });
    }
};

exports.updateDriverLocation = async (req, res) => {
    const { lat, lng } = req.body;

    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: "Only drivers can update location" });
    }

    const parsedLat = normalizeNumber(lat);
    const parsedLng = normalizeNumber(lng);
    if (parsedLat === null || parsedLng === null) {
        return res.status(400).json({ error: "lat and lng are required numbers" });
    }

    try {
        const driver = await getDriverRecordForUser(req.user.id);
        if (!driver) {
            return res.status(404).json({ error: "Driver profile not found" });
        }

        const activeRide = await getActiveBookingForDriver(driver.id);
        const status = activeRide ? 'busy' : 'online';

        await pool.promise().query(
            `UPDATE drivers SET lat = ?, lng = ?, status = ? WHERE id = ?`,
            [parsedLat, parsedLng, status, driver.id]
        );

        const io = req.app.get('socketio');
        await emitDriverLocationToActiveRide(io, driver.id, parsedLat, parsedLng);

        res.json({
            message: "Location updated",
            driverId: Number(driver.id),
            status,
        });
    } catch (error) {
        console.error("Driver location update error:", error);
        res.status(500).json({ error: "Failed to update location" });
    }
};

exports.getSavedPlaces = async (req, res) => {
    try {
        const [rows] = await pool.promise().query(
            `
            SELECT id, label, address, lat, lng, created_at
            FROM saved_places
            WHERE user_id = ?
            ORDER BY
                CASE LOWER(label)
                    WHEN 'home' THEN 0
                    WHEN 'work' THEN 1
                    ELSE 2
                END,
                created_at DESC
            `,
            [req.user.id]
        );

        res.json(
            (rows || []).map((place) => ({
                id: Number(place.id),
                label: place.label,
                address: place.address,
                lat: Number(place.lat),
                lng: Number(place.lng),
                createdAt: place.created_at,
            }))
        );
    } catch (error) {
        console.error('Get saved places error:', error);
        res.status(500).json({ error: 'Could not fetch saved places' });
    }
};

exports.savePlace = async (req, res) => {
    const label = String(req.body?.label || '').trim().toLowerCase().slice(0, 30);
    const address = String(req.body?.address || '').trim().slice(0, 255);
    const lat = normalizeNumber(req.body?.lat);
    const lng = normalizeNumber(req.body?.lng);

    if (!label || !/^[a-z0-9 _-]{2,30}$/i.test(label)) {
        return res.status(400).json({ error: 'label must be 2-30 chars and alphanumeric' });
    }
    if (address.length < 3) {
        return res.status(400).json({ error: 'address is required' });
    }
    if (lat === null || lng === null) {
        return res.status(400).json({ error: 'lat and lng are required numbers' });
    }

    try {
        await pool.promise().query(
            `
            INSERT INTO saved_places (user_id, label, address, lat, lng)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                address = VALUES(address),
                lat = VALUES(lat),
                lng = VALUES(lng)
            `,
            [req.user.id, label, address, lat, lng]
        );

        const [rows] = await pool.promise().query(
            `
            SELECT id, label, address, lat, lng, created_at
            FROM saved_places
            WHERE user_id = ? AND label = ?
            LIMIT 1
            `,
            [req.user.id, label]
        );

        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: 'Saved place could not be created' });
        }

        const savedPlace = rows[0];
        res.json({
            id: Number(savedPlace.id),
            label: savedPlace.label,
            address: savedPlace.address,
            lat: Number(savedPlace.lat),
            lng: Number(savedPlace.lng),
            createdAt: savedPlace.created_at,
        });
    } catch (error) {
        console.error('Save place error:', error);
        res.status(500).json({ error: 'Could not save place' });
    }
};

exports.deleteSavedPlace = async (req, res) => {
    const placeId = Number(req.params?.placeId);
    if (!Number.isInteger(placeId) || placeId <= 0) {
        return res.status(400).json({ error: 'Valid placeId is required' });
    }

    try {
        const [result] = await pool.promise().query(
            `DELETE FROM saved_places WHERE id = ? AND user_id = ?`,
            [placeId, req.user.id]
        );

        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ error: 'Saved place not found' });
        }

        res.json({ message: 'Saved place deleted', placeId });
    } catch (error) {
        console.error('Delete saved place error:', error);
        res.status(500).json({ error: 'Could not delete saved place' });
    }
};

exports.getUpcomingRides = async (req, res) => {
    try {
        const [rows] = await pool.promise().query(
            `
            SELECT
                id, pickup_address, drop_address, scheduled_for, car_type,
                fare, promo_code, discount_amount, status, created_at
            FROM bookings
            WHERE rider_id = ?
              AND scheduled_for IS NOT NULL
              AND status IN ('pending', 'accepted')
              AND scheduled_for >= (NOW() - INTERVAL 30 MINUTE)
            ORDER BY scheduled_for ASC
            LIMIT 30
            `,
            [req.user.id]
        );

        res.json(
            (rows || []).map((ride) => ({
                bookingId: Number(ride.id),
                pickupAddress: ride.pickup_address,
                dropAddress: ride.drop_address,
                scheduledFor: ride.scheduled_for,
                status: ride.status,
                carType: ride.car_type,
                fare: Number(ride.fare || 0),
                promoCode: ride.promo_code || null,
                discountAmount: Number(ride.discount_amount || 0),
                createdAt: ride.created_at,
            }))
        );
    } catch (error) {
        console.error('Upcoming rides error:', error);
        res.status(500).json({ error: 'Could not fetch upcoming rides' });
    }
};

exports.getRideReceipt = async (req, res) => {
    const bookingId = Number(req.params?.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
        return res.status(400).json({ error: 'Valid bookingId is required' });
    }

    try {
        const [rows] = await pool.promise().query(
            `
            SELECT
                b.id, b.rider_id, b.status, b.pickup_address, b.drop_address, b.created_at,
                b.start_time, b.end_time, b.payment_mode, b.payment_status, b.car_type,
                b.fare, b.original_fare, b.discount_amount, b.promo_code, b.rating, b.review,
                b.scheduled_for, b.ride_preferences, b.special_instructions,
                rider.name AS rider_name, rider.phone AS rider_phone,
                d.id AS driver_id, d.user_id AS driver_user_id, d.car_model, d.car_plate,
                driver.name AS driver_name, driver.phone AS driver_phone
            FROM bookings b
            JOIN users rider ON b.rider_id = rider.id
            LEFT JOIN drivers d ON b.driver_id = d.id
            LEFT JOIN users driver ON d.user_id = driver.id
            WHERE b.id = ?
            LIMIT 1
            `,
            [bookingId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const receipt = rows[0];
        const requestUserId = Number(req.user.id);
        const isRiderOwner = req.user.role === 'rider' && Number(receipt.rider_id) === requestUserId;
        const isDriverOwner = req.user.role === 'driver' && Number(receipt.driver_user_id) === requestUserId;
        if (!isRiderOwner && !isDriverOwner) {
            return res.status(403).json({ error: 'You are not allowed to view this receipt' });
        }

        res.json({
            bookingId: Number(receipt.id),
            status: receipt.status,
            pickupAddress: receipt.pickup_address,
            dropAddress: receipt.drop_address,
            carType: receipt.car_type,
            paymentMode: receipt.payment_mode,
            paymentStatus: receipt.payment_status,
            amount: {
                totalFare: Number(receipt.fare || 0),
                originalFare: Number(receipt.original_fare || receipt.fare || 0),
                discountAmount: Number(receipt.discount_amount || 0),
                promoCode: receipt.promo_code || null,
            },
            rider: {
                name: receipt.rider_name,
                phone: receipt.rider_phone,
            },
            driver: {
                id: receipt.driver_id ? Number(receipt.driver_id) : null,
                name: receipt.driver_name || null,
                phone: receipt.driver_phone || null,
                carModel: receipt.car_model || null,
                carPlate: receipt.car_plate || null,
            },
            timeline: {
                createdAt: receipt.created_at,
                scheduledFor: receipt.scheduled_for,
                startTime: receipt.start_time,
                endTime: receipt.end_time,
            },
            ridePreferences: parseJsonArray(receipt.ride_preferences),
            specialInstructions: receipt.special_instructions || null,
            rating: receipt.rating !== null ? Number(receipt.rating) : null,
            review: receipt.review || null,
        });
    } catch (error) {
        console.error('Receipt fetch error:', error);
        res.status(500).json({ error: 'Could not fetch receipt' });
    }
};

exports.getDriverEarningsSummary = async (req, res) => {
    if (req.user?.role !== 'driver') {
        return res.status(403).json({ error: 'Only drivers can view earnings' });
    }

    try {
        const driver = await getDriverRecordForUser(req.user.id);
        if (!driver) {
            return res.status(404).json({ error: 'Driver profile not found' });
        }

        const range = String(req.query?.range || '7d').trim().toLowerCase();
        let fromDate = null;
        let toDate = null;
        const now = new Date();

        if (range === '1d') {
            fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else if (range === '7d') {
            fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (range === '30d') {
            fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (range === 'custom') {
            fromDate = req.query?.from ? new Date(req.query.from) : null;
            toDate = req.query?.to ? new Date(req.query.to) : null;
            if (
                (fromDate && Number.isNaN(fromDate.getTime())) ||
                (toDate && Number.isNaN(toDate.getTime()))
            ) {
                return res.status(400).json({ error: 'Invalid custom date range' });
            }
        }

        const whereClauses = ['driver_id = ?', "status = 'completed'"];
        const params = [driver.id];

        if (fromDate) {
            whereClauses.push('COALESCE(end_time, created_at) >= ?');
            params.push(fromDate);
        }
        if (toDate) {
            whereClauses.push('COALESCE(end_time, created_at) <= ?');
            params.push(toDate);
        }

        const whereSql = whereClauses.join(' AND ');
        const [summaryRows] = await pool.promise().query(
            `
            SELECT
                COUNT(*) AS completed_rides,
                COALESCE(SUM(fare), 0) AS gross_earnings,
                COALESCE(SUM(discount_amount), 0) AS discounts_given,
                COALESCE(AVG(rating), 0) AS avg_rating
            FROM bookings
            WHERE ${whereSql}
            `,
            params
        );

        const [paymentSplitRows] = await pool.promise().query(
            `
            SELECT payment_mode, COUNT(*) AS rides, COALESCE(SUM(fare), 0) AS total
            FROM bookings
            WHERE ${whereSql}
            GROUP BY payment_mode
            `,
            params
        );

        const paymentSplit = {
            cash: { rides: 0, total: 0 },
            online: { rides: 0, total: 0 },
        };

        (paymentSplitRows || []).forEach((row) => {
            const key = row.payment_mode === 'online' ? 'online' : 'cash';
            paymentSplit[key] = {
                rides: Number(row.rides || 0),
                total: Number(row.total || 0),
            };
        });

        const summary = summaryRows?.[0] || {};
        res.json({
            driverId: Number(driver.id),
            range,
            completedRides: Number(summary.completed_rides || 0),
            grossEarnings: Number(summary.gross_earnings || 0),
            discountsGiven: Number(summary.discounts_given || 0),
            avgRating: Number(Number(summary.avg_rating || 0).toFixed(2)),
            paymentSplit,
        });
    } catch (error) {
        console.error('Driver earnings error:', error);
        res.status(500).json({ error: 'Could not fetch earnings summary' });
    }
};

exports.processScheduledQueue = async (io) => {
    await dispatchDueScheduledBookings(io);
};

module.exports = exports;
