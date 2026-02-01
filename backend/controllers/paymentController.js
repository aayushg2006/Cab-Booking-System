const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../config/db');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 1. Create Order (Called when rider clicks "Pay Online")
exports.createOrder = async (req, res) => {
    const { bookingId, amount } = req.body; // amount is in Rupees

    if (!amount || !bookingId) {
        return res.status(400).json({ error: "Booking ID and Amount required" });
    }

    const options = {
        amount: Math.round(amount * 100), // Convert to Paisa (Integer)
        currency: "INR",
        receipt: `booking_${bookingId}`,
        payment_capture: 1 // Auto-capture
    };

    try {
        const order = await razorpay.orders.create(options);
        res.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount, // in paisa
            keyId: process.env.RAZORPAY_KEY_ID // Send Key to Frontend
        });
    } catch (error) {
        console.error("Razorpay Create Order Error:", error);
        res.status(500).json({ error: "Could not create Razorpay order" });
    }
};

// 2. Verify Payment (Called after payment succeeds on Frontend)
exports.verifyPayment = (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

    // Create the expected signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

    if (expectedSignature === razorpay_signature) {
        // ✅ Signature Matches -> Payment Genuine
        
        // Update DB: Mark as Paid & Online
        const sql = `UPDATE bookings SET payment_status = 'paid', payment_mode = 'online' WHERE id = ?`;
        
        pool.query(sql, [bookingId], (err) => {
            if (err) {
                console.error("DB Update Error:", err);
                return res.status(500).json({ error: "Payment verified but DB update failed" });
            }
            res.json({ status: "success", message: "Payment Verified and Updated" });
        });

    } else {
        // ❌ Signature Mismatch -> Hack Attempt?
        res.status(400).json({ status: "failure", message: "Invalid Signature" });
    }
};