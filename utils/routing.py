import osmnx as ox
import networkx as nx
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, LineString
import traceback

print("Chargement du graphe piéton en mémoire...")
G = ox.load_graphml("data/nantes_metropole_walk.graphml")

print("Chargement des zones d'intérêt (Culture, Parcs, Eau)...")
def load_poi(filepath):
    try:
        return gpd.read_file(filepath)
    except Exception:
        return gpd.GeoDataFrame()

gdf_culture = load_poi("data/lieux_culturels.geojson")

if not gdf_culture.empty and 'categorie_usager' in gdf_culture.columns:
    categories_pertinentes = ['Monuments et châteaux', 'Musées et expositions']
    gdf_culture = gdf_culture[gdf_culture['categorie_usager'].isin(categories_pertinentes)]
    print(f"Lieux culturels filtrés : {len(gdf_culture)} lieux conservés.")

gdf_parcs = load_poi("data/parcs_nantes.geojson")
gdf_eau = load_poi("data/cours_eau.geojson")

# ==========================================
# CONSTANTES SCIENTIFIQUES ET ÉCOLOGIQUES
# ==========================================
VITESSE_PIETON_M_MIN = 80   
LONGUEUR_PAS_M = 0.75       
CO2_VOITURE_G_KM = 193      
KCAL_KM = 50                

def get_path_length(graph, path):
    total_length = 0
    for u, v in zip(path[:-1], path[1:]):
        edge_data = graph.get_edge_data(u, v)
        if edge_data:
            total_length += min([d.get('length', 0) for d in edge_data.values()])
    return total_length

# =========================================================
# GESTIONNAIRE D'ACCESSIBILITÉ ET SÉCURITÉ
# =========================================================
def get_routing_weight(mode, is_pmr, night_intensity="none"):
    def custom_weight(u, v, d):
        edge_data = min(d.values(), key=lambda x: x.get('length', float('inf')))
        l = edge_data.get('length', 1)
        hw = str(edge_data.get('highway', '')).lower()
        
        weight = l
        
        # --- 1. Contrainte PMR ---
        if is_pmr:
            if 'steps' in hw: return 9999999 
            if any(x in hw for x in ['track', 'path']): weight = weight * 2 
                
        # --- 2. Contrainte Nuit ---
        if mode == "nuit":
            if night_intensity == "high":
                # BONUS : On rend les grands axes hyper attractifs (comme s'ils étaient 2x plus courts)
                if any(x in hw for x in ['primary', 'secondary', 'tertiary']):
                    weight = weight * 0.4
                # MALUS : On repousse fortement les zones sombres
                elif any(x in hw for x in ['path', 'footway', 'track', 'park', 'pedestrian']):
                    weight = weight * 5.0
                    
            elif night_intensity == "moderate":
                # Compromis : On ne force pas les grands axes, on évite juste les coupe-gorges
                if any(x in hw for x in ['path', 'track', 'park']):
                    weight = weight * 3.0
                    
        return weight
    return custom_weight

def calculate_wander_route(lat_start, lon_start, lat_end, lon_end, max_detour_min=0, mode="jour", theme="nature", pmr="false"):
    try:
        orig_node = ox.distance.nearest_nodes(G, lon_start, lat_start)
        dest_node = ox.distance.nearest_nodes(G, lon_end, lat_end)

        is_pmr_bool = str(pmr).lower() == "true"

        # 1. On calcule TOUJOURS le trajet le plus court (Base de référence)
        base_weight_func = get_routing_weight("jour", is_pmr_bool)
        try:
            base_route = nx.shortest_path(G, orig_node, dest_node, weight=base_weight_func)
            base_length = get_path_length(G, base_route)
        except nx.NetworkXNoPath:
            return {"error": "Aucun chemin piéton trouvé."}

        best_route = base_route

        # =======================================================
        # LOGIQUE NUIT : DOUBLE CALCUL AVEC BUDGET 5 MINUTES
        # =======================================================
        if mode == "nuit":
            weight_night_high = get_routing_weight("nuit", is_pmr_bool, "high")
            try:
                # On tente le tracé par les grands axes
                night_route = nx.shortest_path(G, orig_node, dest_node, weight=weight_night_high)
                night_length = get_path_length(G, night_route)
                
                # Budget Max : 5 minutes * 80 mètres = 400 mètres de détour autorisé
                if night_length <= base_length + 400:
                    best_route = night_route # Parfait, on valide les grands axes !
                else:
                    # Trop de détour ! On rétrograde sur une sécurisation modérée (Plan B)
                    weight_night_mod = get_routing_weight("nuit", is_pmr_bool, "moderate")
                    best_route = nx.shortest_path(G, orig_node, dest_node, weight=weight_night_mod)
            except nx.NetworkXNoPath:
                pass # En cas d'erreur, on garde le base_route
        
        # =======================================================
        # LOGIQUE JOUR : EXPLORATION NATURE / CULTURE
        # =======================================================
        elif max_detour_min > 0 and mode == "jour":
            budget_distance = base_length + (max_detour_min * VITESSE_PIETON_M_MIN)
            route_coords_nodes = [(G.nodes[n]['x'], G.nodes[n]['y']) for n in base_route]
            
            if len(route_coords_nodes) >= 2:
                base_line = LineString(route_coords_nodes)
                search_buffer = base_line.buffer(0.015) 
                
                datasets_to_search = []
                if theme == "nature":
                    datasets_to_search.extend([gdf_parcs, gdf_eau])
                elif theme == "culture":
                    datasets_to_search.append(gdf_culture)
                
                all_pois = []
                for gdf in datasets_to_search:
                    if not gdf.empty:
                        temp_gdf = gdf.copy()
                        temp_gdf['centroid'] = temp_gdf.geometry.centroid
                        for geom in temp_gdf['centroid']:
                            if geom and not geom.is_empty and search_buffer.intersects(geom):
                                dist = base_line.distance(geom)
                                if dist > 0.001:
                                    all_pois.append((geom.x, geom.y, dist))
                
                if all_pois:
                    all_pois.sort(key=lambda x: x[2], reverse=True)
                    for poi_lon, poi_lat, _ in all_pois[:40]:
                        poi_node = ox.distance.nearest_nodes(G, poi_lon, poi_lat)
                        if poi_node in base_route:
                            continue 
                            
                        try:
                            r1 = nx.shortest_path(G, orig_node, poi_node, weight=base_weight_func)
                            r2 = nx.shortest_path(G, poi_node, dest_node, weight=base_weight_func)
                            d = get_path_length(G, r1) + get_path_length(G, r2)
                            
                            if d <= budget_distance and d > base_length + 20:
                                best_route = r1[:-1] + r2
                                break 
                        except nx.NetworkXNoPath:
                            continue

        # CALCUL PRÉCIS DES MÉTRIQUES
        total_length = get_path_length(G, best_route)
        distance_km = total_length / 1000
        
        total_time_min = int(total_length / VITESSE_PIETON_M_MIN)
        steps_count = int(total_length / LONGUEUR_PAS_M)
        calories_burned = int(distance_km * KCAL_KM) 
        co2_saved_g = int(distance_km * CO2_VOITURE_G_KM)

        # EXTRACTION DE LA GÉOMÉTRIE (Suivi des courbes)
        route_coords = []
        if len(best_route) > 0:
            route_coords.append([G.nodes[best_route[0]]['x'], G.nodes[best_route[0]]['y']])
            
            for i in range(len(best_route) - 1):
                u = best_route[i]
                v = best_route[i+1]
                edge_data = G.get_edge_data(u, v)
                
                if edge_data:
                    best_edge = min(edge_data.values(), key=lambda x: x.get('length', float('inf')))
                    if 'geometry' in best_edge:
                        coords = list(best_edge['geometry'].coords)[1:]
                        route_coords.extend([[x, y] for x, y in coords])
                    else:
                        route_coords.append([G.nodes[v]['x'], G.nodes[v]['y']])

        route_line = LineString(route_coords) if len(route_coords) >= 2 else Point(route_coords[0])
        route_buffer = route_line.buffer(0.001)

        features = []
        features.append({
            "type": "Feature",
            "properties": {
                "type": "Route", 
                "distance_m": round(total_length),
                "time_min": total_time_min, 
                "calories": calories_burned, 
                "co2_saved": co2_saved_g, 
                "steps": steps_count
            },
            "geometry": { "type": "LineString", "coordinates": route_coords }
        })
        
        def safe_val(val):
            return "" if pd.isna(val) or val is None else str(val).strip()

        seen_poi_names = set()

        def add_pois_to_features(gdf, poi_type, name_col):
            if not gdf.empty:
                count = 0
                for _, row in gdf.iterrows():
                    if count > 200: break
                    if row.geometry and route_buffer.intersects(row.geometry):
                        raw_name = safe_val(row.get(name_col))
                        
                        if not raw_name: 
                            continue
                            
                        nom_propre = raw_name
                        poi_key = f"{poi_type}_{nom_propre}"
                        if poi_key in seen_poi_names: 
                            continue
                        
                        seen_poi_names.add(poi_key)
                        props = { "type": poi_type, "nom": nom_propre }
                        
                        if poi_type == "Parc":
                            props["eau"] = safe_val(row.get("point_eau_potable"))
                            props["chiens"] = safe_val(row.get("chiens_autorises"))
                            props["sanitaires"] = safe_val(row.get("sanitaires"))

                        features.append({
                            "type": "Feature",
                            "properties": props,
                            "geometry": { "type": "Point", "coordinates": [row.geometry.centroid.x, row.geometry.centroid.y] }
                        })
                        count += 1

        if mode == "jour":
            if theme == "culture":
                add_pois_to_features(gdf_culture, "Culture", "nom")
            if theme == "nature":
                add_pois_to_features(gdf_parcs, "Parc", "nom_complet")
                add_pois_to_features(gdf_eau, "Eau", "name")

        return { "type": "FeatureCollection", "features": features }

    except Exception as e:
        traceback.print_exc()
        return {"error": f"Erreur interne : {str(e)}"}