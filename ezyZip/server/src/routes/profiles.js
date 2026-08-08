const express = require('express');
const { query } = require('../db/pool');
const { isStudent, isOrganizer, requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Get user profile with role-specific fields.
 */
router.get('/', requireAuth(), async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.auth_provider,
              p.phone, p.college, p.city, p.year, p.gender, p.profile_photo,
              p.organization, p.contact_email, p.college_id_proof, p.skills, p.github, p.linkedin,
              p.upi_id, p.bank_account_holder, p.bank_name, p.bank_account_number, p.bank_ifsc
       FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update user profile (student or organizer fields).
 */
router.put('/', requireAuth(), async (req, res) => {
  try {
    const d = req.body;
    if (d.name) {
      await query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [d.name, req.user.id]);
    }

    await query(
      `INSERT INTO user_profiles (user_id, phone, college, city, year, gender, profile_photo,
        organization, contact_email, college_id_proof, skills, github, linkedin, upi_id,
        bank_account_holder, bank_name, bank_account_number, bank_ifsc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (user_id) DO UPDATE SET
         phone = COALESCE($2, user_profiles.phone),
         college = COALESCE($3, user_profiles.college),
         city = COALESCE($4, user_profiles.city),
         year = COALESCE($5, user_profiles.year),
         gender = COALESCE($6, user_profiles.gender),
         profile_photo = COALESCE($7, user_profiles.profile_photo),
         organization = COALESCE($8, user_profiles.organization),
         contact_email = COALESCE($9, user_profiles.contact_email),
         college_id_proof = COALESCE($10, user_profiles.college_id_proof),
         skills = COALESCE($11, user_profiles.skills),
         github = COALESCE($12, user_profiles.github),
         linkedin = COALESCE($13, user_profiles.linkedin),
         upi_id = COALESCE($14, user_profiles.upi_id),
         bank_account_holder = COALESCE($15, user_profiles.bank_account_holder),
         bank_name = COALESCE($16, user_profiles.bank_name),
         bank_account_number = COALESCE($17, user_profiles.bank_account_number),
         bank_ifsc = COALESCE($18, user_profiles.bank_ifsc),
         updated_at = NOW()`,
      [
        req.user.id, d.phone, d.college, d.city, d.year, d.gender, d.profile_photo,
        d.organization, d.contact_email, d.college_id_proof, d.skills, d.github, d.linkedin, d.upi_id,
        d.bank_account_holder, d.bank_name, d.bank_account_number, d.bank_ifsc,
      ]
    );

    const result = await query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.role,
              p.phone, p.college, p.city, p.year, p.gender, p.profile_photo,
              p.organization, p.contact_email, p.college_id_proof, p.skills,
              p.upi_id, p.bank_account_holder, p.bank_name, p.bank_account_number, p.bank_ifsc
       FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
