const bcrypt = require('bcryptjs');
const { query } = require('./pool');
const config = require('../config');
const { hashPassword } = require('../middleware/auth');
const { setSetting } = require('../services/settings');

/**
 * Seed default settings, admin user, and demo data.
 * @returns {Promise<void>}
 */
async function seed() {
  console.log('Seeding database...');

  await setSetting('listing_fee', { amount: 0 }, 'Organizer event publishing fee in paise. Set to 0 for free publishing.');
  await setSetting('boost_pricing', [
    { days: 3, amount: 99900 },
    { days: 7, amount: 199900 },
  ], 'Boost pricing options');
  await setSetting('event_approval_mode', { mode: 'active' }, 'Status after organizer publishes an event: pending_review or active');

  const adminHash = await hashPassword(config.admin.password);
  const adminResult = await query(
    `INSERT INTO users (email, password_hash, name, role, auth_provider)
     VALUES ($1, $2, $3, 'admin', 'local')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [config.admin.email, adminHash, 'Platform Admin']
  );

  const organizerEmail = process.env.ORGANIZER_EMAIL || 'organizer@vit.edu';
  const organizerPassword = process.env.ORGANIZER_PASSWORD || 'organizer123';
  const orgHash = await hashPassword(organizerPassword);
  const orgResult = await query(
    `INSERT INTO users (email, password_hash, name, role, auth_provider)
     VALUES ($1, $2, 'VIT Pune Events Cell', 'organizer', 'local')
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'organizer', updated_at = NOW() RETURNING id`,
    [organizerEmail, orgHash]
  );
  const orgId = orgResult.rows[0]?.id;
  if (orgId) {
    await query(
      `INSERT INTO user_profiles (
         user_id, phone, college, city, upi_id, verified, contact_email,
         bank_account_holder, bank_name, bank_account_number, bank_ifsc
       )
       VALUES ($1, '+91-9876543210', 'VIT Pune', 'Pune', 'vitcollege@upi', TRUE, $2,
         'VIT Pune Events Cell', 'Demo Bank', '000000000000', 'DEMO0001234')
       ON CONFLICT (user_id) DO UPDATE SET
         contact_email = EXCLUDED.contact_email,
         upi_id = COALESCE(user_profiles.upi_id, EXCLUDED.upi_id),
         bank_account_holder = COALESCE(user_profiles.bank_account_holder, EXCLUDED.bank_account_holder),
         bank_name = COALESCE(user_profiles.bank_name, EXCLUDED.bank_name),
         bank_account_number = COALESCE(user_profiles.bank_account_number, EXCLUDED.bank_account_number),
         bank_ifsc = COALESCE(user_profiles.bank_ifsc, EXCLUDED.bank_ifsc)`,
      [orgId, organizerEmail]
    );
  }

  const eventOwnerEmail = process.env.EVENT_OWNER_EMAIL || organizerEmail;
  const eventOwnerPassword = process.env.EVENT_OWNER_PASSWORD || organizerPassword;
  const eventOwnerHash = await hashPassword(eventOwnerPassword);
  const eventOwnerResult = await query(
    `INSERT INTO users (email, password_hash, name, role, auth_provider)
     VALUES ($1, $2, 'Atharva Events Organizer', 'organizer', 'local')
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'organizer', updated_at = NOW() RETURNING id`,
    [eventOwnerEmail, eventOwnerHash]
  );
  const eventOwnerId = eventOwnerResult.rows[0]?.id;
  if (eventOwnerId) {
    await query(
      `INSERT INTO user_profiles (
         user_id, phone, college, city, upi_id, verified, contact_email,
         bank_account_holder, bank_name, bank_account_number, bank_ifsc
       )
       VALUES ($1, '+91-9876543210', 'VIT Pune', 'Pune', 'atharva-events@upi', TRUE, $2,
         'Atharva Events Organizer', 'Demo Bank', '000000000000', 'DEMO0001234')
       ON CONFLICT (user_id) DO UPDATE SET
         contact_email = EXCLUDED.contact_email,
         upi_id = COALESCE(user_profiles.upi_id, EXCLUDED.upi_id),
         bank_account_holder = COALESCE(user_profiles.bank_account_holder, EXCLUDED.bank_account_holder),
         bank_name = COALESCE(user_profiles.bank_name, EXCLUDED.bank_name),
         bank_account_number = COALESCE(user_profiles.bank_account_number, EXCLUDED.bank_account_number),
         bank_ifsc = COALESCE(user_profiles.bank_ifsc, EXCLUDED.bank_ifsc)`,
      [eventOwnerId, eventOwnerEmail]
    );
  }

  const stuHash = await hashPassword('student123');
  const stuResult = await query(
    `INSERT INTO users (email, password_hash, name, role, auth_provider)
     VALUES ('aarav@vit.edu', $1, 'Aarav Shah', 'student', 'local')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1 RETURNING id`,
    [stuHash]
  );
  const stuId = stuResult.rows[0]?.id;
  if (stuId) {
    await query(
      `INSERT INTO user_profiles (user_id, phone, college, city, year, skills)
       VALUES ($1, '+91-9999888877', 'VIT Pune', 'Pune', '3rd Year', 'Python,React,ML')
       ON CONFLICT (user_id) DO NOTHING`,
      [stuId]
    );
  }

  if (orgId) {
    await query(`DELETE FROM events WHERE name = 'Razorpay Test Event - 1 Rupee'`);

    await query(
      `INSERT INTO events (organizer_id, name, event_type, description, college, city, state, venue,
        event_date, end_date, registration_deadline, max_registrations, participation_type,
        min_team_size, max_team_size, is_paid, registration_fee, status, is_visible, listing_paid)
       SELECT $1, 'InnovateMIT 2025', 'Hackathon', 'Annual flagship hackathon.', 'MIT College of Engineering', 'Pune', 'Maharashtra', 'Main Auditorium',
        '2026-07-28'::timestamptz, '2026-07-30'::timestamptz, '2026-07-20'::timestamptz, 200, 'team', 2, 4, FALSE, 0, 'active', TRUE, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'InnovateMIT 2025')`,
      [orgId]
    );

    await query(
      `INSERT INTO events (organizer_id, name, event_type, description, college, city, state, venue,
        event_date, registration_deadline, max_registrations, participation_type, is_paid, registration_fee,
        status, is_visible, is_boosted, boost_expiry, listing_paid)
       SELECT $1, 'CodeSprint Winter', 'Technical', 'Competitive programming contest.', 'MIT College of Engineering', 'Pune', 'Maharashtra', 'Lab 3',
        '2026-08-10'::timestamptz, '2026-08-05'::timestamptz, 150, 'individual', TRUE, 10000, 'active', TRUE, TRUE, NOW() + INTERVAL '7 days', TRUE
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'CodeSprint Winter')`,
      [orgId]
    );

    const demoEvents = [
      {
        name: 'IIT Madras Shaastra AI Hack',
        type: 'Hackathon',
        description: 'National-level AI and systems hackathon with product tracks, mentor rounds, and final demos.',
        college: 'IIT Madras',
        city: 'Chennai',
        state: 'Tamil Nadu',
        venue: 'Students Activity Center',
        date: '2026-08-11',
        deadline: '2026-08-04',
        max: 220,
        participation: 'team',
        minTeam: 2,
        maxTeam: 4,
        paid: true,
        fee: 25000,
      },
      {
        name: 'IIT Bombay Techfest Innovate',
        type: 'Technical',
        description: 'Engineering innovation challenge covering robotics, software prototypes, and hardware demos.',
        college: 'IIT Bombay',
        city: 'Mumbai',
        state: 'Maharashtra',
        venue: 'Convocation Hall',
        date: '2026-08-13',
        deadline: '2026-08-07',
        max: 260,
        participation: 'team',
        minTeam: 2,
        maxTeam: 5,
        paid: true,
        fee: 30000,
      },
      {
        name: 'IIT Delhi Rendezvous Code Night',
        type: 'Workshop',
        description: 'Evening coding workshop and challenge session for web, data, and ML builders.',
        college: 'IIT Delhi',
        city: 'Delhi',
        state: 'Delhi',
        venue: 'Seminar Hall Complex',
        date: '2026-08-16',
        deadline: '2026-08-10',
        max: 180,
        participation: 'individual',
        minTeam: 1,
        maxTeam: 1,
        paid: false,
        fee: 0,
      },
      {
        name: 'PICT Codeverse 2026',
        type: 'Hackathon',
        description: 'A 24-hour software hackathon focused on scalable products and AI tools.',
        college: 'PICT Pune',
        city: 'Pune',
        state: 'Maharashtra',
        venue: 'PICT Auditorium',
        date: '2026-08-18',
        deadline: '2026-08-12',
        max: 180,
        participation: 'team',
        minTeam: 2,
        maxTeam: 4,
        paid: true,
        fee: 15000,
      },
      {
        name: 'COEP Robotics Challenge',
        type: 'Technical',
        description: 'Build and battle autonomous robots across maze and line-following rounds.',
        college: 'COEP Technological University',
        city: 'Pune',
        state: 'Maharashtra',
        venue: 'COEP Robotics Lab',
        date: '2026-08-22',
        deadline: '2026-08-16',
        max: 120,
        participation: 'team',
        minTeam: 2,
        maxTeam: 5,
        paid: true,
        fee: 20000,
      },
      {
        name: 'VIT Pune TechNova',
        type: 'Workshop',
        description: 'Hands-on cloud, web, and AI workshop for students building deployable projects.',
        college: 'VIT Pune',
        city: 'Pune',
        state: 'Maharashtra',
        venue: 'VIT Seminar Hall',
        date: '2026-08-25',
        deadline: '2026-08-20',
        max: 160,
        participation: 'individual',
        minTeam: 1,
        maxTeam: 1,
        paid: false,
        fee: 0,
      },
      {
        name: 'Walchand CyberSprint',
        type: 'Technical',
        description: 'Cybersecurity contest with CTF, web exploitation, and network defense rounds.',
        college: 'Walchand College of Engineering Sangli',
        city: 'Sangli',
        state: 'Maharashtra',
        venue: 'Computer Center',
        date: '2026-09-02',
        deadline: '2026-08-28',
        max: 140,
        participation: 'team',
        minTeam: 2,
        maxTeam: 3,
        paid: true,
        fee: 12000,
      },
      {
        name: 'PICT Cultural Pulse',
        type: 'Cultural',
        description: 'Music, dance, street play, and open mic competitions for college teams.',
        college: 'PICT Pune',
        city: 'Pune',
        state: 'Maharashtra',
        venue: 'PICT Open Air Theatre',
        date: '2026-09-06',
        deadline: '2026-09-01',
        max: 300,
        participation: 'individual',
        minTeam: 1,
        maxTeam: 1,
        paid: false,
        fee: 0,
      },
      {
        name: 'COEP Startup Seminar',
        type: 'Seminar',
        description: 'Founder talks, product demos, and a student startup pitch session.',
        college: 'COEP Technological University',
        city: 'Pune',
        state: 'Maharashtra',
        venue: 'Main Auditorium',
        date: '2026-09-10',
        deadline: '2026-09-05',
        max: 250,
        participation: 'individual',
        minTeam: 1,
        maxTeam: 1,
        paid: true,
        fee: 5000,
      },
    ];

    for (const event of demoEvents) {
      await query(
        `INSERT INTO events (organizer_id, name, event_type, description, college, city, state, venue,
          event_date, registration_deadline, max_registrations, participation_type, min_team_size, max_team_size,
          is_paid, registration_fee, status, is_visible, listing_paid)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11::int, $12, $13::int, $14::int,
          $15::boolean, $16::int, 'active', TRUE, TRUE
         WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = $2)`,
        [
          orgId,
          event.name,
          event.type,
          event.description,
          event.college,
          event.city,
          event.state || 'Maharashtra',
          event.venue,
          event.date,
          event.deadline,
          event.max,
          event.participation,
          event.minTeam,
          event.maxTeam,
          event.paid,
          event.fee,
        ]
      );
    }

    await query(
      `INSERT INTO events (organizer_id, name, event_type, description, college, city, state, venue,
        event_date, registration_deadline, max_registrations, participation_type, min_team_size, max_team_size,
        is_paid, registration_fee, status, is_visible, listing_paid)
       SELECT $1, 'AIThon IIIT Hyd', 'Hackathon', 'AI/ML solutions for healthcare.', 'IIIT Hyderabad', 'Hyderabad', 'Telangana', 'Innovation Hub',
        '2026-08-15'::timestamptz, '2026-08-01'::timestamptz, 120, 'team', 3, 5, TRUE, 20000, 'active', TRUE, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'AIThon IIIT Hyd')`,
      [orgId]
    );

    const seededEventNames = [
      'InnovateMIT 2025',
      'CodeSprint Winter',
      'IIT Madras Shaastra AI Hack',
      'IIT Bombay Techfest Innovate',
      'IIT Delhi Rendezvous Code Night',
      'PICT Codeverse 2026',
      'COEP Robotics Challenge',
      'VIT Pune TechNova',
      'Walchand CyberSprint',
      'PICT Cultural Pulse',
      'COEP Startup Seminar',
      'AIThon IIIT Hyd',
    ];

    for (const eventName of seededEventNames) {
      await query('UPDATE events SET organizer_id = $1 WHERE name = $2', [eventOwnerId || orgId, eventName]);
    }

    if (process.env.EVENT_OWNER_EMAIL) {
      await query('UPDATE events SET organizer_id = $1 WHERE organizer_id IS NOT NULL', [eventOwnerId || orgId]);
    }
  }

  console.log('Seed complete.');
  console.log('Admin:', config.admin.email, '/', config.admin.password);
  console.log('Organizer:', organizerEmail, '/ configured password');
  console.log('Event owner:', eventOwnerEmail, '/ configured password');
  console.log('Student: aarav@vit.edu / student123');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { seed };

