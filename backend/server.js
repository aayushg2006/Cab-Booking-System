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
});

app.set('socketio', io);

global.driverSockets = new Map();
global.riderSockets = new Map();

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

    socket.on('driverLocation', (data) => {
        if (!data.driverId) return;

        global.driverSockets.set(data.driverId, socket.id);

        const sql = `UPDATE drivers SET lat = ?, lng = ?, status = 'online' WHERE id = ?`;
        pool.query(sql, [data.lat, data.lng, data.driverId], (err) => {
            if (err) console.error('Location update error:', err.message);
        });

        io.emit('driverMoved', {
            driverId: data.driverId,
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng),
        });
    });

    socket.on('joinRider', (userId) => {
        global.riderSockets.set(userId, socket.id);
        console.log(`Rider ${userId} joined`);
    });

    socket.on('declineRide', (data) => {
        console.log(`Driver ${data.driverId} declined booking ${data.bookingId}`);
        bookingController.handleRejection(data.bookingId, data.driverId, io);
    });

    socket.on('disconnect', () => {
        for (const [key, value] of global.driverSockets.entries()) {
            if (value === socket.id) {
                global.driverSockets.delete(key);
                console.log(`Driver ${key} socket disconnected`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    await ensureSchema();
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();
