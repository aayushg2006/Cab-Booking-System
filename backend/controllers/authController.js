const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @desc    Register new user (Rider or Driver)
// @route   POST /api/auth/register
exports.registerUser = async (req, res) => {
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

        // 4. If Driver, Insert into DRIVERS table
        if (role === 'driver') {
            if (!car_model || !car_plate || !license_number) {
                return res.status(400).json({ error: 'Drivers must provide car details and license number' });
            }

            await pool.promise().query(
                `INSERT INTO drivers (user_id, car_model, car_plate, license_number, is_online) VALUES (?, ?, ?, ?, ?)`,
                [userId, car_model, car_plate, license_number, false] 
            );
        }

        res.status(201).json({
            message: 'Registration successful',
            user: { id: userId, name, email, role: role || 'rider' },
            token: generateToken(userId)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during registration' });
    }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.loginUser = async (req, res) => {
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
            token: generateToken(user.id)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};