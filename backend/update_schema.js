const pool = require('./config/db');

const updateSchema = async () => {
    try {
        const promisePool = pool.promise();
        console.log("⏳ Updating Schema...");

        // Add 'rejected_drivers' column to store IDs like [1, 4, 7]
        await promisePool.query(`
            ALTER TABLE bookings
            ADD COLUMN rejected_drivers JSON DEFAULT NULL
        `);

        console.log("✅ Schema Updated! Added 'rejected_drivers' column.");
        process.exit();
    } catch (err) {
        // If error is "Duplicate column", it's fine
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log("⚠️ Column already exists. Skipping.");
        } else {
            console.error("❌ Error updating schema:", err);
        }
        process.exit(1);
    }
};

updateSchema();