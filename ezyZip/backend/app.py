import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify, send_from_directory, send_file, request
from database import init_db
from routes.auth import auth_bp
from routes.events import events_bp
from routes.registrations import reg_bp

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')
UPLOAD_DIR   = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)

# ── IN-MEMORY CACHE (30s TTL) ─────────────────────────────
_cache = {}
CACHE_TTL = 30

def cache_get(key):
    e = _cache.get(key)
    if e and (time.time() - e['ts']) < CACHE_TTL:
        return e['data']
    return None

def cache_set(key, data):
    _cache[key] = {'data': data, 'ts': time.time()}

def cache_clear(prefix=''):
    for k in [k for k in list(_cache) if k.startswith(prefix)]:
        _cache.pop(k, None)

app.cache_get   = cache_get
app.cache_set   = cache_set
app.cache_clear = cache_clear

# ── CORS ──────────────────────────────────────────────────
@app.after_request
def cors(r):
    r.headers['Access-Control-Allow-Origin']  = '*'
    r.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    r.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    if request.path.startswith('/pages/') or request.path == '/':
        r.headers['Cache-Control'] = 'public, max-age=60'
    return r

@app.before_request
def handle_options():
    if request.method == 'OPTIONS':
        return jsonify({}), 200

# ── BLUEPRINTS ────────────────────────────────────────────
app.register_blueprint(auth_bp)
app.register_blueprint(events_bp)
app.register_blueprint(reg_bp)

# ── FRONTEND ──────────────────────────────────────────────
@app.route('/')
def root():
    return send_file(os.path.join(FRONTEND_DIR, 'index.html'))

@app.route('/pages/<path:filename>')
def pages(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'pages'), filename)

@app.route('/uploads/<path:filename>')
def uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# ── HEALTH ────────────────────────────────────────────────
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'version': '2.0.0'})

# ── BOOTSTRAP (single call replaces 3 page-load calls) ───
@app.route('/api/bootstrap')
def bootstrap():
    cached = cache_get('bootstrap')
    if cached:
        return jsonify(cached)
    from database import get_db
    db = get_db()
    events = db.execute('''
        SELECT e.id, e.name, e.type, e.college, e.city,
               e.start_date, e.end_date, e.registration_fee,
               e.prize_pool, e.min_team_size, e.max_team_size,
               e.status, e.upi_id,
               (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as reg_count
        FROM events e WHERE e.status IN ("live","upcoming")
        ORDER BY e.created_at DESC LIMIT 50
    ''').fetchall()
    cities = db.execute('''
        SELECT city, COUNT(*) as cnt FROM events
        WHERE status IN ("live","upcoming")
        GROUP BY city ORDER BY cnt DESC
    ''').fetchall()
    db.close()
    data = {'events': [dict(e) for e in events],
            'city_counts': [dict(c) for c in cities]}
    cache_set('bootstrap', data)
    return jsonify(data)

@app.route('/api')
def api_docs():
    return jsonify({'service': 'HackConnect API v2.0',
                    'demo': {'student': 'aarav@mit.edu / student123',
                             'organizer': 'organizer@mit.edu / organizer123'}})

if __name__ == '__main__':
    init_db()
    print('\n' + '='*54)
    print('  HackConnect  -  Optimized Server')
    print('='*54)
    print('  Home      ->  http://localhost:5000/')
    print('  Discover  ->  http://localhost:5000/pages/discover.html')
    print('  Student   ->  http://localhost:5000/pages/student.html')
    print('  Organizer ->  http://localhost:5000/pages/organizer.html')
    print('='*54)
    print('  Student  : aarav@mit.edu / student123')
    print('  Organizer: organizer@mit.edu / organizer123')
    print('='*54 + '\n')
    app.run(host='0.0.0.0', port=5000,
            debug=False,        # OFF = no slow reloader
            threaded=True,      # ON  = handle many requests at once
            use_reloader=False) # OFF = no double-start on Windows

