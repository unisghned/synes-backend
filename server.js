const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

const ticketsDB = {};

// PASTE URL GOOGLE APPS SCRIPT KAMU DI SINI
const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbx_iSdKzaCbtlHbWBILKUCavoCJJgn3vMrCbz_YgWxR4fs6iaYuo_pw5TC86SNp-jF3/exec';

// Setup Midtrans
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-b_pYTptAs4mxn1oAjQdobLoj' // Pastikan Server Key kamu benar
});

// 1. Endpoint Charge Ticket
app.post('/api/charge-ticket', async (req, res) => {
    try {
        const { order_id, gross_amount, first_name, email, ticket_name } = req.body;

        // Simpan ke DB sementara
        ticketsDB[order_id] = {
            order_id,
            first_name,
            email,
            ticket_name,
            status: 'PENDING',
            used: false
        };

        const parameter = {
            transaction_details: { order_id, gross_amount },
            customer_details: { first_name, email },
            item_details: [{ id: 'TKT-01', price: gross_amount, quantity: 1, name: ticket_name }],
            // SIMPAN DATA KUNCI DI CUSTOM EXPIRY / METADATA BIAR AMAN DARI RESET MEMORI
            custom_field1: email,
            custom_field2: first_name,
            custom_field3: ticket_name
        };

        const transaction = await snap.createTransaction(parameter);
        res.status(200).json({ status: 'success', snap_token: transaction.token });

    } catch (error) {
        console.error("Error charge:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 2. Webhook Midtrans
app.post('/api/midtrans-notification', async (req, res) => {
    console.log("--> WEBHOOK MIDTRANS DITERIMA! Payload:", JSON.stringify(req.body));
    
    try {
        const notification = req.body;
        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
            if (fraudStatus === 'accept' || !fraudStatus) {
                
                // Ambil data email dari memory ATAU dari custom_field Midtrans
                let recipientEmail = ticketsDB[orderId]?.email || notification.custom_field1;
                let recipientName = ticketsDB[orderId]?.first_name || notification.custom_field2 || 'Pelanggan';
                let ticketName = ticketsDB[orderId]?.ticket_name || notification.custom_field3 || 'Tiket Event';

                if (ticketsDB[orderId]) {
                    ticketsDB[orderId].status = 'PAID';
                }

                console.log(`Mengirim email ke: ${recipientEmail} untuk order: ${orderId}`);

                if (recipientEmail) {
                    await sendTicketEmail({
                        order_id: orderId,
                        first_name: recipientName,
                        email: recipientEmail,
                        ticket_name: ticketName
                    });
                } else {
                    console.error("GAGAL: Email penerima kosong!");
                }
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error("Gagal diproses webhook:", err);
        res.status(500).send('Error');
    }
});

// 3. Fungsi Kirim Email Tiket
async function sendTicketEmail(ticket) {
    try {
        const qrCodeBuffer = await QRCode.toBuffer(JSON.stringify({
            order_id: ticket.order_id,
            ticket_name: ticket.ticket_name,
            name: ticket.first_name
        }));

        // Pake Port 465 SSL resmi Gmail (Jauh lebih cepat di Vercel Serverless)
        let transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, 
            auth: {
                user: 'cumabacafypdoang@gmail.com', 
                pass: 'uvuehmncmucmtrfs' // Ganti dengan App Password baru kamu jika sudah direvoke
            }
        });

        let mailOptions = {
            from: '"Synesthesia Ticket Event" <cumabacafypdoang@gmail.com>',
            to: ticket.email,
            subject: `[E-Ticket Resmi] Pembayaran Berhasil - ${ticket.order_id}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                    <h2 style="color: #4F46E5; text-align: center; margin-bottom: 5px;">E-TICKET RESMI</h2>
                    <p style="text-align: center; color: #64748b; margin-top: 0;">Synegry Event</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 15px 0;">
                    
                    <p>Halo <b>${ticket.first_name}</b>,</p>
                    <p>Terima kasih! Pembayaran tiket kamu telah kami terima dan dikonfirmasi.</p>
                    
                    <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
                        <tr><td style="padding: 6px 0; color: #475569;"><b>ID Pesanan</b></td><td>: ${ticket.order_id}</td></tr>
                        <tr><td style="padding: 6px 0; color: #475569;"><b>Jenis Tiket</b></td><td>: ${ticket.ticket_name}</td></tr>
                        <tr><td style="padding: 6px 0; color: #475569;"><b>Status Pembayaran</b></td><td>: <span style="color:#16a34a; font-weight:bold;">LUNAS</span></td></tr>
                    </table>

                    <div style="text-align: center; background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin-top:0; font-weight:bold; color: #1e293b;">Scan QR Code ini di pintu masuk:</p>
                        <img src="cid:qrcode_ticket" alt="QR Code Ticket" style="width: 200px; height: 200px; border: 4px solid #ffffff; border-radius: 8px;"/>
                    </div>

                    <p style="font-size: 12px; color: #94a3b8; text-align: center;">Tunjukkan email ini / Screenshot QR Code saat memasuki area venue.</p>
                </div>
            `,
            attachments: [{
                filename: 'qrcode.png',
                content: qrCodeBuffer,
                cid: 'qrcode_ticket'
            }]
        };

        let info = await transporter.sendMail(mailOptions);
        console.log("SUCCESS! Email tiket terkirim ke:", ticket.email, "MessageID:", info.messageId);
    } catch (error) {
        console.error("ERROR SENDING EMAIL:", error);
    }
}

// 4. API Validator Scanner
app.post('/api/validate-ticket', (req, res) => {
    const { order_id } = req.body;
    const ticket = ticketsDB[order_id];

    if (!ticket) {
        return res.status(404).json({ valid: false, message: 'Tiket Tidak Ditemukan!' });
    }

    if (ticket.status !== 'PAID') {
        return res.status(400).json({ valid: false, message: 'Tiket Belum Dibayar!' });
    }

    if (ticket.used) {
        return res.status(400).json({ valid: false, message: 'Tiket SUDAH Pernah Di-scan!' });
    }

    ticket.used = true;
    return res.status(200).json({
        valid: true,
        message: 'Tiket Valid!',
        data: {
            nama: ticket.first_name,
            jenis_tiket: ticket.ticket_name,
            order_id: ticket.order_id
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
