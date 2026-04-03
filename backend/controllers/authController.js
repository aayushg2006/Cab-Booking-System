const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const generateToken = (id, role) => {
    return jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '30d' });
};

const insertUser = async ({ name, email, phone, hashedPassword, role }) => {
    try {
        const [result] = await pool
            .promise()
            .query(
                `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
                [name, email, phone, hashedPassword, role]
            );

        return result;
    } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
            const [result] = await pool
                .promise()
                .query(
                    `INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)`,
                    [name, email, phone, hashedPassword, role]
                );

            return result;
        }

        throw err;
    }
};

exports.register = async (req, res) => {
    const { name, email, phone, password, role, car_model, car_plate, license_number } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ error: 'Please provide all required fields' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = role || 'rider';

    try {
        const [existingUsers] = await pool
            .promise()
            .query('SELECT id FROM users WHERE email = ? OR phone = ?', [normalizedEmail, phone]);

        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userResult = await insertUser({
            name,
            email: normalizedEmail,
            phone,
            hashedPassword,
            role: normalizedRole,
        });

        const userId = userResult.insertId;
        let newDriverId = null;

        if (normalizedRole === 'driver') {
            const [driverResult] = await pool.promise().query(
                `INSERT INTO drivers (user_id, car_model, car_plate, license_number, status) VALUES (?, ?, ?, ?, 'offline')`,
                [userId, car_model || 'Unknown', car_plate || 'Unknown', license_number || 'Unknown']
            );
            newDriverId = driverResult.insertId;
        }

        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: userId,
                name,
                email: normalizedEmail,
                role: normalizedRole,
                driverId: newDriverId,
            },
            token: generateToken(userId, normalizedRole),
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    try {
        const [users] = await pool.promise().query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (users.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

        const user = users[0];
        const storedHash = user.password_hash || user.password;

        if (!storedHash) {
            return res.status(500).json({ error: 'Account data is invalid. Please reset this user.' });
        }

        const isMatch = await bcrypt.compare(password, storedHash);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        let driverInfo = null;
        if (user.role === 'driver') {
            const [drivers] = await pool.promise().query('SELECT id FROM drivers WHERE user_id = ?', [user.id]);
            if (drivers.length > 0) driverInfo = drivers[0];
        }

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverId: driverInfo ? driverInfo.id : null,
            },
            token: generateToken(user.id, user.role),
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
