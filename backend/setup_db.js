require('dotenv').config();
const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

connection.connect((err) => {
    if (err) return console.error('❌ Connection failed:', err);
    console.log('✅ Connected. Upgrading Database Schema...');
    createTables();
});

function createTables() {
    const queries = [
        // 1. Users (Unchanged)
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            phone VARCHAR(15) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('rider', 'driver', 'admin') DEFAULT 'rider',
            wallet_balance DECIMAL(10,2) DEFAULT 0.00,
            rating DECIMAL(3, 2) DEFAULT 5.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // 2. Drivers (Unchanged)
        `CREATE TABLE IF NOT EXISTS drivers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            license_number VARCHAR(50) NOT NULL,
            car_model VARCHAR(50) NOT NULL,
            car_plate VARCHAR(20) NOT NULL,
            is_online BOOLEAN DEFAULT FALSE,
            current_lat DECIMAL(10, 8),
            current_lng DECIMAL(11, 8),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,

        // 3. Bookings (Updated with OTP and Payment Status)
        `CREATE TABLE IF NOT EXISTS bookings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            rider_id INT NOT NULL,
            driver_id INT,
            pickup_address VARCHAR(255),
            drop_address VARCHAR(255),
            pickup_lat DECIMAL(10, 8),
            pickup_lng DECIMAL(11, 8),
            drop_lat DECIMAL(10, 8),
            drop_lng DECIMAL(11, 8),
            fare DECIMAL(10, 2),
            status ENUM('pending', 'accepted', 'arrived', 'ongoing', 'completed', 'cancelled') DEFAULT 'pending',
            payment_status ENUM('pending', 'paid') DEFAULT 'pending',
            payment_method ENUM('cash', 'wallet') DEFAULT 'cash',
            otp VARCHAR(6),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (rider_id) REFERENCES users(id),
            FOREIGN KEY (driver_id) REFERENCES drivers(id)
        )`,

        // 4. Ratings (NEW)
        `CREATE TABLE IF NOT EXISTS ratings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            booking_id INT NOT NULL,
            reviewer_id INT NOT NULL, -- Who gave the rating
            rated_user_id INT NOT NULL, -- Who received the rating
            stars INT CHECK (stars >= 1 AND stars <= 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES bookings(id),
            FOREIGN KEY (reviewer_id) REFERENCES users(id),
            FOREIGN KEY (rated_user_id) REFERENCES users(id)
        )`,

        // 5. Transactions (NEW - For Wallet History)
        `CREATE TABLE IF NOT EXISTS transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            type ENUM('credit', 'debit') NOT NULL,
            description VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    ];

    let completed = 0;
    queries.forEach((query, index) => {
        connection.query(query, (err) => {
            if (err) console.error(`❌ Error table ${index + 1}:`, err.message);
            else console.log(`✅ Table ${index + 1} Checked/Created.`);
            
            completed++;
            if (completed === queries.length) {
                console.log('🎉 Database Schema Matches Uber Standard!');
                connection.end();
            }
        });
    });
}