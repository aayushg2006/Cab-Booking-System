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

const indexExists = async (tableName, indexName) => {
    const [rows] = await promisePool.query(
        `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
        [tableName, indexName]
    );
    return rows.length > 0;
};

const ensureIndex = async (tableName, indexName, columnsSql) => {
    const exists = await indexExists(tableName, indexName);
    if (exists) return;

    await promisePool.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columnsSql})`);
    console.log(`[schema] Added index ${tableName}.${indexName}`);
};

const ensureSchema = async () => {
    try {
        const usersExists = await tableExists('users');
        const driversExists = await tableExists('drivers');
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

        if (driversExists) {
            await ensureColumn('drivers', 'car_type', "ENUM('hatchback', 'sedan', 'suv') DEFAULT 'sedan'");
            await ensureIndex('drivers', 'idx_drivers_status', 'status');
            await ensureIndex('drivers', 'idx_drivers_status_cartype', 'status, car_type');
        }

        if (bookingsExists) {
            await ensureColumn('bookings', 'payment_status', "ENUM('pending', 'paid') DEFAULT 'pending'");
            await ensureColumn('bookings', 'payment_mode', "ENUM('cash', 'online') DEFAULT 'cash'");
            await ensureColumn('bookings', 'car_type', "ENUM('hatchback', 'sedan', 'suv') DEFAULT 'sedan'");
            await ensureColumn('bookings', 'rejected_drivers', 'JSON DEFAULT NULL');
            await ensureColumn('bookings', 'rating', 'TINYINT DEFAULT NULL');
            await ensureColumn('bookings', 'review', 'TEXT DEFAULT NULL');
            await ensureColumn('bookings', 'sos_alert', 'BOOLEAN DEFAULT FALSE');
            await ensureColumn('bookings', 'cancellation_reason', 'VARCHAR(255) DEFAULT NULL');
            await ensureColumn('bookings', 'cancelled_by_role', "ENUM('rider', 'driver') DEFAULT NULL");
            await ensureColumn('bookings', 'cancelled_at', 'DATETIME DEFAULT NULL');
            await ensureColumn('bookings', 'start_time', 'DATETIME DEFAULT NULL');
            await ensureColumn('bookings', 'end_time', 'DATETIME DEFAULT NULL');
            await ensureColumn('bookings', 'scheduled_for', 'DATETIME DEFAULT NULL');
            await ensureColumn('bookings', 'promo_code', 'VARCHAR(40) DEFAULT NULL');
            await ensureColumn('bookings', 'original_fare', 'DECIMAL(10,2) DEFAULT NULL');
            await ensureColumn('bookings', 'discount_amount', 'DECIMAL(10,2) DEFAULT 0');
            await ensureColumn('bookings', 'ride_preferences', 'JSON DEFAULT NULL');
            await ensureColumn('bookings', 'special_instructions', 'VARCHAR(255) DEFAULT NULL');
            await ensureIndex('bookings', 'idx_bookings_status', 'status');
            await ensureIndex('bookings', 'idx_bookings_driver_status', 'driver_id, status');
            await ensureIndex('bookings', 'idx_bookings_rider_created', 'rider_id, created_at');
            await ensureIndex('bookings', 'idx_bookings_scheduled_status', 'status, scheduled_for');
        }

        if (usersExists) {
            await promisePool.query(`
                CREATE TABLE IF NOT EXISTS saved_places (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    label VARCHAR(30) NOT NULL,
                    address VARCHAR(255) NOT NULL,
                    lat DECIMAL(10,8) NOT NULL,
                    lng DECIMAL(11,8) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_saved_place_user_label (user_id, label),
                    INDEX idx_saved_place_user (user_id),
                    CONSTRAINT fk_saved_places_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await promisePool.query(`
                CREATE TABLE IF NOT EXISTS promotions (
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

            await promisePool.query(`
                CREATE TABLE IF NOT EXISTS promotion_redemptions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    promotion_id INT NOT NULL,
                    user_id INT NOT NULL,
                    booking_id INT DEFAULT NULL,
                    discount_amount DECIMAL(10,2) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_promo_redemption_promo_user (promotion_id, user_id),
                    INDEX idx_promo_redemption_booking (booking_id),
                    CONSTRAINT fk_promo_redemptions_promotion FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
                    CONSTRAINT fk_promo_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            if (bookingsExists) {
                await promisePool.query(`
                    ALTER TABLE promotion_redemptions
                    ADD CONSTRAINT fk_promo_redemptions_booking
                    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
                `).catch(() => {});
            }

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
        }
    } catch (error) {
        console.error('[schema] Auto-migration warning:', error.message);
    }
};

module.exports = { ensureSchema };
