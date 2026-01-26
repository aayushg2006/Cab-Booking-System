require('dotenv').config();
const express = require('express');
const pool = require('./config/db'); // <--- IMPORT THE POOL
const authRoutes = require('./routes/auth');

const app = express();
app.use(express.json());

// Test the database connection on startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database Connection Failed:', err.message);
    } else {
        console.log('✅ Successfully connected to Cloud MySQL Database!');
        connection.release();
    }
});

// Use Routes
app.use('/api/auth', authRoutes);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});