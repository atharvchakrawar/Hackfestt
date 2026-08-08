const express = require('express');
const { completePayment, completeDevPayment, verifyWebhookSignature, setPaymentReceiptUrl } = require('../services/payment');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');
const { finalizeRegistration } = require('../services/registration');
const { getEventApprovalMode } = require('../services/settings');
const { generateOrganizerReceiptPdf } = require('../services/receipt');
const { sendOrganizerReceiptEmail } = require('../services/email');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();

function parseMetadata(metadata) {
  if (!metadata) return {};
  return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
}

async function finalizeRegistrationPayment(payment) {
  const regResult = await query(
    `SELECT r.*, u.name AS student_name, u.email AS student_email,
            e.id AS event_id, e.name AS event_name, e.event_date, e.venue,
            e.contact_email, e.contact_phone, e.special_instructions
     FROM registrations r
     JOIN users u ON r.student_id = u.id
     JOIN events e ON r.event_id = e.id
     WHERE r.id = $1`,
    [payment.registration_id]
  );
  const row = regResult.rows[0];
  if (!row || ['confirmed', 'free_confirmed'].includes(row.payment_status)) return;

  const members = await query('SELECT name, email, college FROM team_members WHERE registration_id = $1', [payment.registration_id]);
  await finalizeRegistration({
    registrationId: payment.registration_id,
    transactionId: payment.transaction_id,
    amount: payment.amount,
    studentName: row.student_name,
    studentEmail: row.student_email,
    event: {
      id: row.event_id,
      name: row.event_name,
      event_date: row.event_date,
      venue: row.venue,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      special_instructions: row.special_instructions,
    },
    teamMembers: members.rows,
    college: row.reg_college || '',
  });
}

async function finalizeOrganizerPayment(payment) {
  const eventResult = await query(
    `SELECT e.*, u.name AS organizer_name, u.email AS organizer_email
     FROM events e JOIN users u ON e.organizer_id = u.id
     WHERE e.id = $1`,
    [payment.event_id]
  );
  const event = eventResult.rows[0];
  if (!event) return;

  if (payment.type === 'listing') {
    const approvalMode = await getEventApprovalMode();
    const newStatus = approvalMode === 'active' ? 'active' : 'pending_review';
    await query(
      'UPDATE events SET listing_paid = TRUE, listing_payment_id = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [payment.transaction_id, newStatus, payment.event_id]
    );
  }

  if (payment.type === 'boost') {
    const metadata = parseMetadata(payment.metadata);
    const days = Number(metadata.days || 0);
    if (days > 0) {
      await query(
        `UPDATE events SET is_boosted = TRUE, boost_expiry = NOW() + ($1 || ' days')::interval, updated_at = NOW()
         WHERE id = $2`,
        [days, payment.event_id]
      );
    }
  }

  const receiptBuffer = await generateOrganizerReceiptPdf({
    organizerName: event.organizer_name,
    eventName: event.name,
    paymentType: payment.type === 'boost' ? 'Event Boost' : 'Event Listing',
    amount: payment.amount,
    transactionId: payment.transaction_id,
    timestamp: new Date().toISOString(),
  });
  const receiptUrl = await uploadBuffer(receiptBuffer, `receipts/${payment.type}-${payment.id}.pdf`, 'application/pdf');
  await setPaymentReceiptUrl(payment.id, receiptUrl);
  await sendOrganizerReceiptEmail({
    organizerName: event.organizer_name,
    email: event.organizer_email,
    paymentType: payment.type === 'boost' ? 'Event Boost' : 'Event Listing',
    amount: payment.amount,
    transactionId: payment.transaction_id,
    eventId: payment.event_id,
    receiptBuffer,
  });
}

async function finalizeCompletedPayment(payment) {
  if (payment.type === 'registration') {
    await finalizeRegistrationPayment(payment);
  } else if (['listing', 'boost'].includes(payment.type)) {
    await finalizeOrganizerPayment(payment);
  }
}

/**
 * Verify and complete a Razorpay payment.
 */
router.post('/verify', requireAuth(), async (req, res) => {
  try {
    const { orderId, razorpayPaymentId, signature, devMode } = req.body;

    let payment;
    if (devMode) {
      payment = await completeDevPayment(orderId);
    } else {
      payment = await completePayment({ orderId, razorpayPaymentId, signature });
    }

    res.json({ success: true, payment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Razorpay webhook endpoint for server-side payment finalization.
 */
router.post('/razorpay/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    if (req.body.event !== 'payment.captured') {
      return res.json({ received: true, ignored: req.body.event });
    }

    const entity = req.body.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const razorpayPaymentId = entity?.id;
    if (!orderId || !razorpayPaymentId) return res.status(400).json({ error: 'Invalid payment webhook payload' });

    const result = await query(
      `UPDATE payments SET status = 'completed', razorpay_payment_id = $1, transaction_id = $1
       WHERE razorpay_order_id = $2
       RETURNING *`,
      [razorpayPaymentId, orderId]
    );
    const payment = result.rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    await finalizeCompletedPayment(payment);
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
