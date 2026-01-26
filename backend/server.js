require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Store IO in app so controllers can use it
app.set('socketio', io);

// --- 🌍 GLOBAL STATE (In-Memory Redis Replacement) ---
global.activeDrivers = new Map(); // { driverId: { socketId, lat, lng } }
global.activeRiders = new Map();  // { riderId: { socketId, lat, lng } }

// Database Check
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

    // 1. Driver Location Updates
    socket.on('driverLocation', (data) => {
        global.activeDrivers.set(data.driverId, {
            socketId: socket.id,
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng)
        });
    });

    // 2. Rider Joins (needed for demand calculation)
    socket.on('joinRider', (data) => {
        // data = { userId: 1, lat: ..., lng: ... }
        global.activeRiders.set(data.userId, {
            socketId: socket.id,
            lat: parseFloat(data.lat || 0),
            lng: parseFloat(data.lng || 0)
        });
        console.log(`👤 Rider ${data.userId} Active`);
    });

    socket.on('disconnect', () => {
        // Cleanup Driver
        for (let [key, value] of global.activeDrivers.entries()) {
            if (value.socketId === socket.id) {
                global.activeDrivers.delete(key);
                console.log(`❌ Driver ${key} disconnected`);
                break;
            }
        }
        // Cleanup Rider
        for (let [key, value] of global.activeRiders.entries()) {
            if (value.socketId === socket.id) {
                global.activeRiders.delete(key);
                console.log(`❌ Rider ${key} disconnected`);
                break;
            }
        }
    });
});

// --- 🛠 TEST UTILITY ROUTES (For Thunder Client ONLY) ---
// This allows you to simulate a driver being "Online" without a real app
app.post('/api/test/force-online', (req, res) => {
    const { driverId, lat, lng } = req.body;
    
    // Fake a socket ID
    const fakeSocketId = `TEST_SOCKET_${Date.now()}`;
    
    global.activeDrivers.set(driverId, {
        socketId: fakeSocketId,
        lat: parseFloat(lat),
        lng: parseFloat(lng)
    });

    console.log(`🔧 TEST MODE: Forced Driver ${driverId} Online at [${lat}, ${lng}]`);
    res.json({ message: `Driver ${driverId} is now online (Simulated)`, fakeSocketId });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});