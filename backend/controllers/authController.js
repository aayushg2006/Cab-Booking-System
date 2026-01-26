const pool = require('../config/db'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


// Helper function to create Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

// @desc    Register new user
// @route   POST /api/auth/register
exports.registerUser = async (req, res) => {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ error: 'Please provide all fields' });
    }

    try {
        // 1. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 2. Insert User
        const query = `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`;
        
        pool.query(query, [name, email, phone, hashedPassword, role || 'rider'], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Email or Phone already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            
            // 3. Send Response with Token
            res.status(201).json({
                message: 'User registered',
                user: { id: result.insertId, name, email, role: role || 'rider' },
                token: generateToken(result.insertId) 
            });
        });

    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.loginUser = (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT * FROM users WHERE email = ?`;
    pool.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = results[0];

        // Check Password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        if (isMatch) {
            res.json({
                message: 'Login successful',
                user: { id: user.id, name: user.name, email: user.email, role: user.role },
                token: generateToken(user.id)
            });
        } else {
            res.status(400).json({ error: 'Invalid credentials' });
        }
    });
};