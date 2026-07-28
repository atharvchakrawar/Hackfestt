from flask import Blueprint, request, jsonify, g
import uuid, datetime
from database import get_db
from middleware import organizer_required, any_auth

events_bp = Blueprint('events', __name__, url_prefix='/api/events')

# ─── LIST / FILTER EVENTS ────────────────────────────────────
@events_bp.route('/', methods=['GET'])
def list_events():
    db = get_db()
    q = "SELECT e.*, o.college_name as organizer_name, o.verified as org_verified, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as reg_count FROM events e JOIN organizers o ON e.organizer_id=o.id WHERE e.status != 'draft'"

    params = []
    city    = request.args.get('city')
    college = request.args.get('college')
    etype   = request.args.get('type')
    search  = request.args.get('search')

    if city:
        q += " AND LOWER(e.city) LIKE LOWER(?)"; params.append(f'%{city}%')
    if college:
        q += " AND LOWER(e.college) LIKE LOWER(?)"; params.append(f'%{college}%')
    if etype and etype != 'All':
        q += " AND LOWER(e.type) LIKE LOWER(?)"; params.append(f'%{etype}%')
    if search:
        q += " AND (LOWER(e.name) LIKE LOWER(?) OR LOWER(e.college) LIKE LOWER(?) OR LOWER(e.city) LIKE LOWER(?))"
        params += [f'%{search}%', f'%{search}%', f'%{search}%']

    q += " ORDER BY e.created_at DESC"
    rows = db.execute(q, params).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ─── GET SINGLE EVENT ────────────────────────────────────────
@events_bp.route('/<event_id>', methods=['GET'])
def get_event(event_id):
    db = get_db()
    row = db.execute('''SELECT e.*, o.college_name as organizer_name, o.verified as org_verified,
        o.upi_id as organizer_upi,
        (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as reg_count
        FROM events e JOIN organizers o ON e.organizer_id=o.id WHERE e.id=?''', (event_id,)).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Event not found'}), 404
    # Increment view count
    db.execute('UPDATE events SET views=views+1 WHERE id=?', (event_id,))
    db.commit()
    db.close()
    return jsonify(dict(row))

# ─── CREATE EVENT ────────────────────────────────────────────
@events_bp.route('/', methods=['POST'])
@organizer_required
def create_event():
    d = request.get_json()
    required = ['name','type','start_date','college','city']
    for f in required:
        if not d.get(f):
            return jsonify({'error': f'{f} is required'}), 400

    db = get_db()
    # Get organizer's UPI as default
    org = db.execute('SELECT upi_id FROM organizers WHERE id=?', (g.organizer_id,)).fetchone()
    upi = d.get('upi_id') or (org['upi_id'] if org else '')

    event_id = 'evt_' + str(uuid.uuid4())[:8]
    db.execute('''INSERT INTO events
        (id,organizer_id,name,type,description,college,city,state,venue,mode,
         start_date,end_date,duration_hrs,registration_deadline,
         min_team_size,max_team_size,max_registrations,registration_fee,
         prize_pool,prize_1st,prize_2nd,prize_3rd,tracks,
         contact_email,contact_phone,website_url,devfolio_url,upi_id,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (event_id, g.organizer_id,
         d.get('name'), d.get('type'), d.get('description',''),
         d.get('college'), d.get('city'), d.get('state',''),
         d.get('venue',''), d.get('mode','Offline'),
         d.get('start_date'), d.get('end_date',''), d.get('duration_hrs',0),
         d.get('registration_deadline',''),
         d.get('min_team_size',1), d.get('max_team_size',4),
         d.get('max_registrations',200), d.get('registration_fee',0),
         d.get('prize_pool',''), d.get('prize_1st',''),
         d.get('prize_2nd',''), d.get('prize_3rd',''),
         ','.join(d.get('tracks',[])) if isinstance(d.get('tracks'), list) else d.get('tracks',''),
         d.get('contact_email',''), d.get('contact_phone',''),
         d.get('website_url',''), d.get('devfolio_url',''),
         upi, d.get('status','draft')))
    db.commit()
    db.close()
    from flask import current_app
    current_app.cache_clear('bootstrap')
    return jsonify({'id': event_id, 'message': 'Event created successfully'}), 201

# ─── UPDATE EVENT ────────────────────────────────────────────
@events_bp.route('/<event_id>', methods=['PUT'])
@organizer_required
def update_event(event_id):
    d = request.get_json()
    db = get_db()
    ev = db.execute('SELECT * FROM events WHERE id=? AND organizer_id=?', (event_id, g.organizer_id)).fetchone()
    if not ev:
        db.close()
        return jsonify({'error': 'Event not found or not yours'}), 404

    allowed = ['name','type','description','venue','mode','start_date','end_date',
               'duration_hrs','registration_deadline','min_team_size','max_team_size',
               'max_registrations','registration_fee','prize_pool','prize_1st',
               'prize_2nd','prize_3rd','tracks','contact_email','contact_phone',
               'website_url','devfolio_url','upi_id','status']
    sets = []
    vals = []
    for k in allowed:
        if k in d:
            sets.append(f'{k}=?')
            vals.append(','.join(d[k]) if isinstance(d[k], list) else d[k])
    if not sets:
        db.close()
        return jsonify({'error': 'Nothing to update'}), 400
    vals.append(event_id)
    db.execute(f"UPDATE events SET {','.join(sets)} WHERE id=?", vals)
    db.commit()
    db.close()
    return jsonify({'message': 'Event updated'})

# ─── DELETE EVENT ────────────────────────────────────────────
@events_bp.route('/<event_id>', methods=['DELETE'])
@organizer_required
def delete_event(event_id):
    db = get_db()
    db.execute('DELETE FROM events WHERE id=? AND organizer_id=?', (event_id, g.organizer_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Event deleted'})

# ─── ORGANIZER'S OWN EVENTS ──────────────────────────────────
@events_bp.route('/my/events', methods=['GET'])
@organizer_required
def my_events():
    db = get_db()
    rows = db.execute('''SELECT e.*,
        (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as reg_count,
        (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.payment_status='confirmed') as confirmed_count,
        (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.payment_status='payment_submitted') as pending_count
        FROM events e WHERE e.organizer_id=? ORDER BY e.created_at DESC''', (g.organizer_id,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ─── ORGANIZER ANALYTICS SUMMARY ────────────────────────────
@events_bp.route('/my/analytics', methods=['GET'])
@organizer_required
def my_analytics():
    db = get_db()
    total_events   = db.execute('SELECT COUNT(*) FROM events WHERE organizer_id=?', (g.organizer_id,)).fetchone()[0]
    total_regs     = db.execute('SELECT COUNT(*) FROM registrations r JOIN events e ON r.event_id=e.id WHERE e.organizer_id=?', (g.organizer_id,)).fetchone()[0]
    total_views    = db.execute('SELECT COALESCE(SUM(views),0) FROM events WHERE organizer_id=?', (g.organizer_id,)).fetchone()[0]
    confirmed_regs = db.execute("SELECT COUNT(*) FROM registrations r JOIN events e ON r.event_id=e.id WHERE e.organizer_id=? AND r.payment_status='confirmed'", (g.organizer_id,)).fetchone()[0]
    pending_regs   = db.execute("SELECT COUNT(*) FROM registrations r JOIN events e ON r.event_id=e.id WHERE e.organizer_id=? AND r.payment_status='payment_submitted'", (g.organizer_id,)).fetchone()[0]
    city_breakdown = db.execute("SELECT r2.city, COUNT(*) as cnt FROM registrations r JOIN events e ON r.event_id=e.id JOIN students r2 ON r.student_id=r2.id WHERE e.organizer_id=? GROUP BY r2.city ORDER BY cnt DESC LIMIT 8", (g.organizer_id,)).fetchall()
    db.close()
    return jsonify({
        'total_events': total_events,
        'total_registrations': total_regs,
        'confirmed_registrations': confirmed_regs,
        'pending_registrations': pending_regs,
        'total_views': total_views,
        'city_breakdown': [dict(r) for r in city_breakdown]
    })
