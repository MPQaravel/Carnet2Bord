# Architecture

## Vue d'ensemble

```
┌──────────────────────────────┐     commandes Tauri      ┌─────────────────────────────┐
│  Frontend React/TS (Vite)    │ ◄──────────────────────► │  src-tauri (Rust, Tauri 2)  │
│  src/lib/backend.ts          │   invoke() / événements  │  commandes → logbook-core   │
│  (mode navigateur :          │                          │  + photos disque + Whisper  │
│   localStorage pour le dev)  │                          └──────────┬──────────────────┘
└──────────────────────────────┘                                     │
                                                          ┌──────────▼──────────────────┐
                                                          │  crates/core (logbook-core) │
                                                          │  modèles, SQLite, Open-Meteo│
                                                          │  géo/Beaufort, navigations, │
                                                          │  export/import — testé, pur │
                                                          └─────────────────────────────┘
                                                                     │ HTTP (rustls)
                                                          ┌──────────▼──────────────────┐
                                                          │  api.open-meteo.com         │
                                                          │  marine-api.open-meteo.com  │
                                                          └─────────────────────────────┘
```

Le noyau `logbook-core` ne dépend pas de Tauri : la même logique est réutilisable pour une future
version mobile (le frontend a d'ailleurs un backend navigateur de secours pour le dev).

## Schéma SQLite (`logbook.db`)

- `logs(id, log_datetime, stardate, vessel, departure, destination, heading_deg, speed_kn, sails, crew,
  lat, lon, position_source, observations, weather_json, weather_captured_at, weather_source,
  overrides_json, offline, navigation_id, created_at, updated_at)`
- `photos(id, log_id, file_name, rel_path, size_bytes, created_at)` — fichiers dans `app_data_dir/photos/`
- `navigations(id, name, vessel, created_at)`
- `settings(key, value)` — thème, stardate, transcription, format de position…

`weather_json` embarque le bloc météo complet ; `weather_captured_at` trace l'horodatage de capture ;
`overrides_json` liste les champs écrasés manuellement (« ✍️ modifié » côté UI).

## Règles métier clés

- **Capture à l'enregistrement** : le front re-appelle `fetch_weather(lat, lon, log_datetime)` au moment
  d'enregistrer (et non à l'ouverture de la session) pour les blocs non modifiés manuellement.
- **Navigation** : même navire (insensible à la casse) + écart < 48 h entre logs consécutifs → même navigation.
- **Distance** : somme des haversines entre positions connues d'une navigation (milles marins).
- **Beaufort** : bornes WMO en m/s ; direction en points cardinaux à 16 branches ; état de la mer
  (Douglas) dérivé de la houle, sinon du vent.
- **Météo** : forecast (vent/ciel/air, `current` + `hourly`) et marine-api (houle, SST) ; on prend l'heure
  horaire la plus proche de l'instant du log. Passé ≤ 92 j : `start_date`/`end_date`.
- **Hors ligne** : `weather_json` vide + `offline=1` → file d'attente (`pending_weather_logs`),
  re-tentée par `retry_pending_weather`.
- **Export JSON** : `{app, version:1, settings, navigations, logs, photos:[…+data_base64]}` ; l'import
  remplace les tables (photos réécrites sur disque).

## Sécurité / vie privée

CSP Tauri restrictive (`default-src 'self'`, images `asset:`/`data:`/`blob:`). Seuls les appels réseau
sortants sont Open-Meteo (météo) et, si activé, l'API Mistral (audio de dictée uniquement, jamais stocké).
