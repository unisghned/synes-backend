const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

// URL Google Apps Script Web App Kamu
const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbx_iSdKzaCbtlHbWBILKUCavoCJJgn3vMrCbz_YgWxR4fs6iaYuo_pw5TC86SNp-jF3/exec';

// Setup Midtrans
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-b_pYTptAs4mxn1oAjQdobLoj'
});

// 1. Endpoint Charge Ticket
app.post('/api/charge-ticket', async (req, res) => {
    try {
        const { order_id, gross_amount, first_name, email, ticket_name } = req.body;

        const parameter = {
            transaction_details: { order_id, gross_amount },
            customer_details: { first_name, email },
            item_details: [{ id: 'TKT-01', price: gross_amount, quantity: 1, name: ticket_name }],
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

// 2. Webhook Midtrans (Kirim Data ke Google Sheets + Kirim Email E-Ticket)
app.post('/api/midtrans-notification', async (req, res) => {
    console.log("--> WEBHOOK MIDTRANS DITERIMA! Payload:", JSON.stringify(req.body));
    
    try {
        const notification = req.body;
        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
            if (fraudStatus === 'accept' || !fraudStatus) {
                
                const recipientEmail = notification.custom_field1;
                const recipientName = notification.custom_field2 || 'Pelanggan';
                const ticketName = notification.custom_field3 || 'Tiket Event';

                console.log(`[1/2] Mengirim data order ${orderId} ke Google Sheets...`);
                
                // 🔥 A. SIMPAN DATA KE GOOGLE SHEETS
                try {
                    await fetch(GOOGLE_SHEETS_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'add_ticket',
                            order_id: orderId,
                            first_name: recipientName,
                            email: recipientEmail,
                            ticket_name: ticketName
                        }),
                        redirect: 'follow'
                    });
                    console.log("✅ Data berhasil masuk ke Google Sheets!");
                } catch (sheetErr) {
                    console.error("❌ Gagal simpan ke Google Sheets:", sheetErr);
                }

                // 🔥 B. KIRIM EMAIL TIKET
                if (recipientEmail) {
                    console.log(`[2/2] Mengirim email e-ticket ke: ${recipientEmail}`);
                    await sendTicketEmail({
                        order_id: orderId,
                        first_name: recipientName,
                        email: recipientEmail,
                        ticket_name: ticketName
                    });
                } else {
                    console.error("❌ GAGAL: Email penerima kosong!");
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

        let transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, 
            auth: {
                user: 'cumabacafypdoang@gmail.com', 
                pass: 'uvuehmncmucmtrfs'
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
