const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { query } = require('../db/pool');
const { hashPassword, comparePassword, signToken, requireAuth } = require('../middleware/auth');
const { sendGoogleLoginNotification } = require('../services/email');

const router = express.Router();

if (config.google.clientId && config.google.clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error('No email from Google'));
          const requestedRole = ['student', 'organizer'].includes(req.query.state) ? req.query.state : 'student';

          let user = (await query('SELECT * FROM users WHERE email = $1 OR google_id = $2', [email, profile.id])).rows[0];

          if (user) {
            if (!user.google_id) {
              await query(
                'UPDATE users SET google_id = $1, auth_provider = $2, avatar_url = COALESCE(avatar_url, $3), updated_at = NOW() WHERE id = $4',
                [profile.id, 'google', profile.photos?.[0]?.value, user.id]
              );
            }
          } else {
            const result = await query(
              `INSERT INTO users (email, name, avatar_url, auth_provider, google_id, role)
               VALUES ($1, $2, $3, 'google', $4, $5) RETURNING *`,
              [email, profile.displayName, profile.photos?.[0]?.value || null, profile.id, requestedRole]
            );
            user = result.rows[0];
            await query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
          }
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

/**
 * Register a student account.
 */
router.post('/student/register', async (req, res) => {
  try {
    const { name, email, password, college, city, phone } = req.body;
    if (!name || !email || !password || !college || !city) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const hash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, auth_provider)
       VALUES ($1, $2, $3, 'student', 'local') RETURNING id, email, name, role`,
      [email, hash, name]
    );
    const user = result.rows[0];
    await query(
      'INSERT INTO user_profiles (user_id, college, city, phone) VALUES ($1, $2, $3, $4)',
      [user.id, college, city, phone || null]
    );

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Register an organizer account.
 */
router.post('/organizer/register', async (req, res) => {
  try {
    const { name, email, password, college, city, phone, organization } = req.body;
    if (!name || !email || !password || !college || !city) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const hash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, auth_provider)
       VALUES ($1, $2, $3, 'organizer', 'local') RETURNING id, email, name, role`,
      [email, hash, name]
    );
    const user = result.rows[0];
    await query(
      'INSERT INTO user_profiles (user_id, college, city, phone, organization, contact_email) VALUES ($1, $2, $3, $4, $5, $6)',
      [user.id, college, city, phone || null, organization || name, email]
    );

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Login for any role.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    if (role && user.role !== role) return res.status(403).json({ error: `Not a ${role} account` });

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Google OAuth initiation */
router.get('/google', (req, res, next) => {
  const role = req.query.role || 'student';
  if (!config.google.clientId || !config.google.clientSecret) {
    return res.redirect(`${config.frontendUrl}/login?role=${role}&error=oauth_not_configured`);
  }
  passport.authenticate('google', { scope: ['profile', 'email'], state: role })(req, res, next);
});

/** Google OAuth callback */
router.get('/google/callback', (req, res, next) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    return res.redirect(`${config.frontendUrl}/login?error=oauth_not_configured`);
  }

  passport.authenticate('google', { session: false }, async (err, user) => {
    if (err || !user) {
      return res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
    sendGoogleLoginNotification(user).catch((emailErr) => {
      console.error('Google login email failed:', emailErr.message);
    });
    const token = signToken(user);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}&role=${user.role}`);
  })(req, res, next);
});

/**
 * Link Google account to existing user.
 */
router.post('/link-google', requireAuth(), async (req, res) => {
  try {
    const { googleId, email, name, avatarUrl } = req.body;
    const existing = await query('SELECT id FROM users WHERE google_id = $1 AND id != $2', [googleId, req.user.id]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Google account already linked to another user' });

    await query(
      'UPDATE users SET google_id = $1, auth_provider = $2, avatar_url = COALESCE($3, avatar_url), updated_at = NOW() WHERE id = $4',
      [googleId, 'google', avatarUrl, req.user.id]
    );
    res.json({ message: 'Google account linked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get current user */
router.get('/me', requireAuth(), async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
