CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (unified auth for student, organizer, admin)
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  auth_provider   TEXT NOT NULL DEFAULT 'local',
  google_id       TEXT UNIQUE,
  role            TEXT NOT NULL CHECK (role IN ('student', 'organizer', 'admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone           TEXT,
  college         TEXT,
  city            TEXT,
  year            TEXT,
  gender          TEXT,
  profile_photo   TEXT,
  organization    TEXT,
  contact_email   TEXT,
  college_id_proof TEXT,
  github          TEXT,
  linkedin        TEXT,
  skills          TEXT,
  upi_id          TEXT,
  verified        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id          UUID NOT NULL REFERENCES users(id),
  name                  TEXT NOT NULL,
  event_type            TEXT NOT NULL DEFAULT 'Other',
  description           TEXT,
  college               TEXT NOT NULL,
  city                  TEXT NOT NULL,
  state                 TEXT,
  venue                 TEXT,
  mode                  TEXT DEFAULT 'Offline',
  event_date            TIMESTAMPTZ NOT NULL,
  end_date              TIMESTAMPTZ,
  duration_hrs          INTEGER,
  registration_deadline TIMESTAMPTZ,
  registration_status   TEXT NOT NULL DEFAULT 'open' CHECK (registration_status IN ('open', 'closed', 'full')),
  is_visible            BOOLEAN NOT NULL DEFAULT TRUE,
  min_registrations     INTEGER,
  max_registrations     INTEGER NOT NULL DEFAULT 200,
  current_registrations INTEGER NOT NULL DEFAULT 0,
  participation_type    TEXT NOT NULL DEFAULT 'individual' CHECK (participation_type IN ('individual', 'team')),
  min_team_size         INTEGER DEFAULT 1,
  max_team_size         INTEGER DEFAULT 4,
  is_paid               BOOLEAN NOT NULL DEFAULT FALSE,
  registration_fee      INTEGER NOT NULL DEFAULT 0,
  is_boosted            BOOLEAN NOT NULL DEFAULT FALSE,
  boost_expiry          TIMESTAMPTZ,
  prize_pool            TEXT,
  prize_1st             TEXT,
  prize_2nd             TEXT,
  prize_3rd             TEXT,
  tracks                TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  website_url           TEXT,
  special_instructions  TEXT,
  listing_payment_id    TEXT,
  listing_paid          BOOLEAN DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'active', 'live', 'upcoming', 'cancelled')),
  views                 INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id),
  team_name         TEXT,
  payment_status    TEXT NOT NULL DEFAULT 'pending',
  payment_amount    INTEGER DEFAULT 0,
  transaction_id    TEXT,
  receipt_url       TEXT,
  reg_college       TEXT,
  reg_city          TEXT,
  reg_phone         TEXT,
  reg_year          TEXT,
  reg_gender        TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, student_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  college         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  event_id        UUID REFERENCES events(id),
  registration_id UUID REFERENCES registrations(id),
  type            TEXT NOT NULL CHECK (type IN ('registration', 'listing', 'boost')),
  amount          INTEGER NOT NULL,
  currency        TEXT DEFAULT 'INR',
  transaction_id  TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  receipt_url       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  template        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  registration_id UUID REFERENCES registrations(id),
  event_id        UUID REFERENCES events(id),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_college ON events(college);
CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_visible ON events(is_visible);
CREATE INDEX IF NOT EXISTS idx_events_boosted ON events(is_boosted, boost_expiry);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_regs_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_regs_student ON registrations(student_id);
CREATE INDEX IF NOT EXISTS idx_team_reg ON team_members(registration_id);
