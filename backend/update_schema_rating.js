const pool = require('./config/db');

const updateSchema = async () => {
    try {
        const promisePool = pool.promise();
        console.log("⏳ Adding Rating Columns...");

        // Add 'rating' and 'review' to bookings
        await promisePool.query(`
            ALTER TABLE bookings
            ADD COLUMN rating INT DEFAULT NULL,
            ADD COLUMN review TEXT DEFAULT NULL
        `);

        console.log("✅ Schema Updated! Added rating columns.");
        process.exit();
    } catch (err) {
        console.log("⚠️ Columns likely exist:", err.message);
        process.exit(1);
    }
};

updateSchema();