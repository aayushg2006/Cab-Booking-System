const pool = require('./config/db');

console.log("🛠️ Fixing Database Schema...");

const queries = [
    // 1. Add start_time if missing
    `ALTER TABLE bookings ADD COLUMN start_time DATETIME DEFAULT NULL;`,
    
    // 2. Add end_time if missing
    `ALTER TABLE bookings ADD COLUMN end_time DATETIME DEFAULT NULL;`
];

const runQueries = async () => {
    for (const sql of queries) {
        await new Promise((resolve) => {
            pool.query(sql, (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_FIELDNAME') {
                        console.log("⚠️ Column already exists (Skipping).");
                    } else {
                        console.log("❌ Error:", err.message);
                    }
                } else {
                    console.log("✅ Column added successfully!");
                }
                resolve();
            });
        });
    }
    console.log("🎉 Database fixed! You can now start rides.");
    process.exit();
};

runQueries();