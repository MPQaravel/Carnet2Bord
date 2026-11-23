//! Géolocalisation et conversions maritimes : coordonnées (3 formats),
//! échelle de Beaufort, points cardinaux, distance de haversine, état de la mer.

use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum CoordError {
    #[error("format non reconnu : attendu décimal « 48.6542, -4.4861 », degrés-minutes « 48°39.2'N 4°29.2'W » ou degrés-minutes-secondes « 48°39'12\"N 4°29'12\"W »")]
    Unrecognized,
    #[error("latitude hors plage [-90, 90] : {0}")]
    LatRange(f64),
    #[error("longitude hors plage [-180, 180] : {0}")]
    LonRange(f64),
    #[error("valeur invalide : {0}")]
    Invalid(String),
}

/// Parse une coordonnée saisie en décimal, degrés-minutes ou degrés-minutes-secondes.
/// Retourne (lat, lon) en degrés décimaux.
pub fn parse_position(input: &str) -> Result<(f64, f64), CoordError> {
    let s = input.trim().replace(',', " ").replace(';', " ");
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let upper = s.to_uppercase();

    // 1) Décimal : deux nombres séparés par une virgule ou un espace.
    let dec_parts: Vec<&str> = s.split(|c: char| c == ',' || c.is_whitespace()).filter(|p| !p.is_empty()).collect();
    if dec_parts.len() == 2 && dec_parts.iter().all(|p| p.parse::<f64>().is_ok()) {
        let lat: f64 = dec_parts[0].parse().map_err(|_| CoordError::Invalid(dec_parts[0].into()))?;
        let lon: f64 = dec_parts[1].parse().map_err(|_| CoordError::Invalid(dec_parts[1].into()))?;
        return validate(lat, lon);
    }

    // 2) DM / DMS : chaque composante contient ° (et éventuellement ' et "), avec une lettre N/S/E/W.
    let re = Regex::new(r#"(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)\s*"?)?)?\s*([NS])\s+(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)\s*"?)?)?\s*([EW])"#).unwrap();
    if let Some(caps) = re.captures(&upper) {
        let lat = parse_component(&caps, 1, 2, 3, 4)?;
        let lon = parse_component(&caps, 5, 6, 7, 8)?;
        return validate(lat, lon);
    }

    Err(CoordError::Unrecognized)
}

fn validate(lat: f64, lon: f64) -> Result<(f64, f64), CoordError> {
    if !(-90.0..=90.0).contains(&lat) {
        return Err(CoordError::LatRange(lat));
    }
    if !(-180.0..=180.0).contains(&lon) {
        return Err(CoordError::LonRange(lon));
    }
    Ok((lat, lon))
}

/// Composante individuelle : degrés, minutes optionnelles, secondes optionnelles, hémisphère.
fn parse_component(caps: &regex::Captures, g_deg: usize, g_min: usize, g_sec: usize, g_hemi: usize) -> Result<f64, CoordError> {
    let deg: f64 = caps
        .get(g_deg)
        .and_then(|m| m.as_str().parse().ok())
        .ok_or_else(|| CoordError::Invalid(caps.get(g_deg).map(|m| m.as_str().to_string()).unwrap_or_default()))?;
    let min: f64 = caps.get(g_min).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
    let sec: f64 = caps.get(g_sec).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
    let hemi = caps.get(g_hemi).map(|m| m.as_str()).unwrap_or("");
    let mut val = deg + min / 60.0 + sec / 3600.0;
    if hemi == "S" || hemi == "W" {
        val = -val;
    }
    Ok(val)
}

use regex::Regex;

/// Formate (lat, lon) en degrés décimaux lisibles.
pub fn format_decimal(lat: f64, lon: f64) -> String {
    let ns = if lat >= 0.0 { "N" } else { "S" };
    let ew = if lon >= 0.0 { "E" } else { "W" };
    format!("{:.4}°{} {:.4}°{}", lat.abs(), ns, lon.abs(), ew)
}

/// Formate (lat, lon) en degrés-minutes : 48°39.25'N 4°29.17'W
pub fn format_dm(lat: f64, lon: f64) -> String {
    fn one(v: f64, pos: &str, neg: &str) -> String {
        let hemi = if v >= 0.0 { pos } else { neg };
        let a = v.abs();
        let deg = a.trunc();
        let min = (a - deg) * 60.0;
        format!("{}°{:04.2}'{}", deg as i64, min, hemi)
    }
    format!("{} {}", one(lat, "N", "S"), one(lon, "E", "W"))
}

/// Formate (lat, lon) en degrés-minutes-secondes : 48°39'15"N 4°29'10"W
pub fn format_dms(lat: f64, lon: f64) -> String {
    fn one(v: f64, pos: &str, neg: &str) -> String {
        let hemi = if v >= 0.0 { pos } else { neg };
        let a = v.abs();
        let deg = a.trunc() as i64;
        let rem = (a - deg as f64) * 60.0;
        let min = rem.trunc() as i64;
        let sec = (rem - min as f64) * 60.0;
        format!("{}°{:02}'{:02}\"{}", deg, min, sec.round() as i64, hemi)
    }
    format!("{} {}", one(lat, "N", "S"), one(lon, "E", "W"))
}

/// Échelle de Beaufort à partir d'une vitesse en m/s (bornes WMO).
pub fn beaufort_from_ms(ms: f64) -> u8 {
    const BOUNDS: [f64; 12] = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
    for (i, b) in BOUNDS.iter().enumerate() {
        if ms < *b {
            return i as u8;
        }
    }
    12
}

pub fn beaufort_label(f: u8) -> &'static str {
    const LABELS: [&str; 13] = [
        "0 — Calme", "1 — Très légère brise", "2 — Légère brise", "3 — Petite brise",
        "4 — Jolie brise", "5 — Bonne brise", "6 — Vent frais", "7 — Grand frais",
        "8 — Coup de vent", "9 — Fort coup de vent", "10 — Tempête", "11 — Violente tempête",
        "12 — Ouragan",
    ];
    LABELS[f.min(12) as usize]
}

pub fn ms_to_knots(ms: f64) -> f64 {
    ms * 1.943844
}

/// Point cardinal à 16 branches à partir d'un cap en degrés.
pub fn cardinal(deg: f64) -> &'static str {
    const POINTS: [&str; 16] = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
    ];
    let idx = ((deg.rem_euclid(360.0) + 11.25) / 22.5).floor() as usize % 16;
    POINTS[idx]
}

/// Distance de haversine en milles marins.
pub fn haversine_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R_NM: f64 = 3440.065; // rayon terrestre en milles marins
    let (sin_lat, cos_lat) = ((lat2 - lat1).to_radians() / 2.0).sin_cos();
    let (sin_lon, cos_lon) = ((lon2 - lon1).to_radians() / 2.0).sin_cos();
    let a = sin_lat * sin_lat + lat1.to_radians().cos() * lat2.to_radians().cos() * sin_lon * sin_lon;
    let _ = cos_lat;
    let _ = cos_lon;
    2.0 * R_NM * a.sqrt().asin()
}

/// État de la mer (échelle de Douglas) dérivé de la houle, complété par le vent
/// quand la houle est inconnue.
pub fn sea_state(wave_height_m: Option<f64>, wind_ms: Option<f64>) -> Option<String> {
    if let Some(h) = wave_height_m {
        let s = if h < 0.1 {
            "Calme (glace)"
        } else if h < 0.5 {
            "Calme (ridée)"
        } else if h < 1.25 {
            "Peu agitée"
        } else if h < 2.5 {
            "Agitée"
        } else if h < 4.0 {
            "Forte"
        } else if h < 6.0 {
            "Grosse"
        } else if h < 9.0 {
            "Très grosse"
        } else {
            "Énorme"
        };
        Some(s.to_string())
    } else {
        wind_ms.map(|w| match beaufort_from_ms(w) {
            0..=2 => "Calme (ridée)".to_string(),
            3..=4 => "Peu agitée".to_string(),
            5..=6 => "Agitée".to_string(),
            7..=8 => "Forte".to_string(),
            _ => "Grosse".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_decimal() {
        assert_eq!(parse_position("48.6542, -4.4861").unwrap(), (48.6542, -4.4861));
        assert_eq!(parse_position("48.6542 -4.4861").unwrap(), (48.6542, -4.4861));
        assert_eq!(parse_position("-33.86, 151.21").unwrap(), (-33.86, 151.21));
    }

    #[test]
    fn parse_dm() {
        let (lat, lon) = parse_position("48°39.2'N 4°29.2'W").unwrap();
        assert!((lat - 48.65333).abs() < 1e-4, "lat={lat}");
        assert!((lon - (-4.48667)).abs() < 1e-4, "lon={lon}");
        let (lat2, lon2) = parse_position("48°39.252'N 004°29.172'W").unwrap();
        assert!((lat2 - 48.6542).abs() < 1e-3);
        assert!((lon2 - (-4.4862)).abs() < 1e-3);
    }

    #[test]
    fn parse_dms() {
        let (lat, lon) = parse_position("48°39'12\"N 4°29'12\"W").unwrap();
        assert!((lat - (48.0 + 39.0 / 60.0 + 12.0 / 3600.0)).abs() < 1e-6);
        assert!(lon < 0.0);
    }

    #[test]
    fn parse_errors() {
        assert!(matches!(parse_position("abc"), Err(CoordError::Unrecognized)));
        assert!(matches!(parse_position("95, 0"), Err(CoordError::LatRange(_))));
        assert!(matches!(parse_position("0, 200"), Err(CoordError::LonRange(_))));
    }

    #[test]
    fn format_roundtrip() {
        let (lat, lon) = (48.6542, -4.4861);
        let dm = format_dm(lat, lon);
        let (la2, lo2) = parse_position(&dm).unwrap();
        assert!((la2 - lat).abs() < 1e-3 && (lo2 - lon).abs() < 1e-3, "{dm}");
        let dms = format_dms(lat, lon);
        let (la3, lo3) = parse_position(&dms).unwrap();
        assert!((la3 - lat).abs() < 1e-4 && (lo3 - lon).abs() < 1e-4, "{dms}");
        assert_eq!(format_decimal(48.6542, -4.4861), "48.6542°N 4.4861°W");
    }

    #[test]
    fn beaufort_table() {
        // Bornes WMO en m/s.
        assert_eq!(beaufort_from_ms(0.1), 0);
        assert_eq!(beaufort_from_ms(1.0), 1);
        assert_eq!(beaufort_from_ms(4.0), 3);
        assert_eq!(beaufort_from_ms(6.0), 4);
        assert_eq!(beaufort_from_ms(9.0), 5);
        assert_eq!(beaufort_from_ms(12.0), 6);
        assert_eq!(beaufort_from_ms(15.0), 7);
        assert_eq!(beaufort_from_ms(25.0), 10);
        assert_eq!(beaufort_from_ms(40.0), 12);
        assert!(beaufort_label(8).contains("Coup de vent"));
    }

    #[test]
    fn cardinals() {
        assert_eq!(cardinal(0.0), "N");
        assert_eq!(cardinal(90.0), "E");
        assert_eq!(cardinal(180.0), "S");
        assert_eq!(cardinal(270.0), "O");
        assert_eq!(cardinal(45.0), "NE");
        assert_eq!(cardinal(359.0), "N");
        assert_eq!(cardinal(202.5), "SSO");
    }

    #[test]
    fn haversine_known_distance() {
        // Brest -> Ouessant ≈ 24,5 milles marins
        let d = haversine_nm(48.3904, -4.4861, 48.4597, -5.0926);
        assert!((d - 24.5).abs() < 1.5, "d={d}");
        assert_eq!(haversine_nm(48.0, -4.0, 48.0, -4.0), 0.0);
    }

    #[test]
    fn sea_state_douglas() {
        assert_eq!(sea_state(Some(0.05), None).unwrap(), "Calme (glace)");
        assert_eq!(sea_state(Some(0.8), None).unwrap(), "Peu agitée");
        assert_eq!(sea_state(Some(3.0), None).unwrap(), "Forte");
        assert_eq!(sea_state(Some(10.0), None).unwrap(), "Énorme");
        assert_eq!(sea_state(None, Some(9.0)).unwrap(), "Agitée");
        assert_eq!(sea_state(None, None), None);
    }
}
