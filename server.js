const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const app = express();

// WAJIB: Biar frontend kamu gak terblokir CORS!
app.use(cors());
app.use(express.json());

// Inisialisasi Midtrans Snap
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-b_pYTptAs4mxn1oAjQdobLoj' // Ganti Server Key Sandbox kamu
});

// Endpoint yang dipanggil oleh ticket.html
app.post('/api/charge-ticket', async (req, res) => {
    try {
        const { order_id, gross_amount, first_name, email, ticket_name } = req.body;

        const parameter = {
            transaction_details: {
                order_id: order_id,
                gross_amount: gross_amount
            },
            customer_details: {
                first_name: first_name,
                email: email
            },
            item_details: [{
                id: 'TICKET-01',
                price: gross_amount,
                quantity: 1,
                name: ticket_name
            }]
        };

        const transaction = await snap.createTransaction(parameter);
        
        res.status(200).json({
            status: 'success',
            snap_token: transaction.token
        });

    } catch (error) {
        console.error('Error Midtrans:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Port untuk lokal & Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
