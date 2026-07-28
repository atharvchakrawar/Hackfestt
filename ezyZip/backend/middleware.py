import jwt
import functools
from flask import request, jsonify, g

SECRET = 'hackconnect_jwt_secret_2025_change_in_prod'

def make_token(payload):
    return jwt.encode(payload, SECRET, algorithm='HS256')

def decode_token(token):
    return jwt.decode(token, SECRET, algorithms=['HS256'])

def student_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Token missing'}), 401
        try:
            data = decode_token(auth[7:])
            if data.get('role') != 'student':
                return jsonify({'error': 'Student access only'}), 403
            g.student_id = data['id']
            g.token_data = data
        except Exception as e:
            return jsonify({'error': 'Invalid token', 'detail': str(e)}), 401
        return f(*args, **kwargs)
    return wrapper

def organizer_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Token missing'}), 401
        try:
            data = decode_token(auth[7:])
            if data.get('role') != 'organizer':
                return jsonify({'error': 'Organizer access only'}), 403
            g.organizer_id = data['id']
            g.token_data = data
        except Exception as e:
            return jsonify({'error': 'Invalid token', 'detail': str(e)}), 401
        return f(*args, **kwargs)
    return wrapper

def any_auth(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            try:
                data = decode_token(auth[7:])
                g.token_data = data
                g.user_id = data['id']
                g.user_role = data['role']
            except:
                g.token_data = None
        else:
            g.token_data = None
        return f(*args, **kwargs)
    return wrapper

