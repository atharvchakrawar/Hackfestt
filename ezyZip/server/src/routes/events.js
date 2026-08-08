const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../db/pool');
const { isOrganizer, isAdmin, requireAuth } = require('../middleware/auth');
const { getBoostPricing, getEventApprovalMode } = require('../services/settings');
const { createOrder, completeDevPayment, completePayment, setPaymentReceiptUrl } = require('../services/payment');
const { generateOrganizerReceiptPdf } = require('../services/receipt');
const { sendOrganizerReceiptEmail } = require('../services/email');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();

const EVENT_TYPES = ['Technical', 'Cultural', 'Sports', 'Workshop', 'Hackathon', 'Seminar', 'Other'];

/**
 * Build filtered events query from URL params.
 * @param {import('express').Request} req
 * @returns {{ sql: string, params: Array, sort: string }}
 */
function buildEventsQuery(req) {
  const params = [];
  let idx = 1;
  let sql = `
    SELECT *
    FROM events
    WHERE events.is_visible = TRUE AND events.status <> 'draft' AND events.status <> 'cancelled'`;

  const college = req.query.college;
  const types = req.query.type ? (Array.isArray(req.query.type) ? req.query.type : req.query.type.split(',')) : [];
  const feeFilter = req.query.fee;
  const search = req.query.search;
  const city = req.query.city;

  if (college) {
    sql += ` AND LOWER(events.college) LIKE LOWER($${idx++})`;
    params.push(`%${college}%`);
  }
  if (city) {
    sql += ` AND LOWER(events.city) LIKE LOWER($${idx++})`;
    params.push(`%${city}%`);
  }
  if (types.length) {
    const placeholders = types.map(() => `$${idx++}`).join(',');
    sql += ` AND events.event_type IN (${placeholders})`;
    params.push(...types);
  }
  if (feeFilter === 'free') {
    sql += ' AND events.is_paid = FALSE';
  } else if (feeFilter === 'paid') {
    sql += ' AND events.is_paid = TRUE';
  }
  if (search) {
    sql += ` AND (LOWER(events.name) LIKE LOWER($${idx}) OR LOWER(events.college) LIKE LOWER($${idx}) OR LOWER(events.city) LIKE LOWER($${idx}))`;
    params.push(`%${search}%`);
    idx++;
  }

  const sort = req.query.sort || 'event_date';
  return { sql, params, sort };
}

function sortEvents(rows, sort) {
  const sorted = [...rows];
  const direction = sort === 'newest' || sort === 'modified' ? -1 : 1;
  const field = sort === 'newest' || sort === 'oldest'
    ? 'created_at'
    : sort === 'modified'
      ? 'updated_at'
      : 'event_date';

  const collegePriority = (college = '') => {
    const value = college.toLowerCase();
    if (value.includes('iit madras')) return 0;
    if (value.includes('iit bombay')) return 1;
    if (value.includes('iit delhi')) return 2;
    if (value.includes('coep')) return 3;
    if (value.includes('vit pune')) return 4;
    if (value.includes('walchand')) return 5;
    return 10;
  };

  sorted.sort((a, b) => {
    const priorityDiff = collegePriority(a.college) - collegePriority(b.college);
    if (priorityDiff !== 0) return priorityDiff;
    if (a.is_boosted !== b.is_boosted) return a.is_boosted ? -1 : 1;
    return direction * (new Date(a[field]).getTime() - new Date(b[field]).getTime());
  });

  return sorted;
}

async function attachOrganizerNames(events) {
  return Promise.all(events.map(async (event) => {
    const organizer = await query('SELECT name FROM users WHERE id = $1', [event.organizer_id]);
    return {
      ...event,
      reg_count: event.current_registrations,
      organizer_name: organizer.rows[0]?.name || 'Organizer',
    };
  }));
}

/** List/filter events (public) */
router.get('/', async (req, res) => {
  try {
    const { sql, params, sort } = buildEventsQuery(req);
    const result = await query(sql, params);
    const events = await attachOrganizerNames(result.rows);
    res.json(sortEvents(events, sort));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get distinct colleges for filter dropdown */
router.get('/colleges', async (_req, res) => {
  try {
    const result = await query(
      `SELECT college FROM events WHERE is_visible = TRUE AND status <> 'draft' AND status <> 'cancelled'`
    );
    const colleges = [...new Set(result.rows.map((r) => r.college).filter(Boolean))].sort();
    res.json(colleges);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get event type options */
router.get('/types', (_req, res) => {
  res.json(EVENT_TYPES);
});

/** Organizer's events — must be before /:id */
router.get('/my/events', isOrganizer, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM events WHERE organizer_id = $1`,
      [req.user.id]
    );
    const events = result.rows
      .map((event) => ({ ...event, reg_count: event.current_registrations }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Organizer analytics — must be before /:id */
router.get('/my/analytics', isOrganizer, async (req, res) => {
  try {
    const orgId = req.user.id;
    const [events, regs, views, confirmed] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM events WHERE organizer_id = $1', [orgId]),
      query('SELECT COUNT(*)::int AS c FROM registrations r JOIN events e ON r.event_id = e.id WHERE e.organizer_id = $1', [orgId]),
      query('SELECT COALESCE(SUM(views),0)::int AS c FROM events WHERE organizer_id = $1', [orgId]),
      query(`SELECT COUNT(*)::int AS c FROM registrations r JOIN events e ON r.event_id = e.id WHERE e.organizer_id = $1 AND r.payment_status IN ('confirmed','free_confirmed')`, [orgId]),
    ]);
    res.json({
      total_events: events.rows[0].c,
      total_registrations: regs.rows[0].c,
      total_views: views.rows[0].c,
      confirmed_registrations: confirmed.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get single event */
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, u.name AS organizer_name, u.email AS organizer_email
       FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Event not found' });
    await query('UPDATE events SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Create and publish an organizer event without charging a platform listing fee. */
router.post('/', isOrganizer, async (req, res) => {
  try {
    const d = req.body;
    const missing = [
      ['name', d.name],
      ['event_type', d.event_type],
      ['college', d.college],
      ['city', d.city],
      ['event_date', d.event_date],
      ['max_registrations', Number(d.max_registrations) > 0 ? d.max_registrations : ''],
    ].filter(([, value]) => !String(value || '').trim());

    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.map(([field]) => field).join(', ')}` });
    }

    const fee = d.is_paid ? (d.registration_fee || 0) : 0;
    const approvalMode = await getEventApprovalMode();
    const newStatus = approvalMode === 'active' ? 'active' : 'pending_review';

    const result = await query(
      `INSERT INTO events (organizer_id, name, event_type, description, college, city, state, venue, mode,
        event_date, end_date, duration_hrs, registration_deadline, min_registrations, max_registrations,
        participation_type, min_team_size, max_team_size, is_paid, registration_fee,
        prize_pool, tracks, contact_email, contact_phone, website_url, special_instructions, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        req.user.id, d.name, d.event_type, d.description, d.college, d.city, d.state, d.venue, d.mode || 'Offline',
        d.event_date, d.end_date, d.duration_hrs, d.registration_deadline, d.min_registrations || null,
        d.max_registrations, d.participation_type || 'individual', d.min_team_size || 1, d.max_team_size || 4,
        !!d.is_paid, fee, d.prize_pool, d.tracks, d.contact_email, d.contact_phone, d.website_url, d.special_instructions,
        newStatus,
      ]
    );

    const event = result.rows[0];
    res.status(201).json({ event, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Complete listing payment and activate event */
router.post('/:id/listing-payment', isOrganizer, async (req, res) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, signature, devMode } = req.body;
    const eventResult = await query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [req.params.id, req.user.id]);
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found' });

    const payment = devMode || (orderId && !razorpayPaymentId)
      ? await completeDevPayment(orderId)
      : await completePayment({ orderId: razorpayOrderId || orderId, razorpayPaymentId, signature });
    const approvalMode = await getEventApprovalMode();
    const newStatus = approvalMode === 'active' ? 'active' : 'pending_review';

    await query(
      'UPDATE events SET listing_paid = TRUE, listing_payment_id = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [payment.transaction_id, newStatus, req.params.id]
    );

    const receiptBuffer = await generateOrganizerReceiptPdf({
      organizerName: req.user.name,
      eventName: eventResult.rows[0].name,
      paymentType: 'Event Listing',
      amount: payment.amount,
      transactionId: payment.transaction_id,
      timestamp: new Date().toISOString(),
    });
    const receiptUrl = await uploadBuffer(receiptBuffer, `receipts/listing-${payment.id}.pdf`, 'application/pdf');
    await setPaymentReceiptUrl(payment.id, receiptUrl);

    await sendOrganizerReceiptEmail({
      organizerName: req.user.name,
      email: req.user.email,
      paymentType: 'Event Listing',
      amount: payment.amount,
      transactionId: payment.transaction_id,
      eventId: req.params.id,
      receiptBuffer,
    });

    res.json({ message: 'Listing payment complete', status: newStatus, transactionId: payment.transaction_id, receiptUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Boost event payment */
router.post('/:id/boost', isOrganizer, async (req, res) => {
  try {
    const { days } = req.body;
    const pricing = await getBoostPricing();
    const option = pricing.find((p) => p.days === days);
    if (!option) return res.status(400).json({ error: 'Invalid boost duration' });

    const eventResult = await query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [req.params.id, req.user.id]);
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Event not found' });

    const order = await createOrder({
      userId: req.user.id,
      eventId: req.params.id,
      type: 'boost',
      amount: option.amount,
      metadata: { days },
    });

    res.json({ boostPayment: order, days, amount: option.amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Complete boost payment */
router.post('/:id/boost/complete', isOrganizer, async (req, res) => {
  try {
    const { orderId, days } = req.body;
    const payment = await completeDevPayment(orderId);

    await query(
      `UPDATE events SET is_boosted = TRUE, boost_expiry = NOW() + ($1 || ' days')::interval, updated_at = NOW()
       WHERE id = $2 AND organizer_id = $3`,
      [days, req.params.id, req.user.id]
    );

    const receiptBuffer = await generateOrganizerReceiptPdf({
      organizerName: req.user.name,
      eventName: 'Boost',
      paymentType: `Event Boost (${days} days)`,
      amount: payment.amount,
      transactionId: payment.transaction_id,
      timestamp: new Date().toISOString(),
    });
    const receiptUrl = await uploadBuffer(receiptBuffer, `receipts/boost-${payment.id}.pdf`, 'application/pdf');
    await setPaymentReceiptUrl(payment.id, receiptUrl);

    await sendOrganizerReceiptEmail({
      organizerName: req.user.name,
      email: req.user.email,
      paymentType: `Event Boost (${days} days)`,
      amount: payment.amount,
      transactionId: payment.transaction_id,
      eventId: req.params.id,
      receiptBuffer,
    });

    res.json({ message: 'Event boosted', boostExpiry: days, receiptUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Admin approve event */
router.post('/:id/approve', isAdmin, async (req, res) => {
  try {
    await query("UPDATE events SET status = 'active', updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ message: 'Event approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Export registrations as Excel */
router.get('/:id/export', isOrganizer, async (req, res) => {
  try {
    const event = await query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [req.params.id, req.user.id]);
    if (!event.rows[0]) return res.status(404).json({ error: 'Event not found or not yours' });

    const regs = await query(
      `SELECT r.*, u.name AS student_name, u.email AS student_email,
        (SELECT string_agg(tm.name || ' (' || tm.email || ')', '; ') FROM team_members tm WHERE tm.registration_id = r.id) AS team_members_list
       FROM registrations r JOIN users u ON r.student_id = u.id
       WHERE r.event_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');
    sheet.columns = [
      { header: 'Registration ID', key: 'id', width: 38 },
      { header: 'Student Name', key: 'student_name', width: 25 },
      { header: 'Email', key: 'student_email', width: 30 },
      { header: 'Phone', key: 'reg_phone', width: 15 },
      { header: 'College', key: 'reg_college', width: 25 },
      { header: 'Year', key: 'reg_year', width: 12 },
      { header: 'Team Members', key: 'team_members_list', width: 40 },
      { header: 'Payment Status', key: 'payment_status', width: 18 },
      { header: 'Registration Date', key: 'created_at', width: 22 },
    ];
    regs.rows.forEach((r) => sheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registrations-${req.params.id}.xlsx"`);
    await workbook.xlsx.write(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
