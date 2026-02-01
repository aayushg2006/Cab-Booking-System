const pool = require('./config/db');

const updateSchema = async () => {
    try {
        const promisePool = pool.promise();
        console.log("⏳ Adding Push Token Column...");

        // Add 'push_token' to users table
        await promisePool.query(`
            ALTER TABLE users
            ADD COLUMN push_token VARCHAR(255) DEFAULT NULL
        `);

        console.log("✅ Schema Updated! Added 'push_token'.");
        process.exit();
    } catch (err) {
        console.log("⚠️ Column likely already exists or error:", err.message);
        process.exit(1);
    }
};

updateSchema();