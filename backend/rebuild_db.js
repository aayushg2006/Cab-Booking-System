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
        await promisePool.query('DROP TABLE IF EXISTS saved_places');
        await promisePool.query('DROP TABLE IF EXISTS promotion_redemptions');
        await promisePool.query('DROP TABLE IF EXISTS bookings');
        await promisePool.query('DROP TABLE IF EXISTS promotions');
        await promisePool.query('DROP TABLE IF EXISTS ratings');
        await promisePool.query('DROP TABLE IF EXISTS transactions');
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
                car_type ENUM('hatchback', 'sedan', 'suv') DEFAULT 'sedan',
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
                payment_mode ENUM('cash', 'online') DEFAULT 'cash',
                car_type ENUM('hatchback', 'sedan', 'suv') DEFAULT 'sedan',
                otp VARCHAR(6),
                rejected_drivers JSON DEFAULT NULL,
                rating TINYINT DEFAULT NULL,
                review TEXT DEFAULT NULL,
                sos_alert BOOLEAN DEFAULT FALSE,
                cancellation_reason VARCHAR(255) DEFAULT NULL,
                cancelled_by_role ENUM('rider', 'driver') DEFAULT NULL,
                cancelled_at DATETIME DEFAULT NULL,
                start_time DATETIME DEFAULT NULL,
                end_time DATETIME DEFAULT NULL,
                scheduled_for DATETIME DEFAULT NULL,
                promo_code VARCHAR(40) DEFAULT NULL,
                original_fare DECIMAL(10,2) DEFAULT NULL,
                discount_amount DECIMAL(10,2) DEFAULT 0,
                ride_preferences JSON DEFAULT NULL,
                special_instructions VARCHAR(255) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (rider_id) REFERENCES users(id),
                FOREIGN KEY (driver_id) REFERENCES drivers(id)
            )
        `);

        console.log("🔨 Creating 'saved_places' table...");
        await promisePool.query(`
            CREATE TABLE saved_places (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                label VARCHAR(30) NOT NULL,
                address VARCHAR(255) NOT NULL,
                lat DECIMAL(10,8) NOT NULL,
                lng DECIMAL(11,8) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_saved_place_user_label (user_id, label),
                INDEX idx_saved_place_user (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log("🔨 Creating 'promotions' table...");
        await promisePool.query(`
            CREATE TABLE promotions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(40) NOT NULL UNIQUE,
                title VARCHAR(120) DEFAULT NULL,
                description VARCHAR(255) DEFAULT NULL,
                discount_type ENUM('flat', 'percent') NOT NULL DEFAULT 'flat',
                discount_value DECIMAL(10,2) NOT NULL,
                max_discount DECIMAL(10,2) DEFAULT NULL,
                min_fare DECIMAL(10,2) DEFAULT 0,
                usage_limit_total INT DEFAULT NULL,
                usage_limit_per_user INT DEFAULT 1,
                active BOOLEAN DEFAULT TRUE,
                starts_at DATETIME DEFAULT NULL,
                ends_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log("🔨 Creating 'promotion_redemptions' table...");
        await promisePool.query(`
            CREATE TABLE promotion_redemptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                promotion_id INT NOT NULL,
                user_id INT NOT NULL,
                booking_id INT DEFAULT NULL,
                discount_amount DECIMAL(10,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_promo_redemption_promo_user (promotion_id, user_id),
                INDEX idx_promo_redemption_booking (booking_id),
                FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
            )
        `);

        console.log("🌱 Seeding default promotions...");
        await promisePool.query(`
            INSERT INTO promotions
                (code, title, description, discount_type, discount_value, max_discount, min_fare, usage_limit_total, usage_limit_per_user, active, starts_at, ends_at)
            VALUES
                ('WELCOME50', 'Welcome Offer', 'Flat discount for first trip', 'flat', 50, NULL, 120, NULL, 1, TRUE, NULL, NULL),
                ('SAVE20', 'Save 20%', 'Percentage discount for everyday rides', 'percent', 20, 120, 200, NULL, 3, TRUE, NULL, NULL),
                ('NIGHT100', 'Night Rider', 'Late evening flat discount', 'flat', 100, NULL, 250, NULL, 2, TRUE, NULL, NULL)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                description = VALUES(description),
                discount_type = VALUES(discount_type),
                discount_value = VALUES(discount_value),
                max_discount = VALUES(max_discount),
                min_fare = VALUES(min_fare),
                usage_limit_total = VALUES(usage_limit_total),
                usage_limit_per_user = VALUES(usage_limit_per_user),
                active = VALUES(active)
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
