const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../db/pool');
const { isOrganizer } = require('../middleware/auth');

const router = express.Router();

function safeFilename(value) {
  return String(value || 'event')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'event';
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-IN') : '';
}

/**
 * Export event registrations as Excel (.xlsx).
 * Route: GET /api/organizer/events/:id/export
 * @requires organizer JWT + event ownership
 */
router.get('/events/:id/export', isOrganizer, async (req, res) => {
  try {
    const event = await query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [req.params.id, req.user.id]);
    if (!event.rows[0]) return res.status(404).json({ error: 'Event not found or not yours' });

    const regs = await query(
      `SELECT r.*, u.name AS student_name, u.email AS student_email
       FROM registrations r
       JOIN users u ON r.student_id = u.id
       WHERE r.event_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );

    const rows = [];
    for (const registration of regs.rows) {
      const members = await query(
        'SELECT name, email, college FROM team_members WHERE registration_id = $1 ORDER BY created_at ASC',
        [registration.id]
      );
      const teamMembersList = members.rows
        .map((member) => `${member.name} (${member.email}${member.college ? `, ${member.college}` : ''})`)
        .join('; ');
      rows.push({ ...registration, team_members_list: teamMembersList });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HackConnect';
    workbook.created = new Date();
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
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((r) => {
      sheet.addRow({
        ...r,
        created_at: formatDate(r.created_at),
      });
    });
    sheet.autoFilter = {
      from: 'A1',
      to: 'I1',
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(event.rows[0].name)}-registrations.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

