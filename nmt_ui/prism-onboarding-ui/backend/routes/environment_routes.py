from flask import Blueprint, request, jsonify, g

environment_routes = Blueprint('environment_routes', __name__)

@environment_routes.route('/api/save-environment', methods=['POST'])
def save_environment():
    data = request.json
    # You can add logic to save to DB, file, or session as needed
    # For example, save to DB: save_environment_to_db(g.db, data)
    print("Received environment profile:", data)
    return jsonify({'success': True})