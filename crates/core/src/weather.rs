//! Météo Open-Meteo : forecast (vent, ciel, air) + marine-api (houle, température de l'eau).
//! Gratuit, sans clé. Historique possible jusqu'à ~92 jours via start_date/end_date.

use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

use crate::geo::{beaufort_from_ms, cardinal, sea_state};
use crate::models::Weather;

pub const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
pub const MARINE_URL: &str = "https://marine-api.open-meteo.com/v1/marine";
/// Au-delà de ~92 jours dans le passé, Open-Meteo ne fournit plus d'historique.
pub const HISTORY_DAYS_LIMIT: i64 = 92;

#[derive(Debug, Error)]
pub enum WeatherError {
    #[error("appel Open-Meteo en échec : {0}")]
    Http(String),
    #[error("réponse Open-Meteo invalide : {0}")]
    Parse(String),
    #[error("hors ligne ou réseau indisponible")]
    Offline,
}

/// URLs construites pour un point et un instant donné (instant courant ou passé ≤ 92 j).
pub fn forecast_url(lat: f64, lon: f64, target: NaiveDateTime) -> String {
    let today = chrono::Local::now().date_naive();
    let date = target.date();
    let past = date < today;
    let mut url = format!(
        "{FORECAST_URL}?latitude={lat:.4}&longitude={lon:.4}&timezone=auto&wind_speed_unit=ms"
    );
    url.push_str("&current=temperature_2m,weather_code,cloud_cover,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    url.push_str("&hourly=temperature_2m,weather_code,cloud_cover,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility");
    if past {
        let d: NaiveDate = date;
        url.push_str(&format!("&start_date={}&end_date={}", d.format("%Y-%m-%d"), d.format("%Y-%m-%d")));
    } else {
        url.push_str("&forecast_days=1");
    }
    url
}

pub fn marine_url(lat: f64, lon: f64, target: NaiveDateTime) -> String {
    let today = chrono::Local::now().date_naive();
    let date = target.date();
    let mut url = format!("{MARINE_URL}?latitude={lat:.4}&longitude={lon:.4}&timezone=auto");
    url.push_str("&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature");
    if date < today {
        url.push_str(&format!("&start_date={}&end_date={}", date.format("%Y-%m-%d"), date.format("%Y-%m-%d")));
    } else {
        url.push_str("&forecast_days=1");
    }
    url
}

/// Abstraction HTTP pour permettre les tests hors ligne.
#[async_trait::async_trait]
pub trait HttpClient: Send + Sync {
    async fn get_json(&self, url: &str) -> Result<Value, WeatherError>;
}

pub struct ReqwestClient {
    client: reqwest::Client,
}

impl ReqwestClient {
    pub fn new() -> Result<Self, WeatherError> {
        let client = reqwest::Client::builder()
            .user_agent("logbook-app/0.1 (carnet de bord)")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| WeatherError::Http(e.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait::async_trait]
impl HttpClient for ReqwestClient {
    async fn get_json(&self, url: &str) -> Result<Value, WeatherError> {
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    WeatherError::Offline
                } else {
                    WeatherError::Http(e.to_string())
                }
            })?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| WeatherError::Http(e.to_string()))?;
        if !status.is_success() {
            return Err(WeatherError::Http(format!("HTTP {status}: {}", &body[..body.len().min(200)])));
        }
        serde_json::from_str(&body).map_err(|e| WeatherError::Parse(e.to_string()))
    }
}

/// Récupère la météo pour (lat, lon) à l'instant `target` (courant ou passé ≤ 92 j).
pub async fn fetch_weather<C: HttpClient>(http: &C, lat: f64, lon: f64, target: NaiveDateTime) -> Result<Weather, WeatherError> {
    let f_url = forecast_url(lat, lon, target);
    let m_url = marine_url(lat, lon, target);
    let (f, m) = tokio::join!(http.get_json(&f_url), http.get_json(&m_url));
    let forecast = f?;
    let marine = m.unwrap_or_else(|_| Value::Null); // la houle est optionnelle
    Ok(build_weather(&forecast, &marine, target))
}

/// Construit le bloc météo à partir des réponses JSON brutes, en prenant l'heure
/// horaire la plus proche de `target` (les blocs `current` servent de secours).
pub fn build_weather(forecast: &Value, marine: &Value, target: NaiveDateTime) -> Weather {
    let mut w = Weather::default();

    let cur = &forecast["current"];
    let hourly = &forecast["hourly"];
    let times = hourly["time"].as_array();

    // Indice de l'heure la plus proche de target.
    let idx = times
        .and_then(|ts| {
            ts.iter()
                .enumerate()
                .filter_map(|(i, t)| {
                    NaiveDateTime::parse_from_str(t.as_str()?, "%Y-%m-%dT%H:%M")
                        .ok()
                        .map(|dt| (i, (dt - target).num_seconds().abs()))
                })
                .min_by_key(|(_, d)| *d)
                .map(|(i, _)| i)
        })
        .unwrap_or(usize::MAX);

    let pick = |key: &str| -> Option<f64> {
        hourly[key]
            .as_array()
            .and_then(|a| a.get(idx))
            .and_then(|v| v.as_f64())
            .or_else(|| cur[key].as_f64())
    };

    w.temp_air_c = pick("temperature_2m");
    w.wmo_code = pick("weather_code").map(|v| v as i64).or_else(|| cur["weather_code"].as_i64());
    w.cloud_cover_pct = pick("cloud_cover");
    w.precipitation_mm = pick("precipitation");
    w.pressure_hpa = pick("pressure_msl");
    w.wind_speed_ms = pick("wind_speed_10m");
    w.wind_dir_deg = pick("wind_direction_10m").map(|d| d.rem_euclid(360.0));
    w.wind_gust_ms = pick("wind_gusts_10m");
    w.visibility_m = pick("visibility").or_else(|| cur["visibility"].as_f64());
    w.beaufort = w.wind_speed_ms.map(beaufort_from_ms);

    let mh = &marine["hourly"];
    let mtimes = mh["time"].as_array();
    let midx = mtimes
        .and_then(|ts| {
            ts.iter()
                .enumerate()
                .filter_map(|(i, t)| {
                    NaiveDateTime::parse_from_str(t.as_str()?, "%Y-%m-%dT%H:%M")
                        .ok()
                        .map(|dt| (i, (dt - target).num_seconds().abs()))
                })
                .min_by_key(|(_, d)| *d)
                .map(|(i, _)| i)
        })
        .unwrap_or(usize::MAX);
    let mpick = |key: &str| -> Option<f64> {
        mh[key].as_array().and_then(|a| a.get(midx)).and_then(|v| v.as_f64())
    };
    w.wave_height_m = mpick("wave_height");
    w.wave_dir_deg = mpick("wave_direction").map(|d| d.rem_euclid(360.0));
    w.wave_period_s = mpick("wave_period");
    w.sea_temp_c = mpick("sea_surface_temperature");
    w.sea_state = sea_state(w.wave_height_m, w.wind_speed_ms);
    w
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct WmoInfo {
    pub code: i64,
    pub label: &'static str,
    pub icon: &'static str, // clear, partly, overcast, fog, drizzle, rain, snow, shower, storm
}

/// Codes météo WMO (ww) -> libellé français + catégorie d'icône.
pub fn wmo_info(code: i64) -> WmoInfo {
    let (label, icon) = match code {
        0 => ("Ciel dégagé", "clear"),
        1 => ("Plutôt dégagé", "clear"),
        2 => ("Partiellement nuageux", "partly"),
        3 => ("Couvert", "overcast"),
        45 => ("Brouillard", "fog"),
        48 => ("Brouillard givrant", "fog"),
        51 | 53 | 55 => ("Bruine", "drizzle"),
        56 | 57 => ("Bruine verglaçante", "drizzle"),
        61 | 63 | 65 => ("Pluie", "rain"),
        66 | 67 => ("Pluie verglaçante", "rain"),
        71 | 73 | 75 => ("Neige", "snow"),
        77 => ("Grains de neige", "snow"),
        80 | 81 | 82 => ("Averses", "shower"),
        85 | 86 => ("Averses de neige", "snow"),
        95 => ("Orage", "storm"),
        96 | 99 => ("Orage avec grêle", "storm"),
        _ => ("Inconnu", "overcast"),
    };
    WmoInfo { code, label, icon }
}

/// Direction du vent lisible : « 286° (NO) ».
pub fn wind_direction_label(deg: Option<f64>) -> Option<String> {
    deg.map(|d| format!("{:.0}° ({})", d, cardinal(d)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn forecast_sample() -> Value {
        json!({
            "current": {"time":"2026-11-23T14:00","temperature_2m":13.9,"weather_code":2,"cloud_cover":40,"precipitation":0.0,"pressure_msl":1013.2,"wind_speed_10m":5.2,"wind_direction_10m":286.0,"wind_gusts_10m":8.1},
            "hourly": {
                "time": ["2026-11-23T13:00","2026-11-23T14:00","2026-11-23T15:00"],
                "temperature_2m": [13.1, 13.9, 14.2],
                "weather_code": [2, 3, 1],
                "cloud_cover": [30, 40, 20],
                "precipitation": [0.0, 0.2, 0.0],
                "pressure_msl": [1012.9, 1013.2, 1013.5],
                "wind_speed_10m": [4.8, 5.2, 5.6],
                "wind_direction_10m": [280.0, 286.0, 290.0],
                "wind_gusts_10m": [7.5, 8.1, 8.8],
                "visibility": [24000.0, 20000.0, 30000.0]
            }
        })
    }

    fn marine_sample() -> Value {
        json!({
            "hourly": {
                "time": ["2026-11-23T13:00","2026-11-23T14:00","2026-11-23T15:00"],
                "wave_height": [2.4, 2.6, 2.8],
                "wave_direction": [286.0, 287.0, 288.0],
                "wave_period": [9.0, 9.2, 9.4],
                "sea_surface_temperature": [13.0, 13.2, 13.3]
            }
        })
    }

    #[test]
    fn build_weather_picks_nearest_hour() {
        let target = NaiveDateTime::parse_from_str("2026-11-23T14:10", "%Y-%m-%dT%H:%M").unwrap();
        let w = build_weather(&forecast_sample(), &marine_sample(), target);
        assert_eq!(w.temp_air_c, Some(13.9));
        assert_eq!(w.wmo_code, Some(3)); // heure 14:00 -> code 3
        assert_eq!(w.wind_speed_ms, Some(5.2));
        assert_eq!(w.beaufort, Some(3)); // 5,2 m/s ≈ 10,1 nœuds -> force 3
        assert_eq!(w.wind_dir_deg, Some(286.0));
        assert_eq!(w.wave_height_m, Some(2.6));
        assert_eq!(w.sea_temp_c, Some(13.2));
        assert_eq!(w.sea_state.as_deref(), Some("Forte")); // houle 2,6 m
        assert_eq!(w.visibility_m, Some(20000.0));
    }

    #[test]
    fn build_weather_without_marine() {
        let target = NaiveDateTime::parse_from_str("2026-11-23T13:30", "%Y-%m-%dT%H:%M").unwrap();
        let w = build_weather(&forecast_sample(), &Value::Null, target);
        assert!(w.wave_height_m.is_none());
        assert_eq!(w.sea_state.as_deref(), Some("Peu agitée")); // dérivé du vent (4.8 m/s -> F3)
    }

    #[test]
    fn wmo_labels() {
        assert_eq!(wmo_info(0).label, "Ciel dégagé");
        assert_eq!(wmo_info(95).icon, "storm");
        assert_eq!(wmo_info(61).label, "Pluie");
    }

    #[test]
    fn urls_contain_params() {
        let t = chrono::Local::now().naive_local();
        let u = forecast_url(48.65, -4.48, t);
        assert!(u.contains("latitude=48.6500") && u.contains("wind_speed_10m") && u.contains("forecast_days=1"));
        let past = t - chrono::Duration::days(10);
        let up = forecast_url(48.65, -4.48, past);
        assert!(up.contains("start_date=") && up.contains("end_date="));
        let mu = marine_url(48.65, -4.48, t);
        assert!(mu.contains("marine-api.open-meteo.com") && mu.contains("wave_height"));
    }

    struct FakeHttp;
    #[async_trait::async_trait]
    impl HttpClient for FakeHttp {
        async fn get_json(&self, url: &str) -> Result<Value, WeatherError> {
            if url.contains("marine-api") {
                Ok(marine_sample())
            } else {
                Ok(forecast_sample())
            }
        }
    }

    #[tokio::test]
    async fn fetch_weather_via_trait() {
        let target = NaiveDateTime::parse_from_str("2026-11-23T14:10", "%Y-%m-%dT%H:%M").unwrap();
        let w = fetch_weather(&FakeHttp, 48.65, -4.48, target).await.unwrap();
        assert_eq!(w.wave_height_m, Some(2.6));
        assert_eq!(w.beaufort, Some(3));
    }
}
