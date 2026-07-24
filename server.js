const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const app = express();

// Keamanan CORS & Parser Data JSON
app.use(cors());
app.use(express.json());

// Inisialisasi Midtrans Snap SDK
const snap = new midtransClient.Snap({
    isProduction: false, // Set false untuk Mode Sandbox (Uji Coba)
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-YOUR_SERVER_KEY_HERE', // Server Key Midtrans
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-YOUR_CLIENT_KEY_HERE'   // Client Key Midtrans
});

// Endpoint API untuk Minta Token Transaksi
app.post('/api/charge-ticket', async (req, res) => {
    try {
        const { order_id, gross_amount, first_name, email, phone, ticket_name } = req.body;

        const parameter = {
            transaction_details: {
                order_id: order_id,
                gross_amount: parseInt(gross_amount)
            },
            customer_details: {
                first_name: first_name,
                email: email,
                phone: phone
            },
            item_details: [{
                id: 'TICKET-01',
                price: parseInt(gross_amount),
                quantity: 1,
                name: ticket_name
            }]
        };

        // Minta Snap Token dari Midtrans
        const transaction = await snap.createTransaction(parameter);
        
        // Kirimkan snap_token balik ke Frontend
        res.json({
            status: 'success',
            snap_token: transaction.token
        });

    } catch (error) {
        console.error('Midtrans Error:', error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Jalankan Server di Port 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend Midtrans berhasil berjalan di http://localhost:${PORT}`);
});