use chrono::{DateTime, Datelike, Local, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Log {
    pub id: String,
    /// Date/heure du log (choisie par l'utilisateur, modifiable).
    pub log_datetime: NaiveDateTime,
    pub stardate: Option<String>,
    pub vessel: String,
    pub departure: String,
    pub destination: String,
    pub heading_deg: Option<f64>,
    pub speed_kn: Option<f64>,
    pub sails: String,
    pub crew: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub position_source: PositionSource,
    pub observations: String,
    pub weather: Option<Weather>,
    /// Horodatage de la capture des données automatiques.
    pub weather_captured_at: Option<NaiveDateTime>,
    pub weather_source: WeatherSource,
    /// Champs écrasés manuellement (ex: ["wind", "lat"]).
    pub overrides: Vec<String>,
    pub offline: bool,
    pub navigation_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositionSource {
    Gps,
    LastKnown,
    Manual,
}

impl Default for PositionSource {
    fn default() -> Self {
        PositionSource::Manual
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeatherSource {
    OpenMeteo,
    Manual,
    Offline,
}

impl Default for WeatherSource {
    fn default() -> Self {
        WeatherSource::OpenMeteo
    }
}

/// Instantané météo capturé automatiquement (Open-Meteo) ou saisi manuellement.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Weather {
    // Vent
    pub wind_speed_ms: Option<f64>,
    pub wind_gust_ms: Option<f64>,
    pub wind_dir_deg: Option<f64>,
    pub beaufort: Option<u8>,
    // Ciel
    pub wmo_code: Option<i64>,
    pub cloud_cover_pct: Option<f64>,
    pub precipitation_mm: Option<f64>,
    pub visibility_m: Option<f64>,
    // Mer
    pub wave_height_m: Option<f64>,
    pub wave_dir_deg: Option<f64>,
    pub wave_period_s: Option<f64>,
    pub sea_temp_c: Option<f64>,
    pub sea_state: Option<String>,
    // Air
    pub temp_air_c: Option<f64>,
    pub pressure_hpa: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub id: String,
    pub log_id: String,
    pub file_name: String,
    /// Chemin relatif (mode Tauri) ou data URL (mode navigateur).
    pub rel_path: String,
    pub size_bytes: i64,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Navigation {
    pub id: String,
    pub name: String,
    pub vessel: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationSummary {
    pub navigation: Navigation,
    pub log_ids: Vec<String>,
    pub start: Option<NaiveDateTime>,
    pub end: Option<NaiveDateTime>,
    pub duration_hours: Option<f64>,
    /// Distance en milles marins, somme des haversines entre positions connues.
    pub distance_nm: Option<f64>,
    pub avg_wind_ms: Option<f64>,
    pub avg_temp_c: Option<f64>,
    pub max_wave_m: Option<f64>,
    pub status: NavigationStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NavigationStatus {
    Ongoing,
    Finished,
}

/// Payload envoyé par le client pour créer/modifier un log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogInput {
    pub id: Option<String>,
    pub log_datetime: NaiveDateTime,
    pub vessel: String,
    pub departure: String,
    pub destination: String,
    pub heading_deg: Option<f64>,
    pub speed_kn: Option<f64>,
    pub sails: String,
    pub crew: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub position_source: PositionSource,
    pub observations: String,
    pub weather: Option<Weather>,
    pub weather_captured_at: Option<NaiveDateTime>,
    pub weather_source: WeatherSource,
    pub overrides: Vec<String>,
    pub offline: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LogFilter {
    pub query: Option<String>,
    pub vessel: Option<String>,
    pub navigation_id: Option<String>,
    pub from: Option<NaiveDateTime>,
    pub to: Option<NaiveDateTime>,
}

pub fn now_local() -> NaiveDateTime {
    Local::now().naive_local()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Stardate façon TNG (option d'affichage paramétrable) :
/// (année − 2323) × 1000 + (jour de l'année − 1 + fraction de journée) / 365,25 × 1000.
pub fn stardate(dt: &DateTime<Local>) -> String {
    let year = dt.year() as f64;
    let day_of_year = dt.ordinal() as f64;
    let hour = dt.hour() as f64 + dt.minute() as f64 / 60.0 + dt.second() as f64 / 3600.0;
    let stardate = (year - 2323.0) * 1000.0 + ((day_of_year - 1.0) + hour / 24.0) / 365.25 * 1000.0;
    format!("{:.2}", stardate)
}
