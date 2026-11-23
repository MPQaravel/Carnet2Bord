# Installation et paramétrage

## Pré-requis

| Plateforme | Pré-requis |
|---|---|
| macOS | Xcode Command Line Tools (`xcode-select --install`), Node 20+, Rust (`curl https://sh.rustup.rs -sSf \| sh`) |
| Windows | Node 20+, Rust (rustup), [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (inclus sur Windows 11), MSVC Build Tools |
| Linux (dev) | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `pkg-config` |

## Installation

```bash
git clone <ce dépôt> && cd logbook
npm install
npm run tauri dev        # développement
npm run tauri build      # binaire + installateur (dossier src-tauri/target/release/bundle)
```

La base de données est un fichier unique : `app_data_dir/logbook.db` (macOS : `~/Library/Application Support/com.logbook.carnetdebord/`,
Windows : `%APPDATA%\com.logbook.carnetdebord\`). Les photos sont dans `photos/` à côté. Sauvegardez ce dossier, ou utilisez
**Réglages → Exporter tout en JSON**.

## Paramétrage

### Météo (Open-Meteo)
Aucun réglage requis : gratuit, sans clé. Appels sur `api.open-meteo.com` (vent/ciel/air) et
`marine-api.open-meteo.com` (houle, température de l'eau). Historique jusqu'à ~92 jours dans le passé.

### Dictée vocale (transcription)
Deux modes dans **Réglages → Dictée vocale** :

1. **Mistral API** (par défaut) : créez une clé sur [console.mistral.ai](https://console.mistral.ai),
   collez-la dans « Clé API Mistral », modèle `whisper-large-v3`. L'audio est envoyé à l'API **uniquement**
   pour transcription, puis descarté (jamais stocké).
2. **Whisper local** (100 % hors ligne, recommandé en mer) : installez
   [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`whisper-cli`), téléchargez un modèle
   (`./models/download-ggml-model.sh base` → `ggml-base.bin`), puis renseignez « Binaire whisper-cli »
   et « Modèle ggml (chemin) ».

Langue de dictée : champ « fr » (modifiable).

### Position
- Priorité au GPS quand il existe (mobile) ; sur desktop : dernière position connue, puis saisie manuelle.
- Trois formats acceptés : décimal `48.6542, -4.4861` · degrés-minutes `48°39.25'N 4°29.17'W` ·
  degrés-minutes-secondes `48°39'15"N 4°29'10"W`. Le format d'affichage/saisie par défaut se règle
  dans **Réglages → Format de saisie de position**.

### Thème et stardate
Thème « nuit marine » sombre par défaut (thème clair en phase 2). Numérotation stardate des entrées
activable/désactivable dans **Réglages → Affichage**.

## Hors ligne

Aucune fonctionnalité ne bloque sans réseau : bannière ambrée, champs météo en saisie manuelle (« MANUEL »),
les logs enregistrés hors ligne passent en file d'attente et leur météo est re-récupérée automatiquement
à la reconnexion (bouton « Réessayer » de la bannière ou **Réglages → Récupérer la météo en attente**).

## Export / import

**Réglages → Données** : export JSON complet (logs, photos compressées en base64, navigations, réglages)
et import qui remplace les données (migration machine, sauvegarde).
