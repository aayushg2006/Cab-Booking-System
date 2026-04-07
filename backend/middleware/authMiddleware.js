const jwt = require('jsonwebtoken');
const pool = require('../config/db');

module.exports = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const userId = Number(decoded?.id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ error: 'Invalid token payload' });
        }

        const [rows] = await pool
            .promise()
            .query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [userId]);

        if (!rows || rows.length === 0) {
            return res.status(401).json({ error: 'Session expired. Please login again.' });
        }

        req.user = {
            id: Number(rows[0].id),
            role: rows[0].role,
        };

        next();
    } catch (err) {
        res.status(400).json({ error: 'Invalid token' });
    }
};
