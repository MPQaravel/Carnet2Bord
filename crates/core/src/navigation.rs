//! Regroupement des logs par navigation et récapitulatifs (durée, distance, météo moyenne).

use chrono::NaiveDateTime;

use crate::geo::haversine_nm;
use crate::models::*;

/// Construit les récapitulatifs de navigations à partir des logs filtrés.
pub fn summarize(logs: &[Log], navs: &[Navigation]) -> Vec<NavigationSummary> {
    let mut by_nav: std::collections::BTreeMap<String, Vec<&Log>> = std::collections::BTreeMap::new();
    let mut orphan: Vec<&Log> = Vec::new();
    for l in logs {
        match &l.navigation_id {
            Some(n) => by_nav.entry(n.clone()).or_default().push(l),
            None => orphan.push(l),
        }
    }
    let mut out = Vec::new();
    let now = now_local();
    for n in navs {
        let group = by_nav.get(&n.id).cloned().unwrap_or_default();
        let mut sorted: Vec<&Log> = group.clone();
        sorted.sort_by_key(|l| l.log_datetime);
        let start = sorted.first().map(|l| l.log_datetime);
        let end = sorted.last().map(|l| l.log_datetime);
        let duration_hours = match (start, end) {
            (Some(s), Some(e)) => Some((e - s).num_minutes() as f64 / 60.0),
            _ => None,
        };
        // Distance : somme des haversines entre positions successives connues.
        let mut distance_nm: Option<f64> = Some(0.0);
        let mut prev: Option<(f64, f64)> = None;
        for l in &sorted {
            if let (Some(lat), Some(lon)) = (l.lat, l.lon) {
                if let Some((plat, plon)) = prev {
                    *distance_nm.as_mut().unwrap() += haversine_nm(plat, plon, lat, lon);
                }
                prev = Some((lat, lon));
            }
        }
        if sorted.iter().filter(|l| l.lat.is_some() && l.lon.is_some()).count() < 2 {
            distance_nm = None;
        }
        let avg = |f: fn(&Weather) -> Option<f64>| -> Option<f64> {
            let vals: Vec<f64> = sorted.iter().filter_map(|l| l.weather.as_ref().and_then(f)).collect();
            if vals.is_empty() {
                None
            } else {
                Some(vals.iter().sum::<f64>() / vals.len() as f64)
            }
        };
        let max_wave = sorted
            .iter()
            .filter_map(|l| l.weather.as_ref().and_then(|w| w.wave_height_m))
            .fold(None, |acc, v| Some(acc.map_or(v, |a: f64| a.max(v))));
        let status = match end {
            Some(e) if (now - e).num_hours() < 48 => NavigationStatus::Ongoing,
            _ => NavigationStatus::Finished,
        };
        out.push(NavigationSummary {
            navigation: n.clone(),
            log_ids: sorted.iter().map(|l| l.id.clone()).collect(),
            start,
            end,
            duration_hours,
            distance_nm,
            avg_wind_ms: avg(|w| w.wind_speed_ms),
            avg_temp_c: avg(|w| w.temp_air_c),
            max_wave_m: max_wave,
            status,
        });
    }
    // Logs sans navigation (orphelins) : navigation fictive non persistée.
    if !orphan.is_empty() {
        let start = orphan.iter().map(|l| l.log_datetime).min();
        let end = orphan.iter().map(|l| l.log_datetime).max();
        out.push(NavigationSummary {
            navigation: Navigation {
                id: "__orphan__".into(),
                name: "Sans navigation".into(),
                vessel: String::new(),
                created_at: NaiveDateTime::default(),
            },
            log_ids: orphan.iter().map(|l| l.id.clone()).collect(),
            start,
            end,
            duration_hours: match (start, end) {
                (Some(s), Some(e)) => Some((e - s).num_minutes() as f64 / 60.0),
                _ => None,
            },
            distance_nm: None,
            avg_wind_ms: None,
            avg_temp_c: None,
            max_wave_m: None,
            status: NavigationStatus::Finished,
        });
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.end.unwrap_or(NaiveDateTime::default())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Store;
    use chrono::Duration;


    fn mk(vessel: &str, dt: NaiveDateTime, lat: Option<f64>, lon: Option<f64>, wind: Option<f64>, wave: Option<f64>) -> LogInput {
        LogInput {
            id: None,
            log_datetime: dt,
            vessel: vessel.into(),
            departure: "A".into(),
            destination: "B".into(),
            heading_deg: None,
            speed_kn: None,
            sails: String::new(),
            crew: String::new(),
            lat,
            lon,
            position_source: PositionSource::Manual,
            observations: String::new(),
            weather: Some(Weather { wind_speed_ms: wind, wave_height_m: wave, temp_air_c: Some(12.0), ..Default::default() }),
            weather_captured_at: Some(dt),
            weather_source: WeatherSource::OpenMeteo,
            overrides: vec![],
            offline: false,
        }
    }

    #[test]
    fn summary_distance_duration_weather() {
        let s = Store::in_memory().unwrap();
        let t0 = now_local() - Duration::hours(5);
        s.save_log(mk("K", t0, Some(48.39), Some(-4.48), Some(5.0), Some(1.0)), false).unwrap();
        s.save_log(mk("K", t0 + Duration::hours(2), Some(48.46), Some(-5.09), Some(7.0), Some(3.0)), false).unwrap();
        let logs = s.list_logs(&LogFilter::default()).unwrap();
        let navs = s.list_navigations().unwrap();
        let sums = summarize(&logs, &navs);
        assert_eq!(sums.len(), 1);
        let s0 = &sums[0];
        assert_eq!(s0.duration_hours, Some(2.0));
        let d = s0.distance_nm.unwrap();
        assert!((d - 24.5).abs() < 2.0, "d={d}");
        assert_eq!(s0.avg_wind_ms, Some(6.0));
        assert_eq!(s0.max_wave_m, Some(3.0));
        assert_eq!(s0.status, NavigationStatus::Ongoing);
        assert_eq!(s0.log_ids.len(), 2);
    }
}
