const pool = require('./config/db');

const createTables = `
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        role ENUM('rider', 'driver') NOT NULL,
        profile_image VARCHAR(500) DEFAULT NULL,
        push_token VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drivers (
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
    );

    CREATE TABLE IF NOT EXISTS bookings (
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
        otp VARCHAR(6),
        rejected_drivers JSON DEFAULT NULL,
        rating TINYINT DEFAULT NULL,
        review TEXT DEFAULT NULL,
        sos_alert BOOLEAN DEFAULT FALSE,
        start_time DATETIME DEFAULT NULL,
        end_time DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rider_id) REFERENCES users(id),
        FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );
`;

pool.query(createTables, (err) => {
    if (err) {
        console.error('Error creating tables:', err.message);
        process.exit(1);
    }

    console.log('Tables created/validated successfully.');
    process.exit(0);
});
