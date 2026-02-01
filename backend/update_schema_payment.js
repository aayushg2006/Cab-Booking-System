const pool = require('./config/db');

const updateSchema = async () => {
    try {
        const promisePool = pool.promise();
        console.log("⏳ Adding Payment Mode to Bookings...");

        // Add 'payment_mode' column
        await promisePool.query(`
            ALTER TABLE bookings
            ADD COLUMN payment_mode ENUM('cash', 'online') DEFAULT 'cash'
        `);

        console.log("✅ Schema Updated! Added 'payment_mode'.");
        process.exit();
    } catch (err) {
        console.log("⚠️ Column likely already exists or error:", err.message);
        process.exit(1);
    }
};

updateSchema();