const pool = require('../config/db');

const promisePool = pool.promise();

const tableExists = async (tableName) => {
    const [rows] = await promisePool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
        [tableName]
    );
    return rows.length > 0;
};

const columnExists = async (tableName, columnName) => {
    const [rows] = await promisePool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
        [tableName, columnName]
    );
    return rows.length > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
    const exists = await columnExists(tableName, columnName);
    if (exists) return;

    await promisePool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    console.log(`[schema] Added ${tableName}.${columnName}`);
};

const ensureSchema = async () => {
    try {
        const usersExists = await tableExists('users');
        const bookingsExists = await tableExists('bookings');

        if (usersExists) {
            await ensureColumn('users', 'password_hash', 'VARCHAR(255) DEFAULT NULL');
            await ensureColumn('users', 'profile_image', 'VARCHAR(500) DEFAULT NULL');
            await ensureColumn('users', 'push_token', 'VARCHAR(255) DEFAULT NULL');

            const hasLegacyPassword = await columnExists('users', 'password');
            const hasPasswordHash = await columnExists('users', 'password_hash');

            if (hasLegacyPassword && hasPasswordHash) {
                await promisePool.query(
                    `UPDATE users SET password_hash = password WHERE (password_hash IS NULL OR password_hash = '') AND password IS NOT NULL`
                );
            }
        }

        if (bookingsExists) {
            await ensureColumn('bookings', 'payment_status', "ENUM('pending', 'paid') DEFAULT 'pending'");
            await ensureColumn('bookings', 'payment_mode', "ENUM('cash', 'online') DEFAULT 'cash'");
            await ensureColumn('bookings', 'rejected_drivers', 'JSON DEFAULT NULL');
            await ensureColumn('bookings', 'rating', 'TINYINT DEFAULT NULL');
            await ensureColumn('bookings', 'review', 'TEXT DEFAULT NULL');
            await ensureColumn('bookings', 'sos_alert', 'BOOLEAN DEFAULT FALSE');
            await ensureColumn('bookings', 'start_time', 'DATETIME DEFAULT NULL');
            await ensureColumn('bookings', 'end_time', 'DATETIME DEFAULT NULL');
        }
    } catch (error) {
        console.error('[schema] Auto-migration warning:', error.message);
    }
};

module.exports = { ensureSchema };
