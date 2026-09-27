import geopandas as gpd

print("Lecture du fichier lieux_culturels.geojson...")
try:
    gdf = gpd.read_file("data/lieux_culturels.geojson")
    
    col = 'presentation'
    
    if col in gdf.columns:
        print(f"\n--- Valeurs trouvées dans la colonne '{col}' ---")
        valeurs = sorted(gdf[col].dropna().astype(str).unique())
        for cat in valeurs:
            print(f"- {cat}")
    else:
        print(f"\n⚠️ La colonne '{col}' n'existe pas dans le fichier.")
        print("Voici les colonnes qui existent vraiment :")
        print(gdf.columns.tolist())

except Exception as e:
    print(f"Erreur lors de la lecture : {e}")