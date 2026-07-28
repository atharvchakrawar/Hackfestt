from flask import Blueprint, request, jsonify
import hashlib, uuid, datetime
from database import get_db
from middleware import make_token

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

def hash_pw(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

# ─── STUDENT REGISTER ────────────────────────────────────────
@auth_bp.route('/student/register', methods=['POST'])
def student_register():
    d = request.get_json()
    required = ['first_name','last_name','email','password','college','city']
    for f in required:
        if not d.get(f):
            return jsonify({'error': f'{f} is required'}), 400

    db = get_db()
    if db.execute('SELECT id FROM students WHERE email=?', (d['email'],)).fetchone():
        db.close()
        return jsonify({'error': 'Email already registered'}), 409

    student_id = 'stu_' + str(uuid.uuid4())[:8]
    db.execute('''INSERT INTO students
        (id,first_name,last_name,email,password,college,city,phone)
        VALUES (?,?,?,?,?,?,?,?)''',
        (student_id, d['first_name'], d['last_name'], d['email'],
         hash_pw(d['password']), d['college'], d['city'], d.get('phone','')))
    db.commit()

    token = make_token({'id': student_id, 'role': 'student',
                        'email': d['email'], 'name': d['first_name']})
    db.close()
    return jsonify({'token': token, 'role': 'student',
                    'name': d['first_name'], 'id': student_id}), 201

# ─── STUDENT LOGIN ───────────────────────────────────────────
@auth_bp.route('/student/login', methods=['POST'])
def student_login():
    d = request.get_json()
    db = get_db()
    row = db.execute('SELECT * FROM students WHERE email=?', (d.get('email',''),)).fetchone()
    db.close()
    if not row or row['password'] != hash_pw(d.get('password','')):
        return jsonify({'error': 'Invalid email or password'}), 401
    token = make_token({'id': row['id'], 'role': 'student',
                        'email': row['email'], 'name': row['first_name']})
    return jsonify({'token': token, 'role': 'student',
                    'name': row['first_name'], 'id': row['id'],
                    'college': row['college'], 'city': row['city']})

# ─── ORGANIZER REGISTER ──────────────────────────────────────
@auth_bp.route('/organizer/register', methods=['POST'])
def organizer_register():
    d = request.get_json()
    required = ['college_name','email','password','city','state']
    for f in required:
        if not d.get(f):
            return jsonify({'error': f'{f} is required'}), 400

    db = get_db()
    if db.execute('SELECT id FROM organizers WHERE email=?', (d['email'],)).fetchone():
        db.close()
        return jsonify({'error': 'Email already registered'}), 409

    org_id = 'org_' + str(uuid.uuid4())[:8]
    db.execute('''INSERT INTO organizers
        (id,college_name,email,password,city,state,phone,upi_id)
        VALUES (?,?,?,?,?,?,?,?)''',
        (org_id, d['college_name'], d['email'], hash_pw(d['password']),
         d['city'], d['state'], d.get('phone',''), d.get('upi_id','')))
    db.commit()

    token = make_token({'id': org_id, 'role': 'organizer',
                        'email': d['email'], 'name': d['college_name']})
    db.close()
    return jsonify({'token': token, 'role': 'organizer',
                    'name': d['college_name'], 'id': org_id}), 201

# ─── ORGANIZER LOGIN ─────────────────────────────────────────
@auth_bp.route('/organizer/login', methods=['POST'])
def organizer_login():
    d = request.get_json()
    db = get_db()
    row = db.execute('SELECT * FROM organizers WHERE email=?', (d.get('email',''),)).fetchone()
    db.close()
    if not row or row['password'] != hash_pw(d.get('password','')):
        return jsonify({'error': 'Invalid email or password'}), 401
    token = make_token({'id': row['id'], 'role': 'organizer',
                        'email': row['email'], 'name': row['college_name']})
    return jsonify({'token': token, 'role': 'organizer',
                    'name': row['college_name'], 'id': row['id'],
                    'email': row['email'], 'city': row['city'],
                    'upi_id': row['upi_id'] or '',
                    'verified': bool(row['verified'])})

# ─── GET PROFILE ─────────────────────────────────────────────
@auth_bp.route('/student/profile', methods=['GET'])
def student_profile():
    from middleware import decode_token
    auth = request.headers.get('Authorization','')
    if not auth.startswith('Bearer '):
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = decode_token(auth[7:])
        db = get_db()
        row = db.execute('SELECT id,first_name,last_name,email,college,city,phone,github,linkedin,skills,created_at FROM students WHERE id=?', (data['id'],)).fetchone()
        db.close()
        if not row: return jsonify({'error': 'Not found'}), 404
        return jsonify(dict(row))
    except Exception as e:
        return jsonify({'error': str(e)}), 401
