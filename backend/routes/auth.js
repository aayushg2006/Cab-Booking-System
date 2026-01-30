const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');

// Debugging check (prints to terminal if imports fail)
if (!register || !login) {
    console.error("❌ Auth Controller Import Failed! Check exports in authController.js");
}

router.post('/register', register);
router.post('/login', login);

module.exports = router;