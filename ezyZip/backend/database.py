import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'hackconnect.db')

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=10000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    # ── STUDENTS ──────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS students (
        id          TEXT PRIMARY KEY,
        first_name  TEXT NOT NULL,
        last_name   TEXT NOT NULL,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        college     TEXT NOT NULL,
        city        TEXT NOT NULL,
        phone       TEXT,
        github      TEXT,
        linkedin    TEXT,
        skills      TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    # ── ORGANIZERS ────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS organizers (
        id           TEXT PRIMARY KEY,
        college_name TEXT NOT NULL,
        email        TEXT UNIQUE NOT NULL,
        password     TEXT NOT NULL,
        city         TEXT NOT NULL,
        state        TEXT NOT NULL,
        phone        TEXT,
        upi_id       TEXT,
        verified     INTEGER DEFAULT 0,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    # ── EVENTS ────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS events (
        id                  TEXT PRIMARY KEY,
        organizer_id        TEXT NOT NULL,
        name                TEXT NOT NULL,
        type                TEXT NOT NULL,
        description         TEXT,
        college             TEXT NOT NULL,
        city                TEXT NOT NULL,
        state               TEXT,
        venue               TEXT,
        mode                TEXT DEFAULT 'Offline',
        start_date          TEXT NOT NULL,
        end_date            TEXT,
        duration_hrs        INTEGER,
        registration_deadline TEXT,
        min_team_size       INTEGER DEFAULT 1,
        max_team_size       INTEGER DEFAULT 4,
        max_registrations   INTEGER DEFAULT 200,
        registration_fee    INTEGER DEFAULT 0,
        prize_pool          TEXT,
        prize_1st           TEXT,
        prize_2nd           TEXT,
        prize_3rd           TEXT,
        tracks              TEXT,
        contact_email       TEXT,
        contact_phone       TEXT,
        website_url         TEXT,
        devfolio_url        TEXT,
        upi_id              TEXT,
        status              TEXT DEFAULT 'draft',
        views               INTEGER DEFAULT 0,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(organizer_id) REFERENCES organizers(id)
    )''')

    # ── REGISTRATIONS ─────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS registrations (
        id              TEXT PRIMARY KEY,
        event_id        TEXT NOT NULL,
        student_id      TEXT NOT NULL,
        team_name       TEXT,
        team_members    TEXT,
        payment_status  TEXT DEFAULT 'pending',
        payment_amount  INTEGER DEFAULT 0,
        utr_number      TEXT,
        payment_screenshot TEXT,
        payment_time    DATETIME,
        approved_by     TEXT,
        approved_at     DATETIME,
        rejection_reason TEXT,
        notes           TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(event_id)   REFERENCES events(id),
        FOREIGN KEY(student_id) REFERENCES students(id),
        UNIQUE(event_id, student_id)
    )''')


    # ── INDEXES for fast filtering ─────────────────────────
    c.execute("CREATE INDEX IF NOT EXISTS idx_events_city     ON events(city)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_events_type     ON events(type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_events_status   ON events(status)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_events_org      ON events(organizer_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_regs_event      ON registrations(event_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_regs_student    ON registrations(student_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_regs_status     ON registrations(payment_status)")

    # ── MIGRATE: registration form detail columns ─────────────
    reg_cols = {
        'reg_college': 'TEXT', 'reg_city': 'TEXT', 'reg_phone': 'TEXT',
        'reg_year': 'TEXT', 'reg_skills': 'TEXT', 'reg_note': 'TEXT'
    }
    existing_cols = {row[1] for row in c.execute("PRAGMA table_info(registrations)")}
    for col, typ in reg_cols.items():
        if col not in existing_cols:
            c.execute(f'ALTER TABLE registrations ADD COLUMN {col} {typ}')

    # ── SEED DEMO DATA ────────────────────────────────────────
    import hashlib, uuid

    def pw(plain):
        return hashlib.sha256(plain.encode()).hexdigest()

    # Demo organizer
    org_id = 'org_mit_pune'
    c.execute("INSERT OR IGNORE INTO organizers VALUES (?,?,?,?,?,?,?,?,?,?)",
              (org_id, 'MIT College of Engineering', 'organizer@mit.edu',
               pw('organizer123'), 'Pune', 'Maharashtra',
               '+91-9876543210', 'mitcollege@upi', 1,
               '2024-01-01'))

    # Demo student
    stu_id = 'stu_aarav'
    c.execute("INSERT OR IGNORE INTO students VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
              (stu_id, 'Aarav', 'Shah', 'aarav@mit.edu',
               pw('student123'), 'MIT College', 'Pune',
               '+91-9999888877', 'https://github.com/aarav',
               None, 'Python,React,ML', '2024-01-01'))

    # Demo events — use named columns to avoid mismatch
    def ins_event(eid, name, etype, desc, college, city, s_date, e_date,
                  dur, deadline, min_t, max_t, max_r, fee, prize, p1, p2, p3,
                  tracks, c_email, c_phone, web, devfolio, upi, status):
        c.execute("""INSERT OR IGNORE INTO events
            (id,organizer_id,name,type,description,college,city,state,venue,mode,
             start_date,end_date,duration_hrs,registration_deadline,
             min_team_size,max_team_size,max_registrations,registration_fee,
             prize_pool,prize_1st,prize_2nd,prize_3rd,tracks,
             contact_email,contact_phone,website_url,devfolio_url,upi_id,status,views,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (eid, org_id, name, etype, desc, college, city, 'Maharashtra',
             'Campus', 'Offline', s_date, e_date, dur, deadline,
             min_t, max_t, max_r, fee, prize, p1, p2, p3, tracks,
             c_email, c_phone, web, devfolio, upi, status, 0, '2024-01-01'))

    ins_event('evt_1','InnovateMIT 2025','Hackathon',
        'Annual flagship hackathon. Build solutions for real-world problems.',
        'MIT College of Engineering','Pune','2025-01-28','2025-01-30',
        36,'2025-01-20',2,4,200,0,
        'Rs 1,50,000','Rs 75,000','Rs 40,000','Rs 25,000',
        'HealthTech,EdTech,FinTech,GreenTech',
        'events@mit.edu','+91-9876543210','https://innovatemit.in','',
        'mitevents@upi','live')

    ins_event('evt_2','CodeSprint Winter','Coding Contest',
        'Individual competitive programming. 5 problems, 3 hours.',
        'MIT College of Engineering','Pune','2025-02-10','2025-02-10',
        3,'2025-02-05',1,1,150,100,
        'Rs 40,000','Rs 20,000','Rs 12,000','Rs 8,000',
        'Algorithms,Data Structures',
        'events@mit.edu','+91-9876543210','','',
        'mitevents@upi','upcoming')

    ins_event('evt_3','AIThon IIIT Hyd','AI/ML',
        'Build AI/ML solutions for healthcare and sustainability challenges.',
        'IIIT Hyderabad','Hyderabad','2025-02-10','2025-02-11',
        48,'2025-02-01',3,5,120,200,
        'Rs 2,00,000','Rs 1,00,000','Rs 60,000','Rs 40,000',
        'Healthcare AI,Climate Tech,NLP',
        'aiexcellence@iiit.ac.in','+91-9988776655','','',
        'iiitevents@upi','live')

    conn.commit()
    conn.close()
    print("Database initialized at", DB_PATH)

if __name__ == '__main__':
    init_db()

