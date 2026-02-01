const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
};

// @desc    Register new user
exports.register = async (req, res) => {
    // 1. Get pushToken from body
    const { name, email, phone, password, role, car_model, car_plate, license_number, pushToken } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ error: 'Please provide all required fields' });
    }

    try {
        const [existingUsers] = await pool.promise().query('SELECT * FROM users WHERE email = ? OR phone = ?', [email, phone]);
        if (existingUsers.length > 0) return res.status(400).json({ error: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 2. Insert with push_token
        const [userResult] = await pool.promise().query(
            `INSERT INTO users (name, email, phone, password_hash, role, push_token) VALUES (?, ?, ?, ?, ?, ?)`,
            [name, email, phone, hashedPassword, role || 'rider', pushToken || null]
        );
        
        const userId = userResult.insertId;
        let newDriverId = null;

        if (role === 'driver') {
            const [driverResult] = await pool.promise().query(
                `INSERT INTO drivers (user_id, car_model, car_plate, license_number, status) VALUES (?, ?, ?, ?, 'offline')`,
                [userId, car_model || 'Unknown', car_plate || 'Unknown', license_number || 'Unknown'] 
            );
            newDriverId = driverResult.insertId;
        }

        res.status(201).json({
            message: 'Registration successful',
            user: { id: userId, name, email, role: role || 'rider', driverId: newDriverId },
            token: generateToken(userId, role || 'rider')
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

// @desc    Login user
exports.login = async (req, res) => {
    // 1. Get pushToken from body
    const { email, password, pushToken } = req.body;

    try {
        const [users] = await pool.promise().query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        // 2. UPDATE push_token on Login (Important! Token might change)
        if (pushToken) {
            await pool.promise().query('UPDATE users SET push_token = ? WHERE id = ?', [pushToken, user.id]);
        }

        let driverInfo = null;
        if (user.role === 'driver') {
            const [drivers] = await pool.promise().query('SELECT * FROM drivers WHERE user_id = ?', [user.id]);
            if (drivers.length > 0) driverInfo = drivers[0];
        }

        res.json({
            message: 'Login successful',
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                role: user.role,
                driverId: driverInfo ? driverInfo.id : null 
            },
            token: generateToken(user.id, user.role)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};