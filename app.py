from flask import Flask, render_template, send_from_directory, request, jsonify
from utils.routing import calculate_wander_route

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/data/<filename>')
def get_data(filename):
    return send_from_directory('data', filename)

@app.route('/api/route')
def route_api():
    try:
        lat_start = float(request.args.get('lat_start'))
        lon_start = float(request.args.get('lon_start'))
        lat_end = float(request.args.get('lat_end'))
        lon_end = float(request.args.get('lon_end'))
        detour_min = int(request.args.get('detour_min', 0))
        mode = request.args.get('mode', 'jour')
        theme = request.args.get('theme', 'all')
        
        # --- NOUVEAU : Récupération de la case PMR ---
        pmr = request.args.get('pmr', 'false') 
        # ---------------------------------------------
        
        # On ajoute le paramètre pmr à la fin de la fonction
        route_geojson = calculate_wander_route(lat_start, lon_start, lat_end, lon_end, detour_min, mode, theme, pmr)
        
        return jsonify(route_geojson)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)