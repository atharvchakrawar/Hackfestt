from flask import Blueprint, request, jsonify, g
import uuid, datetime, os, base64
from database import get_db
from middleware import student_required, organizer_required

reg_bp = Blueprint('registrations', __name__, url_prefix='/api/registrations')

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), '..', 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _enrich_registration(row):
    """Merge structured columns with legacy notes field."""
    d = dict(row)
    if not d.get('reg_phone') and d.get('notes'):
        for part in d['notes'].split(' | '):
            if part.startswith('College: '): d.setdefault('reg_college', part[9:])
            elif part.startswith('City: '):    d.setdefault('reg_city', part[6:])
            elif part.startswith('Phone: '):   d.setdefault('reg_phone', part[7:])
            elif part.startswith('Year: '):    d.setdefault('reg_year', part[6:])
            elif part.startswith('Skills: '):  d.setdefault('reg_skills', part[8:])
            elif part.startswith('Note: '):    d.setdefault('reg_note', part[6:])
    d['display_college'] = d.get('reg_college') or d.get('student_college', '')
    d['display_city']    = d.get('reg_city') or d.get('student_city', '')
    d['display_phone']   = d.get('reg_phone') or d.get('student_phone', '')
    return d

# ─── REGISTER FOR EVENT (Step 1: initiate registration) ──────
@reg_bp.route('/register', methods=['POST'])
@student_required
def register():
    d = request.get_json()
    event_id = d.get('event_id')
    if not event_id:
        return jsonify({'error': 'event_id required'}), 400

    db = get_db()

    # Validate event exists and is open
    event = db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
    if not event:
        db.close()
        return jsonify({'error': 'Event not found'}), 404
    if event['status'] not in ('live', 'upcoming'):
        db.close()
        return jsonify({'error': 'Event is not accepting registrations'}), 400

    # Check max registrations
    reg_count = db.execute('SELECT COUNT(*) FROM registrations WHERE event_id=?', (event_id,)).fetchone()[0]
    if event['max_registrations'] and reg_count >= event['max_registrations']:
        db.close()
        return jsonify({'error': 'Event is full'}), 400

    # Check already registered
    existing = db.execute('SELECT * FROM registrations WHERE event_id=? AND student_id=?',
                          (event_id, g.student_id)).fetchone()
    if existing:
        db.close()
        return jsonify({'error': 'Already registered for this event',
                        'registration_id': existing['id'],
                        'payment_status': existing['payment_status']}), 409

    reg_id = 'reg_' + str(uuid.uuid4())[:10]
    fee = event['registration_fee'] or 0

    # If free event → directly confirmed
    status = 'free_confirmed' if fee == 0 else 'pending_payment'

    # Extra registration details submitted by student in the form
    team_members = d.get('team_members', [])
    if isinstance(team_members, list):
        team_members = ','.join(team_members)
    reg_college = d.get('college', '')
    reg_city    = d.get('city', '')
    reg_phone   = d.get('phone', '')
    reg_year    = d.get('year', '')
    reg_skills  = d.get('skills', '')
    reg_note    = d.get('note', '')
    notes_parts = []
    if reg_college: notes_parts.append(f"College: {reg_college}")
    if reg_city:    notes_parts.append(f"City: {reg_city}")
    if reg_phone:   notes_parts.append(f"Phone: {reg_phone}")
    if reg_year:    notes_parts.append(f"Year: {reg_year}")
    if reg_skills:  notes_parts.append(f"Skills: {reg_skills}")
    if reg_note:    notes_parts.append(f"Note: {reg_note}")
    notes = ' | '.join(notes_parts)

    db.execute('''INSERT INTO registrations
        (id, event_id, student_id, team_name, team_members,
         payment_status, payment_amount, notes,
         reg_college, reg_city, reg_phone, reg_year, reg_skills, reg_note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (reg_id, event_id, g.student_id,
         d.get('team_name',''), team_members,
         status, fee, notes,
         reg_college, reg_city, reg_phone, reg_year, reg_skills, reg_note))
    db.commit()

    # Get UPI info for payment
    upi_id  = event['upi_id'] or ''
    upi_url = f"upi://pay?pa={upi_id}&pn={event['college']}&am={fee}&cu=INR&tn=HackConnect-{event['name'][:20]}"

    db.close()
    return jsonify({
        'registration_id': reg_id,
        'payment_status': status,
        'fee': fee,
        'upi_id': upi_id,
        'upi_url': upi_url if fee > 0 else None,
        'message': 'Registered! Complete payment to confirm.' if fee > 0 else 'Registration confirmed! Event is free.'
    }), 201

# ─── SUBMIT PAYMENT (Step 2: student submits UTR + screenshot) ─
@reg_bp.route('/<reg_id>/payment', methods=['POST'])
@student_required
def submit_payment(reg_id):
    d = request.get_json()

    db = get_db()
    reg = db.execute('SELECT * FROM registrations WHERE id=? AND student_id=?',
                     (reg_id, g.student_id)).fetchone()
    if not reg:
        db.close()
        return jsonify({'error': 'Registration not found'}), 404
    if reg['payment_status'] in ('confirmed', 'free_confirmed'):
        db.close()
        return jsonify({'error': 'Already confirmed'}), 400

    utr = d.get('utr_number', '').strip()
    screenshot_b64 = d.get('screenshot_base64','')

    if not utr:
        db.close()
        return jsonify({'error': 'UTR/Transaction ID required'}), 400

    # Save screenshot if provided
    screenshot_path = ''
    if screenshot_b64 and screenshot_b64.startswith('data:image'):
        # Strip header and save
        try:
            header, data_part = screenshot_b64.split(',', 1)
            ext = 'jpg' if 'jpeg' in header else 'png'
            fname = f'{reg_id}_{uuid.uuid4().hex[:8]}.{ext}'
            fpath = os.path.join(UPLOAD_DIR, fname)
            with open(fpath, 'wb') as f:
                f.write(base64.b64decode(data_part))
            screenshot_path = fname
        except Exception as e:
            pass  # Continue without screenshot

    db.execute('''UPDATE registrations SET
        utr_number=?, payment_screenshot=?, payment_time=?, payment_status=?
        WHERE id=?''',
        (utr, screenshot_path, datetime.datetime.now().isoformat(),
         'payment_submitted', reg_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Payment details submitted. Organizer will verify shortly.',
                    'payment_status': 'payment_submitted'})

# ─── GET STUDENT'S REGISTRATIONS ─────────────────────────────
@reg_bp.route('/my', methods=['GET'])
@student_required
def my_registrations():
    db = get_db()
    rows = db.execute('''SELECT r.*, e.name as event_name, e.type as event_type,
        e.college as event_college, e.city as event_city,
        e.start_date, e.end_date, e.prize_pool,
        e.mode, e.registration_fee
        FROM registrations r JOIN events e ON r.event_id=e.id
        WHERE r.student_id=? ORDER BY r.created_at DESC''', (g.student_id,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ─── ORGANIZER: GET ALL REGISTRATIONS FOR THEIR EVENTS ───────
@reg_bp.route('/organizer/all', methods=['GET'])
@organizer_required
def organizer_registrations():
    db = get_db()
    event_id = request.args.get('event_id')
    status   = request.args.get('status')

    q = '''SELECT r.*,
        s.first_name, s.last_name, s.email as student_email,
        s.college as student_college, s.city as student_city,
        s.phone as student_phone, s.github, s.skills,
        e.name as event_name, e.type as event_type, e.registration_fee
        FROM registrations r
        JOIN students s ON r.student_id=s.id
        JOIN events e ON r.event_id=e.id
        WHERE e.organizer_id=?'''
    params = [g.organizer_id]

    if event_id:
        q += ' AND r.event_id=?'; params.append(event_id)
    if status:
        q += ' AND r.payment_status=?'; params.append(status)

    q += ' ORDER BY r.created_at DESC'
    rows = db.execute(q, params).fetchall()
    db.close()
    return jsonify([_enrich_registration(r) for r in rows])

# ─── ORGANIZER: GET SINGLE REGISTRATION DETAIL ───────────────
@reg_bp.route('/organizer/<reg_id>', methods=['GET'])
@organizer_required
def organizer_registration_detail(reg_id):
    db = get_db()
    row = db.execute('''SELECT r.*,
        s.first_name, s.last_name, s.email as student_email,
        s.college as student_college, s.city as student_city,
        s.phone as student_phone, s.github, s.linkedin, s.skills as profile_skills,
        e.name as event_name, e.type as event_type, e.registration_fee,
        e.start_date, e.college as event_college
        FROM registrations r
        JOIN students s ON r.student_id=s.id
        JOIN events e ON r.event_id=e.id
        WHERE r.id=? AND e.organizer_id=?''', (reg_id, g.organizer_id)).fetchone()
    db.close()
    if not row:
        return jsonify({'error': 'Registration not found'}), 404
    return jsonify(_enrich_registration(row))

# ─── ORGANIZER: APPROVE PAYMENT ──────────────────────────────
@reg_bp.route('/<reg_id>/approve', methods=['POST'])
@organizer_required
def approve_payment(reg_id):
    db = get_db()
    # Verify this reg belongs to organizer's event
    row = db.execute('''SELECT r.* FROM registrations r
        JOIN events e ON r.event_id=e.id
        WHERE r.id=? AND e.organizer_id=?''', (reg_id, g.organizer_id)).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Registration not found'}), 404

    db.execute('''UPDATE registrations SET
        payment_status='confirmed', approved_by=?, approved_at=?,
        rejection_reason=NULL
        WHERE id=?''',
        (g.organizer_id, datetime.datetime.now().isoformat(), reg_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Registration confirmed ✅'})

# ─── ORGANIZER: REJECT PAYMENT ───────────────────────────────
@reg_bp.route('/<reg_id>/reject', methods=['POST'])
@organizer_required
def reject_payment(reg_id):
    d = request.get_json()
    db = get_db()
    row = db.execute('''SELECT r.* FROM registrations r
        JOIN events e ON r.event_id=e.id
        WHERE r.id=? AND e.organizer_id=?''', (reg_id, g.organizer_id)).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Registration not found'}), 404

    db.execute('''UPDATE registrations SET
        payment_status='rejected', rejection_reason=?,
        approved_by=NULL, approved_at=?
        WHERE id=?''',
        (d.get('reason','Payment not verified'),
         datetime.datetime.now().isoformat(), reg_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Registration rejected'})

# ─── GENERATE UPI QR IMAGE (base64) ──────────────────────────
@reg_bp.route('/qr/<event_id>', methods=['GET'])
def get_payment_qr(event_id):
    db = get_db()
    event = db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
    db.close()
    if not event:
        return jsonify({'error': 'Event not found'}), 404

    fee    = event['registration_fee'] or 0
    upi_id = event['upi_id'] or 'hackconnect@upi'
    name   = event['college']
    upi_url = f"upi://pay?pa={upi_id}&pn={name}&am={fee}&cu=INR&tn=HackConnect-{event['name'][:20]}"

    # Generate a simple QR code SVG pattern using pure Python
    qr_svg = generate_qr_svg(upi_url)

    return jsonify({
        'upi_id': upi_id,
        'amount': fee,
        'upi_url': upi_url,
        'college': name,
        'event_name': event['name'],
        'qr_svg': qr_svg
    })

def generate_qr_svg(data):
    """Generate a simple QR-like SVG pattern from data string for demo."""
    import hashlib
    h = hashlib.md5(data.encode()).hexdigest()
    size = 21
    cells = []
    # Use hash to deterministically fill cells (simplified visual QR)
    seed = int(h, 16)
    import random
    rng = random.Random(seed)

    grid = [[False]*size for _ in range(size)]
    # Finder patterns (corners)
    for r in range(7):
        for c in range(7):
            if r==0 or r==6 or c==0 or c==6 or (1<r<5 and 1<c<5):
                grid[r][c] = True
                grid[r][size-1-c] = True
                grid[size-1-r][c] = True

    # Timing pattern
    for i in range(8, size-8):
        grid[6][i] = (i % 2 == 0)
        grid[i][6] = (i % 2 == 0)

    # Data area (random based on input)
    for r in range(size):
        for c in range(size):
            skip = (r<8 and c<8) or (r<8 and c>size-9) or (r>size-9 and c<8) or r==6 or c==6
            if not skip:
                grid[r][c] = rng.random() > 0.5

    cell_size = 8
    svg_size = size * cell_size + 32
    rects = []
    for r in range(size):
        for c in range(size):
            if grid[r][c]:
                x = c * cell_size + 16
                y = r * cell_size + 16
                rects.append(f'<rect x="{x}" y="{y}" width="{cell_size}" height="{cell_size}" fill="#000"/>')

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{svg_size}" height="{svg_size}" viewBox="0 0 {svg_size} {svg_size}">
<rect width="{svg_size}" height="{svg_size}" fill="white"/>
{''.join(rects)}
</svg>'''
    return svg

