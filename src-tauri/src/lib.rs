//! Application Tauri 2 — carnet de bord numérique de navigation.
//! Toute la logique métier vit dans `logbook-core` ; ce crate n'est que le pont
//! commandes ↔ noyau (SQLite, Open-Meteo, photos, transcription).

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::NaiveDateTime;
use logbook_core::db::Store;
use logbook_core::exchange::{export_json, import_from_str, ExchangeError};
use logbook_core::models::*;
use logbook_core::weather::{self, ReqwestClient};
use tauri::Manager;

pub struct AppState {
    store: Mutex<Store>,
    photos_dir: PathBuf,
    http: ReqwestClient,
}

impl AppState {
    fn http_client(&self) -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    }
}

fn parse_naive(s: &str) -> Result<NaiveDateTime, String> {
    let s = s.replace('T', " ");
    NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M"))
        .map_err(|e| format!("date invalide « {s} » : {e}"))
}

fn with_store<R>(state: &tauri::State<AppState>, f: impl FnOnce(&Store) -> Result<R, String>) -> Result<R, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    f(&store)
}

#[tauri::command]
fn list_logs(state: tauri::State<AppState>, filter: LogFilter) -> Result<Vec<Log>, String> {
    with_store(&state, |s| Ok(s.list_logs(&filter).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn get_log(state: tauri::State<AppState>, id: String) -> Result<Option<Log>, String> {
    with_store(&state, |s| Ok(s.get_log(&id).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn save_log(state: tauri::State<AppState>, input: LogInput) -> Result<Log, String> {
    with_store(&state, |s| {
        let use_stardate = s.get_setting("stardate").map_err(|e| e.to_string())?.as_deref() == Some("1");
        Ok(s.save_log(input, use_stardate).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
fn delete_log(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    with_store(&state, |s| {
        let photos = s.list_photos(&id).map_err(|e| e.to_string())?;
        for p in photos {
            let _ = std::fs::remove_file(state.photos_dir.join(PathBuf::from(&p.rel_path).file_name().unwrap_or_default()));
        }
        Ok(s.delete_log(&id).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
fn last_log(state: tauri::State<AppState>) -> Result<Option<Log>, String> {
    with_store(&state, |s| Ok(s.last_log().map_err(|e| e.to_string())?))
}

#[tauri::command]
fn last_position(state: tauri::State<AppState>) -> Result<Option<(f64, f64)>, String> {
    with_store(&state, |s| Ok(s.last_position().map_err(|e| e.to_string())?))
}

#[tauri::command]
fn list_navigations(state: tauri::State<AppState>) -> Result<Vec<Navigation>, String> {
    with_store(&state, |s| Ok(s.list_navigations().map_err(|e| e.to_string())?))
}

#[tauri::command]
fn rename_navigation(state: tauri::State<AppState>, id: String, name: String) -> Result<(), String> {
    with_store(&state, |s| Ok(s.rename_navigation(&id, &name).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Result<Vec<(String, String)>, String> {
    with_store(&state, |s| Ok(s.all_settings().map_err(|e| e.to_string())?))
}

#[tauri::command]
fn set_setting(state: tauri::State<AppState>, key: String, value: String) -> Result<(), String> {
    with_store(&state, |s| Ok(s.set_setting(&key, &value).map_err(|e| e.to_string())?))
}

/// Météo Open-Meteo pour (lat, lon) à l'instant donné (courant ou passé ≤ 92 j).
/// Renvoie "OFFLINE" si le réseau est indisponible.
#[tauri::command]
async fn fetch_weather(state: tauri::State<'_, AppState>, lat: f64, lon: f64, datetime: String) -> Result<Weather, String> {
    let dt = parse_naive(&datetime)?;
    weather::fetch_weather(&state.http, lat, lon, dt)
        .await
        .map_err(|e| match e {
            weather::WeatherError::Offline => "OFFLINE".to_string(),
            other => other.to_string(),
        })
}

/// File d'attente : re-tente la météo des logs enregistrés hors ligne.
#[tauri::command]
async fn retry_pending_weather(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let pending = with_store(&state, |s| Ok(s.pending_weather_logs().map_err(|e| e.to_string())?))?;
    let mut updated = Vec::new();
    for log in pending {
        if let (Some(lat), Some(lon)) = (log.lat, log.lon) {
            if let Ok(w) = weather::fetch_weather(&state.http, lat, lon, log.log_datetime).await {
                let captured = now_local();
                let r = with_store(&state, |s| {
                    s.update_weather(&log.id, &w, captured, WeatherSource::OpenMeteo, false)
                        .map_err(|e| e.to_string())
                });
                if r.is_ok() {
                    updated.push(log.id);
                }
            }
        }
    }
    Ok(updated)
}

#[tauri::command]
fn add_photo(state: tauri::State<AppState>, log_id: String, file_name: String, bytes: Vec<u8>) -> Result<Photo, String> {
    let id = new_id();
    let safe_name = format!("{id}.jpg");
    std::fs::write(state.photos_dir.join(&safe_name), &bytes).map_err(|e| e.to_string())?;
    with_store(&state, |s| {
        Ok(s.add_photo(&log_id, &file_name, &format!("photos/{safe_name}"), bytes.len() as i64).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
fn list_photos(state: tauri::State<AppState>, log_id: String) -> Result<Vec<Photo>, String> {
    with_store(&state, |s| Ok(s.list_photos(&log_id).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn delete_photo(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    with_store(&state, |s| {
        if let Some(p) = s.delete_photo(&id).map_err(|e| e.to_string())? {
            let _ = std::fs::remove_file(state.photos_dir.join(PathBuf::from(&p.rel_path).file_name().unwrap_or_default()));
        }
        Ok(())
    })
}

#[tauri::command]
fn photo_path(state: tauri::State<AppState>, id: String) -> Result<Option<String>, String> {
    with_store(&state, |s| {
        Ok(s.get_photo(&id)
            .map_err(|e| e.to_string())?
            .map(|p| state.photos_dir.join(PathBuf::from(&p.rel_path).file_name().unwrap_or_default()).to_string_lossy().to_string()))
    })
}

#[tauri::command]
fn export_json_cmd(state: tauri::State<AppState>) -> Result<String, String> {
    with_store(&state, |s| {
        let photos_dir = state.photos_dir.clone();
        let loader = move |p: &Photo| -> Option<Vec<u8>> {
            let name = PathBuf::from(&p.rel_path).file_name()?.to_string_lossy().to_string();
            std::fs::read(photos_dir.join(name)).ok()
        };
        let export = export_json(s, &loader).map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn import_json_cmd(state: tauri::State<AppState>, json: String) -> Result<usize, String> {
    with_store(&state, |s| {
        let photos_dir = state.photos_dir.clone();
        let writer = move |p: &Photo, data: &Option<String>| -> Result<String, ExchangeError> {
            use base64::Engine;
            let name = format!("{}.jpg", p.id);
            if let Some(b64) = data {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| ExchangeError::MissingPhotoData(e.to_string()))?;
                std::fs::write(photos_dir.join(&name), bytes).map_err(ExchangeError::Io)?;
            }
            Ok(format!("photos/{name}"))
        };
        import_from_str(s, &json, &writer).map_err(|e| e.to_string())
    })
}

/// Transcription vocale : mode « mistral » (API) ou « local » (binaire whisper.cpp).
/// L'audio n'est jamais écrit ailleurs qu'un fichier temporaire supprimé ensuite.
#[tauri::command]
async fn transcribe_audio(state: tauri::State<'_, AppState>, bytes: Vec<u8>, mime: String) -> Result<String, String> {
    let (mode, key, model, base, binary, model_path, lang) = with_store(&state, |s| {
        let g = |k: &str| s.get_setting(k).ok().flatten().unwrap_or_default();
        Ok((
            g("transcription_mode"),
            g("mistral_api_key"),
            g("mistral_model"),
            g("mistral_base_url"),
            g("whisper_binary"),
            g("whisper_model_path"),
            g("dictation_language"),
        ))
    })?;
    let ext = if mime.contains("ogg") { "ogg" } else if mime.contains("mp4") { "m4a" } else { "webm" };
    match mode.as_str() {
        "none" => Err("Transcription désactivée dans les réglages".into()),
        "mistral" => {
            if key.trim().is_empty() {
                return Err("Clé API Mistral manquante (réglages)".into());
            }
            let base = if base.trim().is_empty() { "https://api.mistral.ai/v1".to_string() } else { base.trim_end_matches('/').to_string() };
            let model = if model.trim().is_empty() { "whisper-large-v3".to_string() } else { model };
            let lang = if lang.trim().is_empty() { "fr".to_string() } else { lang };
            let form = reqwest::multipart::Form::new()
                .text("model", model)
                .text("language", lang)
                .text("response_format", "text")
                .part("file", reqwest::multipart::Part::bytes(bytes).file_name(format!("audio.{ext}")));
            let resp = state
                .http_client()
                .post(format!("{base}/audio/transcriptions"))
                .bearer_auth(key)
                .multipart(form)
                .send()
                .await
                .map_err(|e| if e.is_connect() { "OFFLINE".to_string() } else { e.to_string() })?;
            let status = resp.status();
            let body = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Err(format!("API Mistral HTTP {status} : {}", &body[..body.len().min(200)]));
            }
            if body.trim_start().starts_with('{') {
                let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
                Ok(v["text"].as_str().unwrap_or("").to_string())
            } else {
                Ok(body.trim().to_string())
            }
        }
        "local" => {
            if binary.trim().is_empty() || model_path.trim().is_empty() {
                return Err("Binaire et modèle Whisper local à configurer dans les réglages".into());
            }
            let tmp = state.photos_dir.join(format!(".tmp-audio-{}.{ext}", new_id()));
            std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            let out = std::process::Command::new(binary.trim())
                .arg("-m").arg(model_path.trim())
                .arg("-f").arg(&tmp)
                .arg("-l").arg(if lang.trim().is_empty() { "fr" } else { lang.trim() })
                .arg("-nt")
                .output();
            let _ = std::fs::remove_file(&tmp);
            let out = out.map_err(|e| format!("lancement de {} impossible : {e}", binary.trim()))?;
            if !out.status.success() {
                return Err(format!("whisper a échoué : {}", String::from_utf8_lossy(&out.stderr)));
            }
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }
        other => Err(format!("Mode de transcription inconnu : {other}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let photos_dir = data_dir.join("photos");
            std::fs::create_dir_all(&photos_dir).map_err(|e| e.to_string())?;
            let store = Store::open(data_dir.join("logbook.db").to_str().ok_or("chemin invalide")?).map_err(|e| e.to_string())?;
            let http = ReqwestClient::new().map_err(|e| e.to_string())?;
            app.manage(AppState { store: Mutex::new(store), photos_dir, http });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_logs,
            get_log,
            save_log,
            delete_log,
            last_log,
            last_position,
            list_navigations,
            rename_navigation,
            get_settings,
            set_setting,
            fetch_weather,
            retry_pending_weather,
            add_photo,
            list_photos,
            delete_photo,
            photo_path,
            export_json_cmd,
            import_json_cmd,
            transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
