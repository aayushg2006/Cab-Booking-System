require('dotenv').config();
const pool = require('./config/db');

async function fixDatabase() {
    console.log("🔧 Updating Database Schema...");

    const queries = [
        // 1. Add OTP Column (Fixes your current error)
        `ALTER TABLE bookings ADD COLUMN otp VARCHAR(6);`,
        
        // 2. Add Payment Columns (Needed for 'endRide')
        `ALTER TABLE bookings ADD COLUMN payment_status ENUM('pending', 'paid') DEFAULT 'pending';`,
        `ALTER TABLE bookings ADD COLUMN payment_method ENUM('cash', 'wallet') DEFAULT 'cash';`,
        
        // 3. Create Ratings Table (Needed for future steps)
        `CREATE TABLE IF NOT EXISTS ratings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            booking_id INT NOT NULL,
            reviewer_id INT NOT NULL,
            rated_user_id INT NOT NULL,
            stars INT CHECK (stars >= 1 AND stars <= 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES bookings(id),
            FOREIGN KEY (reviewer_id) REFERENCES users(id),
            FOREIGN KEY (rated_user_id) REFERENCES users(id)
        )`
    ];

    for (const query of queries) {
        try {
            await pool.promise().query(query);
            console.log(`✅ Executed: ${query.substring(0, 50)}...`);
        } catch (err) {
            // Ignore error if column already exists
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log(`ℹ️ Skipped: Column already exists.`);
            } else {
                console.error(`❌ Error: ${err.message}`);
            }
        }
    }

    console.log("🎉 Database fix complete!");
    process.exit();
}

fixDatabase();