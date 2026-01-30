const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 🛠️ FIX 1: Add 'role' to the token payload
const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
};

// @desc    Register new user
exports.register = async (req, res) => {
    const { name, email, phone, password, role, car_model, car_plate, license_number } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ error: 'Please provide all required fields' });
    }

    try {
        // 1. Check if user exists
        const [existingUsers] = await pool.promise().query(
            'SELECT * FROM users WHERE email = ? OR phone = ?', 
            [email, phone]
        );
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Insert into USERS table
        const [userResult] = await pool.promise().query(
            `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
            [name, email, phone, hashedPassword, role || 'rider']
        );
        
        const userId = userResult.insertId;
        let newDriverId = null;

        // 4. If Driver, Insert into DRIVERS table
        if (role === 'driver') {
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
                email, 
                role: role || 'rider',
                driverId: newDriverId 
            },
            // 🛠️ FIX 2: Pass role to generator
            token: generateToken(userId, role || 'rider') 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during registration' });
    }
};

// @desc    Login user
exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await pool.promise().query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // If driver, get their driver ID too
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
            // 🛠️ FIX 3: Pass role to generator
            token: generateToken(user.id, user.role) 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};