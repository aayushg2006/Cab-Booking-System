require('dotenv').config();
const mysql = require('mysql2');

// Connect to the database
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

connection.connect((err) => {
    if (err) {
        console.error('❌ Connection failed:', err);
        return;
    }
    console.log('✅ Connected to database. Creating tables...');
    createTables();
});

function createTables() {
    const queries = [
        // 1. Create Users Table
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            phone VARCHAR(15) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('rider', 'driver', 'admin') DEFAULT 'rider',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // 2. Create Drivers Table (Linked to Users)
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

        // 3. Create Bookings Table
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
            status ENUM('pending', 'accepted', 'ongoing', 'completed', 'cancelled') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (rider_id) REFERENCES users(id),
            FOREIGN KEY (driver_id) REFERENCES drivers(id)
        )`
    ];

    let completed = 0;
    queries.forEach((query, index) => {
        connection.query(query, (err, result) => {
            if (err) {
                console.error(`❌ Error creating table ${index + 1}:`, err.message);
            } else {
                console.log(`✅ Table ${index + 1} created/verified successfully.`);
            }
            
            completed++;
            if (completed === queries.length) {
                console.log('🎉 All tables setup complete!');
                connection.end(); // Close connection
            }
        });
    });
}