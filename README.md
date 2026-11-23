# ⚓ Carnet de bord — journal de bord maritime numérique

Application de bureau (macOS / Windows) pour tenir un **journal de bord de voile**, dans l'esprit
« l'ordinateur orchestre le contexte (date, heure, position, météo, mer, vent), le capitaine dicte ses observations ».

- **100 % local** : SQLite embarquée, aucune donnée ne quitte la machine (sauf appels Open-Meteo,
  et l'API de transcription si vous choisissez le mode Mistral).
- **Fonctionne hors ligne** de bout en bout (saisie manuelle, file d'attente météo, Whisper local possible).
- **Stack** : Tauri 2 (Rust) + React/TypeScript/Vite, noyau métier pur `logbook-core` partagé (réutilisable mobile).

## Démarrage rapide

```bash
# 1. dépendances front
npm install

# 2. mode développement (app Tauri + serveur Vite)
npm run tauri dev

# 3. build de production (macOS/Windows)
npm run tauri build
```

Pré-requis : Node 20+, Rust (stable), et les [prérequis Tauri 2](https://v2.tauri.app/start/prerequisites/)
(Xcode CLT sur macOS, WebView2 + MSVC sur Windows). Voir [docs/INSTALL.md](docs/INSTALL.md).

Mode navigateur (démo sans Tauri, stockage localStorage) : `npm run dev` puis ouvrir http://localhost:5173.

## Tests

```bash
cargo test -p logbook-core      # noyau Rust (météo, géo, DB, export/import, navigations)
cargo run -p logbook-core --example live_weather   # smoke test live contre Open-Meteo
npm test                        # utilitaires front (vitest)
npm run build                   # typecheck + build front
```

## Fonctionnalités (jalons J1–J3 du cahier des charges)

- **Session « Enregistrer un log »** : date/heure auto, position (GPS si dispo, sinon dernière position connue,
  sinon saisie manuelle en décimal / degrés-minutes / degrés-minutes-secondes), météo Open-Meteo auto
  (vent + force Beaufort + point cardinal, ciel WMO, houle/état de la mer/température de l'eau, air),
  navire/route/cap/vitesse/voiles/équipage pré-remplis depuis la dernière entrée, observations en dictée ou clavier.
- **Règles du CDC** : champs auto recapturés à l'enregistrement (pas à l'ouverture) ; toute valeur auto écrasable
  et marquée « ✍️ modifié » ; changement de date → proposition de rafraîchir la météo ; tags **AUTO / MANUEL**.
- **Dictée vocale** : enregistrement micro, transcription (Mistral API ou Whisper local whisper.cpp),
  texte inséré éditable, **audio jamais conservé**.
- **Journal** : logs groupés par navigation (écart < 48 h, même navire), recherche plein texte,
  filtres date/navire/navigation, édition et suppression, récapitulatif (durée, distance haversine, météo moyenne).
- **Photos** : glisser-déposer/import, compression locale < 300 Ko, suppression individuelle.
- **Hors ligne** : bannière ambrée, champs météo en « MANUEL », file d'attente re-tentée automatiquement
  (météo historique Open-Meteo jusqu'à ~92 jours).
- **Export / import JSON** complet (logs + photos en base64 + navigations + réglages).
- **Design** : palette « nuit marine » sombre (#071120 / #0f2438 / #6db3dd / rouge #d9534f réservé à l'enregistrement,
  ambre #d9a441 au mode manuel), stardate optionnelle, toast « Log enregistré — 14:32 », accessibilité clavier/AA.

J4 (post-MVP) : commandes vocales complètes, export PDF/HTML d'une navigation, thème clair, mobile.

## Arborescence

```
logbook/
├── crates/core/          # logbook-core : noyau Rust pur (testé, sans dépendance Tauri)
│   └── src/{models,db,geo,weather,navigation,exchange}.rs
├── src-tauri/            # app Tauri 2 : commandes, persistance disque, transcription
├── src/                  # frontend React/TS
│   ├── lib/{types,format,backend,photos}.ts
│   ├── components/{WeatherPanel,Dictation,PhotoEditor,bits}.tsx
│   └── views/{Journal,LogSession,SettingsView}.tsx
└── docs/                 # INSTALL.md, ARCHITECTURE.md
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le schéma de données et le flux hors ligne.
