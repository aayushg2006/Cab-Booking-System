// backend/server.js
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

app.set('socketio', io);

// --- 🌍 GLOBAL STATE ---
global.activeDrivers = new Map(); 
global.activeRiders = new Map(); 

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
        if (!data.driverId) {
            console.log("⚠️ Received driverLocation without driverId!");
            return;
        }

        global.activeDrivers.set(data.driverId, {
            socketId: socket.id,
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng)
        });
        
        // Log every few seconds in a real app, but here we log every update to debug
        console.log(`📍 Driver ${data.driverId} Online at [${data.lat}, ${data.lng}]`);
    });

    // 2. Rider Joins
    socket.on('joinRider', (userId) => {
        global.activeRiders.set(userId, { socketId: socket.id });
        console.log(`👤 Rider ${userId} Joined`);
    });

    socket.on('disconnect', () => {
        for (let [key, value] of global.activeDrivers.entries()) {
            if (value.socketId === socket.id) {
                global.activeDrivers.delete(key);
                console.log(`❌ Driver ${key} disconnected`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});