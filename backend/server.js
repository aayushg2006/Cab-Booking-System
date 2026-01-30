// backend/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const bookingController = require('./controllers/bookingController');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.set('socketio', io);

// --- 🌍 GLOBAL STATE (SOCKETS ONLY) ---
// We only keep track of WHO is connected, not WHERE they are.
global.driverSockets = new Map(); // driverId -> socketId
global.riderSockets = new Map();  // riderId -> socketId

pool.getConnection((err, connection) => {
    if (err) console.error('❌ Database Connection Failed:', err.message);
    else {
        console.log('✅ Connected to Cloud MySQL Database!');
        connection.release();
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);

// --- ⚡ SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`⚡ New Connection: ${socket.id}`);

    // 1. Driver Comes Online / Moves
    socket.on('driverLocation', (data) => {
        if (!data.driverId) return;

        // A. Update Socket Map (So we can find them later)
        global.driverSockets.set(data.driverId, socket.id);
        
        // B. Update Database (Persistent Storage)
        const sql = `UPDATE drivers SET lat = ?, lng = ?, status = 'online' WHERE id = ?`;
        pool.query(sql, [data.lat, data.lng, data.driverId], (err) => {
            if (err) console.error("Location Update Error:", err.message);
        });

        // C. Broadcast to Riders (for live tracking on map)
        io.emit('driverMoved', {
            driverId: data.driverId,
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng)
        });
    });

    // 2. Rider Joins
    socket.on('joinRider', (userId) => {
        global.riderSockets.set(userId, socket.id);
        console.log(`👤 Rider ${userId} Joined`);
    });

    // 3. Driver Joins (Explicit Join)
    socket.on('joinDriver', (driverId) => {
        global.driverSockets.set(driverId, socket.id);
        console.log(`🚖 Driver ${driverId} Joined`);
    });

    // 4. Disconnect
    socket.on('disconnect', () => {
        // Optional: You could mark driver as 'offline' in DB here if you wanted strict tracking
        // For now, we just remove their socket connection
        for (let [key, value] of global.driverSockets.entries()) {
            if (value === socket.id) {
                global.driverSockets.delete(key);
                console.log(`❌ Driver ${key} Socket Disconnected`);
                break;
            }
        }
    });

    // 5. Driver Declines Ride
    socket.on('declineRide', (data) => {
        // data = { bookingId, driverId }
        console.log(`❌ Driver ${data.driverId} declined Booking ${data.bookingId}`);
        bookingController.handleRejection(data.bookingId, data.driverId, io);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});