//! Export / import JSON complet (sauvegarde, migration entre machines).
//! Les photos sont embarquées en base64 (déjà compressées < 300 Ko côté client).

use std::path::Path;

use base64::Engine;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::{DbError, Store};
use crate::models::*;

pub const EXPORT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ExchangeError {
    #[error(transparent)]
    Db(#[from] DbError),
    #[error("json : {0}")]
    Json(#[from] serde_json::Error),
    #[error("io : {0}")]
    Io(#[from] std::io::Error),
    #[error("format d'export non supporté (version {0})")]
    UnsupportedVersion(u32),
    #[error("donnée photo introuvable : {0}")]
    MissingPhotoData(String),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportFile {
    pub app: String,
    pub version: u32,
    pub exported_at: String,
    pub settings: Vec<(String, String)>,
    pub navigations: Vec<Navigation>,
    pub logs: Vec<Log>,
    pub photos: Vec<PhotoExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoExport {
    #[serde(flatten)]
    pub photo: Photo,
    /// Contenu binaire en base64 (mode Tauri : lu depuis le disque ; navigateur : data URL d'origine).
    pub data_base64: Option<String>,
}

/// Exporte toute la base en JSON. `photo_loader` fournit le contenu d'une photo
/// à partir de son `rel_path` (None si indisponible).
pub fn export_json(
    store: &Store,
    photo_loader: &dyn Fn(&Photo) -> Option<Vec<u8>>,
) -> Result<ExportFile, ExchangeError> {
    let logs = store.all_logs_raw()?;
    let photos = store.all_photos_raw()?;
    let photo_exports = photos
        .into_iter()
        .map(|p| PhotoExport {
            data_base64: photo_loader(&p).map(|b| base64::engine::general_purpose::STANDARD.encode(b)),
            photo: p,
        })
        .collect();
    Ok(ExportFile {
        app: "logbook".into(),
        version: EXPORT_VERSION,
        exported_at: now_local().to_string(),
        settings: store.all_settings()?,
        navigations: store.list_navigations()?,
        logs,
        photos: photo_exports,
    })
}

pub fn export_to_path(store: &Store, path: &Path, photo_loader: &dyn Fn(&Photo) -> Option<Vec<u8>>) -> Result<ExportFile, ExchangeError> {
    let export = export_json(store, photo_loader)?;
    let json = serde_json::to_string_pretty(&export)?;
    std::fs::write(path, json)?;
    Ok(export)
}

/// Importe un export JSON : remplace le contenu des tables logs/photos/navigations
/// (les réglages sont fusionnés). `photo_writer` persiste le contenu d'une photo
/// et retourne le `rel_path` à stocker.
pub fn import_from_str(
    store: &Store,
    json: &str,
    photo_writer: &dyn Fn(&Photo, &Option<String>) -> Result<String, ExchangeError>,
) -> Result<usize, ExchangeError> {
    let export: ExportFile = serde_json::from_str(json)?;
    if export.version != EXPORT_VERSION {
        return Err(ExchangeError::UnsupportedVersion(export.version));
    }
    store.clear_all()?;
    for (k, v) in &export.settings {
        store.set_setting(k, v)?;
    }
    for n in &export.navigations {
        store.conn_execute_navigation(n)?;
    }
    let mut count = 0;
    for l in &export.logs {
        store.insert_log_raw(l)?;
        count += 1;
    }
    for p in &export.photos {
        let rel = photo_writer(&p.photo, &p.data_base64)?;
        store.insert_photo_raw(&Photo { rel_path: rel, ..p.photo.clone() })?;
    }
    Ok(count)
}

pub fn import_from_path(
    store: &Store,
    path: &Path,
    photo_writer: &dyn Fn(&Photo, &Option<String>) -> Result<String, ExchangeError>,
) -> Result<usize, ExchangeError> {
    let json = std::fs::read_to_string(path)?;
    import_from_str(store, &json, photo_writer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Store;
    use chrono::NaiveDateTime;

    #[test]
    fn export_import_roundtrip() {
        let s = Store::in_memory().unwrap();
        s.set_setting("theme", "dark").unwrap();
        let input = LogInput {
            id: None,
            log_datetime: NaiveDateTime::parse_from_str("2026-06-01 10:00:00", "%Y-%m-%d %H:%M:%S").unwrap(),
            vessel: "Kraken".into(),
            departure: "Brest".into(),
            destination: "Les Glénan".into(),
            heading_deg: Some(180.0),
            speed_kn: Some(5.5),
            sails: "GV 2 ris".into(),
            crew: "Alice".into(),
            lat: Some(48.39),
            lon: Some(-4.48),
            position_source: PositionSource::Manual,
            observations: "Mouillage aux Glénan".into(),
            weather: Some(Weather { wind_speed_ms: Some(6.0), beaufort: Some(4), wmo_code: Some(1), ..Default::default() }),
            weather_captured_at: Some(NaiveDateTime::parse_from_str("2026-06-01 10:00:00", "%Y-%m-%d %H:%M:%S").unwrap()),
            weather_source: WeatherSource::OpenMeteo,
            overrides: vec!["wind".into()],
            offline: false,
        };
        let log = s.save_log(input, true).unwrap();
        let photo = s.add_photo(&log.id, "mouillage.jpg", "photos/mouillage.jpg", 250_000).unwrap();

        // Export avec contenu photo simulé
        let loader = |p: &Photo| -> Option<Vec<u8>> {
            if p.id == photo.id { Some(b"FAKEJPEG".to_vec()) } else { None }
        };
        let export = export_json(&s, &loader).unwrap();
        let json = serde_json::to_string_pretty(&export).unwrap();

        // Import dans une nouvelle base
        let s2 = Store::in_memory().unwrap();
        let writer = |p: &Photo, data: &Option<String>| -> Result<String, ExchangeError> {
            assert!(data.is_some());
            Ok(format!("imported/{}", p.file_name))
        };
        let n = import_from_str(&s2, &json, &writer).unwrap();
        assert_eq!(n, 1);
        let logs = s2.all_logs_raw().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].observations, "Mouillage aux Glénan");
        assert_eq!(logs[0].overrides, vec!["wind".to_string()]);
        assert_eq!(logs[0].weather.as_ref().unwrap().beaufort, Some(4));
        assert_eq!(logs[0].navigation_id, log.navigation_id);
        assert_eq!(s2.list_navigations().unwrap().len(), 1);
        let photos = s2.all_photos_raw().unwrap();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].rel_path, "imported/mouillage.jpg");
        assert_eq!(s2.get_setting("theme").unwrap().unwrap(), "dark");
    }

    #[test]
    fn import_rejects_bad_version() {
        let s = Store::in_memory().unwrap();
        let bad = r#"{"app":"logbook","version":99,"exported_at":"","settings":[],"navigations":[],"logs":[],"photos":[]}"#;
        let writer = |_: &Photo, _: &Option<String>| Ok(String::new());
        let r = import_from_str(&s, bad, &writer);
        assert!(matches!(r, Err(ExchangeError::UnsupportedVersion(99))));
    }
}
