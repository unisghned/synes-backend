const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

// Memory storage sementara (Idealnya nanti gunakan database seperti MongoDB / Supabase)
const ticketsDB = {};

// Setup Midtrans (Gunakan Process Env atau ganti string-nya di sini)
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'Mid-server-b_pYTptAs4mxn1oAjQdobLoj' 
});

// 1. Endpoint Charge Ticket
app.post('/api/charge-ticket', async (req, res) => {
    try {
        const { order_id, gross_amount, first_name, email, ticket_name } = req.body;

        // Simpan data ke memori
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
            item_details: [{ id: 'TKT-01', price: gross_amount, quantity: 1, name: ticket_name }]
        };

        const transaction = await snap.createTransaction(parameter);
        res.status(200).json({ status: 'success', snap_token: transaction.token });

    } catch (error) {
        console.error("Error charge ticket:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 2. Webhook Midtrans (DIPERBAIKI: Kebal Reset Vercel Serverless)
app.post('/api/midtrans-notification', async (req, res) => {
    try {
        const notification = req.body;
        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
            if (fraudStatus === 'accept' || !fraudStatus) {
                
                // Ambil dari DB memori ATAU rakit dari payload Midtrans kalau DB ke-reset Vercel
                let ticket = ticketsDB[orderId];

                if (!ticket) {
                    ticket = {
                        order_id: orderId,
                        first_name: notification.customer_details?.first_name || 'Pembeli Tiket',
                        email: notification.customer_details?.email,
                        ticket_name: 'Tiket Resmi Synegry',
                        status: 'PAID',
                        used: false
                    };
                    // Simpan kembali ke memori
                    ticketsDB[orderId] = ticket;
                } else {
                    ticket.status = 'PAID';
                }

                // Kirim email jika ada alamat email penerima
                if (ticket.email) {
                    await sendTicketEmail(ticket);
                } else {
                    console.error("Email pembeli tidak ditemukan pada webhook payload!");
                }
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error("Gagal webhook:", err);
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

        let transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER || 'cumabacafypdoang@gmail.com',
                pass: process.env.GMAIL_APP_PASS || 'GANTI_DENGAN_APP_PASSWORD_BARU' 
            }
        });

        let mailOptions = {
            from: '"Synegry Ticket Event" <cumabacafypdoang@gmail.com>',
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
        console.log("Email tiket berhasil dikirim:", info.messageId);
    } catch (error) {
        console.error("Gagal mengirim email tiket:", error);
    }
}

// 4. API Validator Scanner
app.post('/api/validate-ticket', (req, res) => {
    const { order_id } = req.body;
    const ticket = ticketsDB[order_id];

    if (!ticket) {
        return res.status(404).json({ valid: false, message: 'Tiket Tidak Ditemukan dalam Sesi Ini!' });
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
