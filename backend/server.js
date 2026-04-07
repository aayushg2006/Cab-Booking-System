require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const paymentRoutes = require('./routes/payments');
const bookingController = require('./controllers/bookingController');
const { ensureSchema } = require('./utils/ensureSchema');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 25000,
    pingTimeout: 60000,
});

app.set('socketio', io);

global.driverSockets = new Map();
global.riderSockets = new Map();

const normalizeId = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeCoord = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value) => String(value || '').trim();
const SCHEDULED_QUEUE_POLL_MS = Number(process.env.SCHEDULED_QUEUE_POLL_MS || 30000);

const resolveDriverId = (candidate, callback) => {
    const parsedCandidate = normalizeId(candidate);
    if (!parsedCandidate) {
        callback(null, null);
        return;
    }

    const sql = `
        SELECT id
        FROM drivers
        WHERE id = ? OR user_id = ?
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1
    `;

    pool.query(sql, [parsedCandidate, parsedCandidate, parsedCandidate], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            callback(err || null, null);
            return;
        }
        callback(null, Number(rows[0].id));
    });
};

const clearSocketFromMap = (targetMap, socketId) => {
    for (const [entityId, mappedSocketId] of targetMap.entries()) {
        if (mappedSocketId === socketId) {
            targetMap.delete(entityId);
            return entityId;
        }
    }
    return null;
};

const emitDriverLocationToActiveRider = (driverId, lat, lng) => {
    const rideSql = `
        SELECT id, rider_id
        FROM bookings
        WHERE driver_id = ? AND status IN ('accepted', 'ongoing')
        ORDER BY id DESC
        LIMIT 1
    `;

    pool.query(rideSql, [driverId], (rideErr, rows) => {
        if (rideErr || !rows || rows.length === 0) return;

        const activeRide = rows[0];
        const riderSocketId = global.riderSockets.get(Number(activeRide.rider_id));
        if (!riderSocketId) return;

        io.to(riderSocketId).emit('driverMoved', {
            bookingId: Number(activeRide.id),
            driverId,
            lat,
            lng,
        });
    });
};

const reconcileRuntimeState = async () => {
    try {
        const promisePool = pool.promise();

        const [staleAcceptedResult] = await promisePool.query(
            `
            UPDATE bookings
            SET
                status = 'cancelled',
                cancellation_reason = COALESCE(cancellation_reason, 'Auto-cancelled after stale accepted state'),
                cancelled_by_role = COALESCE(cancelled_by_role, 'driver'),
                cancelled_at = COALESCE(cancelled_at, NOW()),
                end_time = COALESCE(end_time, NOW())
            WHERE status = 'accepted'
              AND created_at < (NOW() - INTERVAL 45 MINUTE)
        `
        );

        const [stalePendingResult] = await promisePool.query(
            `
            UPDATE bookings
            SET
                status = 'cancelled',
                cancellation_reason = COALESCE(cancellation_reason, 'Auto-cancelled after request timeout'),
                cancelled_by_role = COALESCE(cancelled_by_role, 'rider'),
                cancelled_at = COALESCE(cancelled_at, NOW()),
                end_time = COALESCE(end_time, NOW())
            WHERE status = 'pending'
              AND (scheduled_for IS NULL OR scheduled_for <= NOW())
              AND created_at < (NOW() - INTERVAL 15 MINUTE)
        `
        );

        const [driverStatusResult] = await promisePool.query(
            `
            UPDATE drivers d
            LEFT JOIN (
                SELECT driver_id, COUNT(*) AS active_count
                FROM bookings
                WHERE status IN ('accepted', 'ongoing')
                GROUP BY driver_id
            ) b ON b.driver_id = d.id
            SET d.status = CASE
                WHEN IFNULL(b.active_count, 0) > 0 THEN 'busy'
                WHEN d.status = 'offline' THEN 'offline'
                ELSE 'online'
            END
        `
        );

        console.log(
            `[reconcile] cancelled stale accepted=${staleAcceptedResult.affectedRows}, ` +
            `stale pending=${stalePendingResult.affectedRows}, driver status updates=${driverStatusResult.affectedRows}`
        );
    } catch (error) {
        console.error('[reconcile] Runtime state reconciliation failed:', error.message);
    }
};

pool.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }

    console.log('Connected to Cloud MySQL database.');
    connection.release();
});

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('joinDriver', (driverId) => {
        resolveDriverId(driverId, (err, parsedDriverId) => {
            if (err || !parsedDriverId) return;
            global.driverSockets.set(parsedDriverId, socket.id);
            console.log(`Driver ${parsedDriverId} joined`);
        });
    });

    socket.on('joinRider', (userId) => {
        const parsedUserId = normalizeId(userId);
        if (!parsedUserId) return;

        global.riderSockets.set(parsedUserId, socket.id);
        console.log(`Rider ${parsedUserId} joined`);
    });

    socket.on('driverLocation', (data) => {
        const lat = normalizeCoord(data?.lat);
        const lng = normalizeCoord(data?.lng);
        if (lat === null || lng === null) return;

        resolveDriverId(data?.driverId, (resolveErr, driverId) => {
            if (resolveErr || !driverId) return;

            global.driverSockets.set(driverId, socket.id);

            const sql = `
                UPDATE drivers
                SET lat = ?, lng = ?, status = CASE WHEN status = 'busy' THEN 'busy' ELSE 'online' END
                WHERE id = ?
            `;
            pool.query(sql, [lat, lng, driverId], (err) => {
                if (err) console.error('Location update error:', err.message);
            });

            emitDriverLocationToActiveRider(driverId, lat, lng);
        });
    });

    socket.on('declineRide', (data) => {
        resolveDriverId(data?.driverId, (_resolveErr, driverId) => {
            if (!driverId) return;
            console.log(`Driver ${driverId} declined booking ${data.bookingId}`);
            bookingController.handleRejection(data.bookingId, driverId, io);
        });
    });

    socket.on('rideChatMessage', (data) => {
        const bookingId = normalizeId(data?.bookingId);
        const senderRole = data?.senderRole === 'driver' ? 'driver' : 'rider';
        const senderId = normalizeId(data?.senderId);
        const messageText = normalizeText(data?.text).slice(0, 500);
        const messageId = normalizeText(data?.messageId) || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        if (!bookingId || !senderId || !messageText) return;

        const sql = `
            SELECT b.id, b.rider_id, b.driver_id, b.status
            FROM bookings b
            WHERE b.id = ?
            LIMIT 1
        `;

        pool.query(sql, [bookingId], (err, rows) => {
            if (err || !rows || rows.length === 0) return;

            const booking = rows[0];
            if (!['accepted', 'ongoing'].includes(String(booking.status || ''))) return;

            const riderId = Number(booking.rider_id);
            const driverId = Number(booking.driver_id);
            if (!riderId || !driverId) return;

            if (senderRole === 'rider' && senderId !== riderId) return;
            if (senderRole === 'driver' && senderId !== driverId) return;

            const payload = {
                bookingId: Number(bookingId),
                senderRole,
                senderId,
                text: messageText,
                messageId,
                sentAt: new Date().toISOString(),
            };

            if (senderRole === 'rider') {
                const targetSocketId = global.driverSockets.get(driverId);
                if (targetSocketId) io.to(targetSocketId).emit('rideChatMessage', payload);
            } else {
                const targetSocketId = global.riderSockets.get(riderId);
                if (targetSocketId) io.to(targetSocketId).emit('rideChatMessage', payload);
            }

            socket.emit('rideChatAck', payload);
        });
    });

    socket.on('disconnect', () => {
        const disconnectedDriverId = clearSocketFromMap(global.driverSockets, socket.id);
        if (disconnectedDriverId) {
            console.log(`Driver ${disconnectedDriverId} socket disconnected`);

            const statusSql = `
                UPDATE drivers d
                LEFT JOIN (
                    SELECT driver_id, COUNT(*) AS active_count
                    FROM bookings
                    WHERE status IN ('accepted', 'ongoing')
                    GROUP BY driver_id
                ) b ON b.driver_id = d.id
                SET d.status = CASE
                    WHEN IFNULL(b.active_count, 0) > 0 THEN 'busy'
                    ELSE 'offline'
                END
                WHERE d.id = ?
            `;
            pool.query(statusSql, [disconnectedDriverId], () => {});
        }

        clearSocketFromMap(global.riderSockets, socket.id);
    });
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    await ensureSchema();
    await reconcileRuntimeState();
    bookingController.processScheduledQueue(io).catch((error) => {
        console.error('[scheduled-dispatch] initial run failed:', error.message);
    });
    setInterval(() => {
        bookingController.processScheduledQueue(io).catch((error) => {
            console.error('[scheduled-dispatch] failed:', error.message);
        });
    }, SCHEDULED_QUEUE_POLL_MS);
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();
