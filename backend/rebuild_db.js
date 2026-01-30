// backend/rebuild_db.js
const pool = require('./config/db');

const rebuildDatabase = async () => {
    try {
        const promisePool = pool.promise();
        console.log("⏳ Starting Database Rebuild...");

        // 1. DISABLE FOREIGN KEYS (To allow dropping tables freely)
        await promisePool.query('SET FOREIGN_KEY_CHECKS = 0');

        // 2. DROP EXISTING TABLES
        console.log("🔥 Dropping old tables...");
        await promisePool.query('DROP TABLE IF EXISTS bookings');
        await promisePool.query('DROP TABLE IF EXISTS drivers');
        await promisePool.query('DROP TABLE IF EXISTS users');

        // 3. CREATE USERS TABLE (Fixed 'password' -> 'password_hash')
        console.log("🔨 Creating 'users' table...");
        await promisePool.query(`
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL, 
                phone VARCHAR(20),
                role ENUM('rider', 'driver') NOT NULL,
                profile_image VARCHAR(500) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 4. CREATE DRIVERS TABLE
        console.log("🔨 Creating 'drivers' table...");
        await promisePool.query(`
            CREATE TABLE drivers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                car_model VARCHAR(50),
                car_plate VARCHAR(20),
                license_number VARCHAR(50),
                status ENUM('online', 'offline', 'busy') DEFAULT 'offline',
                lat DECIMAL(10, 8),
                lng DECIMAL(11, 8),
                rating DECIMAL(3, 1) DEFAULT 5.0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 5. CREATE BOOKINGS TABLE (Added 'payment_status')
        console.log("🔨 Creating 'bookings' table...");
        await promisePool.query(`
            CREATE TABLE bookings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rider_id INT NOT NULL,
                driver_id INT,
                pickup_lat DECIMAL(10, 8),
                pickup_lng DECIMAL(11, 8),
                drop_lat DECIMAL(10, 8),
                drop_lng DECIMAL(11, 8),
                pickup_address VARCHAR(255),
                drop_address VARCHAR(255),
                fare DECIMAL(10, 2),
                status ENUM('pending', 'accepted', 'ongoing', 'completed', 'cancelled') DEFAULT 'pending',
                payment_status ENUM('pending', 'paid') DEFAULT 'pending',
                otp VARCHAR(6),
                start_time DATETIME DEFAULT NULL,
                end_time DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (rider_id) REFERENCES users(id),
                FOREIGN KEY (driver_id) REFERENCES drivers(id)
            )
        `);

        // 6. RE-ENABLE FOREIGN KEYS
        await promisePool.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log("✅ Database Successfully Rebuilt! You can now restart your server.");
        process.exit();

    } catch (err) {
        console.error("❌ Error rebuilding database:", err);
        process.exit(1);
    }
};

rebuildDatabase();