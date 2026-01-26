require('dotenv').config();
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

async function seed() {
    // 1. Hash a generic password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('password123', salt);

    console.log('🌱 Seeding database...');

    // 2. Create a Rider User
    connection.query(
        `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
        ['Test Rider', 'rider@test.com', '1111111111', hash, 'rider'],
        (err, resRider) => {
            if (err && err.code !== 'ER_DUP_ENTRY') throw err;
            const riderId = resRider ? resRider.insertId : 1; // Assume 1 if duplicate
            console.log(`✅ Rider Created (ID: ${riderId})`);

            // 3. Create a Driver User
            connection.query(
                `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
                ['Test Driver', 'driver@test.com', '2222222222', hash, 'driver'],
                (err, resUser) => {
                    if (err && err.code !== 'ER_DUP_ENTRY') throw err;
                    const userId = resUser ? resUser.insertId : 2; // Assume 2 if duplicate

                    // 4. Create the Driver Profile (Links to User)
                    connection.query(
                        `INSERT INTO drivers (user_id, license_number, car_model, car_plate, is_online) VALUES (?, ?, ?, ?, ?)`,
                        [userId, 'MH-02-AB-1234', 'Toyota Etios', 'MH02AB1234', true],
                        (err, resDriver) => {
                            if (err) console.log('⚠️ Driver profile might already exist');
                            
                            const driverId = resDriver ? resDriver.insertId : 1; 
                            console.log(`✅ Driver Created (ID: ${driverId}) - User ID: ${userId}`);
                            console.log('------------------------------------------------');
                            console.log(`📝 USE THESE IDs FOR TESTING:`);
                            console.log(`   Rider ID: ${riderId}`);
                            console.log(`   Driver ID: ${driverId}`);
                            console.log('------------------------------------------------');
                            connection.end();
                        }
                    );
                }
            );
        }
    );
}

seed();