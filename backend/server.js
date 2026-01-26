require('dotenv').config();
const express = require('express');
const http = require('http'); // <--- NEW
const { Server } = require('socket.io'); // <--- NEW
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');

const app = express();
const server = http.createServer(app); // <--- Wrap Express in HTTP server
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from anywhere (Mobile App / Web)
        methods: ["GET", "POST"]
    }
});

app.set('socketio', io); // Allows controllers to use 'io'

app.use(express.json());

// Database Check
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database Connection Failed:', err.message);
    } else {
        console.log('✅ Successfully connected to Cloud MySQL Database!');
        connection.release();
    }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);

// --- REAL-TIME SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`⚡ New Client Connected: ${socket.id}`);

    // 1. Driver sends their location
    socket.on('driverLocation', (data) => {
        // data = { driverId: 1, lat: 19.0760, lng: 72.8777 }
        console.log(`📍 Driver ${data.driverId} is at [${data.lat}, ${data.lng}]`);
        
        // TODO: Later we will save this to Redis or MySQL
        // For now, we just broadcast it to anyone listening (like the Admin Dashboard)
        io.emit('locationUpdate', data); 
    });

    socket.on('disconnect', () => {
        console.log(`fw Client Disconnected: ${socket.id}`);
    });
});

// --- GLOBAL MEMORY FOR DRIVERS (In real production, use Redis) ---
global.activeDrivers = new Map(); // Stores { driverId: { socketId, lat, lng } }

// --- REAL-TIME SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`⚡ New Client Connected: ${socket.id}`);

    // 1. Driver comes online or moves
    socket.on('driverLocation', (data) => {
        // data = { driverId: 101, lat: ..., lng: ... }
        
        // Save/Update driver in memory
        global.activeDrivers.set(data.driverId, {
            socketId: socket.id, // We need this ID to send messages back to specific driver
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng)
        });

        // Broadcast to admin (optional)
        io.emit('locationUpdate', data);
    });

    socket.on('disconnect', () => {
        // Remove driver from memory when they close the app
        // We iterate to find which driver had this socket.id
        for (let [driverId, driverData] of global.activeDrivers.entries()) {
            if (driverData.socketId === socket.id) {
                global.activeDrivers.delete(driverId);
                console.log(`❌ Driver ${driverId} disconnected`);
                break;
            }
        }
    });
});

const PORT = 3000;
//Mm IMPORTANT: Change 'app.listen' to 'server.listen'
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});