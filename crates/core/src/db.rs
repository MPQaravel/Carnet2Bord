//! Stockage local SQLite (un fichier unique) : logs, photos, navigations, réglages.

use chrono::NaiveDateTime;
use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;

use crate::models::*;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite : {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("json : {0}")]
    Json(#[from] serde_json::Error),
    #[error("donnée invalide : {0}")]
    Invalid(String),
}

pub struct Store {
    conn: Connection,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    log_datetime TEXT NOT NULL,
    stardate TEXT,
    vessel TEXT NOT NULL DEFAULT '',
    departure TEXT NOT NULL DEFAULT '',
    destination TEXT NOT NULL DEFAULT '',
    heading_deg REAL,
    speed_kn REAL,
    sails TEXT NOT NULL DEFAULT '',
    crew TEXT NOT NULL DEFAULT '',
    lat REAL,
    lon REAL,
    position_source TEXT NOT NULL DEFAULT 'manual',
    observations TEXT NOT NULL DEFAULT '',
    weather_json TEXT,
    weather_captured_at TEXT,
    weather_source TEXT NOT NULL DEFAULT 'open_meteo',
    overrides_json TEXT NOT NULL DEFAULT '[]',
    offline INTEGER NOT NULL DEFAULT 0,
    navigation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_dt ON logs(log_datetime);
CREATE INDEX IF NOT EXISTS idx_logs_nav ON logs(navigation_id);
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    log_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_log ON photos(log_id);
CREATE TABLE IF NOT EXISTS navigations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vessel TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

impl Store {
    pub fn open(path: &str) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Store en mémoire (tests).
    pub fn in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    fn row_to_log(row: &rusqlite::Row) -> rusqlite::Result<Log> {
        let weather_json: Option<String> = row.get("weather_json")?;
        let overrides_json: String = row.get("overrides_json")?;
        let ps: String = row.get("position_source")?;
        let ws: String = row.get("weather_source")?;
        Ok(Log {
            id: row.get("id")?,
            log_datetime: NaiveDateTime::parse_from_str(&row.get::<_, String>("log_datetime")?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
            stardate: row.get("stardate")?,
            vessel: row.get("vessel")?,
            departure: row.get("departure")?,
            destination: row.get("destination")?,
            heading_deg: row.get("heading_deg")?,
            speed_kn: row.get("speed_kn")?,
            sails: row.get("sails")?,
            crew: row.get("crew")?,
            lat: row.get("lat")?,
            lon: row.get("lon")?,
            position_source: match ps.as_str() {
                "gps" => PositionSource::Gps,
                "last_known" => PositionSource::LastKnown,
                _ => PositionSource::Manual,
            },
            observations: row.get("observations")?,
            weather: weather_json.and_then(|j| serde_json::from_str(&j).ok()),
            weather_captured_at: row
                .get::<_, Option<String>>("weather_captured_at")?
                .and_then(|s| NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S").ok()),
            weather_source: match ws.as_str() {
                "manual" => WeatherSource::Manual,
                "offline" => WeatherSource::Offline,
                _ => WeatherSource::OpenMeteo,
            },
            overrides: serde_json::from_str(&overrides_json).unwrap_or_default(),
            offline: row.get::<_, i64>("offline")? != 0,
            navigation_id: row.get("navigation_id")?,
            created_at: NaiveDateTime::parse_from_str(&row.get::<_, String>("created_at")?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
            updated_at: NaiveDateTime::parse_from_str(&row.get::<_, String>("updated_at")?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
        })
    }

    /// Crée ou met à jour un log. À la création, rattache la navigation (même navire,
    /// écart < 48 h) ou en crée une nouvelle.
    pub fn save_log(&self, input: LogInput, use_stardate: bool) -> Result<Log, DbError> {
        let now = now_local();
        let id = input.id.clone().unwrap_or_else(new_id);
        let stardate = if use_stardate {
            Some(crate::models::stardate(&chrono::Local::now()))
        } else {
            None
        };

        let nav_id = match &input.id {
            Some(_) => self
                .conn
                .query_row("SELECT navigation_id FROM logs WHERE id=?1", params![id], |r| r.get::<_, Option<String>>(0))
                .unwrap_or(None),
            None => Some(self.assign_navigation(&input.vessel, &input.departure, &input.destination, input.log_datetime)?),
        };

        let weather_json = input.weather.as_ref().map(|w| serde_json::to_string(w)).transpose()?;
        let overrides_json = serde_json::to_string(&input.overrides)?;
        let (ps, ws) = (
            match input.position_source {
                PositionSource::Gps => "gps",
                PositionSource::LastKnown => "last_known",
                PositionSource::Manual => "manual",
            },
            match input.weather_source {
                WeatherSource::OpenMeteo => "open_meteo",
                WeatherSource::Manual => "manual",
                WeatherSource::Offline => "offline",
            },
        );
        let dt = input.log_datetime.format("%Y-%m-%d %H:%M:%S").to_string();
        let wcap = input.weather_captured_at.map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string());

        self.conn.execute(
            r#"INSERT INTO logs (id, log_datetime, stardate, vessel, departure, destination, heading_deg, speed_kn,
                 sails, crew, lat, lon, position_source, observations, weather_json, weather_captured_at,
                 weather_source, overrides_json, offline, navigation_id, created_at, updated_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
               ON CONFLICT(id) DO UPDATE SET
                 log_datetime=?2, stardate=?3, vessel=?4, departure=?5, destination=?6, heading_deg=?7,
                 speed_kn=?8, sails=?9, crew=?10, lat=?11, lon=?12, position_source=?13, observations=?14,
                 weather_json=?15, weather_captured_at=?16, weather_source=?17, overrides_json=?18,
                 offline=?19, navigation_id=?20, updated_at=?22"#,
            params![
                id, dt, stardate, input.vessel, input.departure, input.destination,
                input.heading_deg, input.speed_kn, input.sails, input.crew,
                input.lat, input.lon, ps, input.observations, weather_json, wcap,
                ws, overrides_json, input.offline as i64, nav_id, now.format("%Y-%m-%d %H:%M:%S").to_string(),
                now.format("%Y-%m-%d %H:%M:%S").to_string()
            ],
        )?;
        self.get_log(&id)?.ok_or_else(|| DbError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Règle de regroupement : même navire (insensible à la casse) et écart < 48 h
    /// avec le log précédent du même navire -> même navigation.
    fn assign_navigation(&self, vessel: &str, departure: &str, destination: &str, dt: NaiveDateTime) -> Result<String, DbError> {
        let prev: Option<(String, Option<String>)> = self
            .conn
            .query_row(
                "SELECT id, navigation_id FROM logs WHERE lower(vessel)=lower(?1) AND log_datetime < ?2
                 ORDER BY log_datetime DESC LIMIT 1",
                params![vessel, dt.format("%Y-%m-%d %H:%M:%S").to_string()],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        if let Some((prev_id, nav)) = prev {
            let prev_dt: String = self.conn.query_row(
                "SELECT log_datetime FROM logs WHERE id=?1",
                params![prev_id],
                |r| r.get(0),
            )?;
            let prev_dt = NaiveDateTime::parse_from_str(&prev_dt, "%Y-%m-%d %H:%M:%S")
                .map_err(|e| DbError::Invalid(e.to_string()))?;
            if (dt - prev_dt).num_hours() < 48 {
                if let Some(nav) = nav {
                    return Ok(nav);
                }
            }
        }
        // Nouvelle navigation
        let nav_id = new_id();
        let name = default_navigation_name(departure, destination, dt);
        self.conn.execute(
            "INSERT INTO navigations (id, name, vessel, created_at) VALUES (?1,?2,?3,?4)",
            params![nav_id, name, vessel, now_local().format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(nav_id)
    }

    pub fn get_log(&self, id: &str) -> Result<Option<Log>, DbError> {
        self.conn
            .query_row("SELECT * FROM logs WHERE id=?1", params![id], Self::row_to_log)
            .optional()
            .map_err(DbError::from)
    }

    pub fn list_logs(&self, filter: &LogFilter) -> Result<Vec<Log>, DbError> {
        let mut sql = String::from("SELECT * FROM logs WHERE 1=1");
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(q) = &filter.query {
            let q = q.trim();
            if !q.is_empty() {
                sql.push_str(" AND (observations LIKE ? OR vessel LIKE ? OR crew LIKE ? OR departure LIKE ? OR destination LIKE ?)");
                let pat = format!("%{}%", q);
                for _ in 0..5 {
                    args.push(Box::new(pat.clone()));
                }
            }
        }
        if let Some(v) = &filter.vessel {
            sql.push_str(" AND lower(vessel)=lower(?)");
            args.push(Box::new(v.clone()));
        }
        if let Some(n) = &filter.navigation_id {
            sql.push_str(" AND navigation_id=?");
            args.push(Box::new(n.clone()));
        }
        if let Some(f) = &filter.from {
            sql.push_str(" AND log_datetime >= ?");
            args.push(Box::new(f.format("%Y-%m-%d %H:%M:%S").to_string()));
        }
        if let Some(t) = &filter.to {
            sql.push_str(" AND log_datetime <= ?");
            args.push(Box::new(t.format("%Y-%m-%d %H:%M:%S").to_string()));
        }
        sql.push_str(" ORDER BY log_datetime DESC, created_at DESC");
        let refs: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|a| a.as_ref()).collect();
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(refs.iter()), Self::row_to_log)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete_log(&self, id: &str) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM photos WHERE log_id=?1", params![id])?;
        self.conn.execute("DELETE FROM logs WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn last_log(&self) -> Result<Option<Log>, DbError> {
        self.conn
            .query_row("SELECT * FROM logs ORDER BY log_datetime DESC, created_at DESC LIMIT 1", [], Self::row_to_log)
            .optional()
            .map_err(DbError::from)
    }

    /// Dernière position connue (dernier log avec lat/lon).
    pub fn last_position(&self) -> Result<Option<(f64, f64)>, DbError> {
        self.conn
            .query_row(
                "SELECT lat, lon FROM logs WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY log_datetime DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)),
            )
            .optional()
            .map_err(DbError::from)
    }

    // ----- Photos -----

    pub fn add_photo(&self, log_id: &str, file_name: &str, rel_path: &str, size_bytes: i64) -> Result<Photo, DbError> {
        let p = Photo {
            id: new_id(),
            log_id: log_id.to_string(),
            file_name: file_name.to_string(),
            rel_path: rel_path.to_string(),
            size_bytes,
            created_at: now_local(),
        };
        self.conn.execute(
            "INSERT INTO photos (id, log_id, file_name, rel_path, size_bytes, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![p.id, p.log_id, p.file_name, p.rel_path, p.size_bytes, p.created_at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(p)
    }

    pub fn list_photos(&self, log_id: &str) -> Result<Vec<Photo>, DbError> {
        let mut stmt = self.conn.prepare("SELECT id, log_id, file_name, rel_path, size_bytes, created_at FROM photos WHERE log_id=?1 ORDER BY created_at")?;
        let rows = stmt.query_map(params![log_id], |r| {
            Ok(Photo {
                id: r.get(0)?,
                log_id: r.get(1)?,
                file_name: r.get(2)?,
                rel_path: r.get(3)?,
                size_bytes: r.get(4)?,
                created_at: NaiveDateTime::parse_from_str(&r.get::<_, String>(5)?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_photo(&self, id: &str) -> Result<Option<Photo>, DbError> {
        self.conn
            .query_row(
                "SELECT id, log_id, file_name, rel_path, size_bytes, created_at FROM photos WHERE id=?1",
                params![id],
                |r| {
                    Ok(Photo {
                        id: r.get(0)?,
                        log_id: r.get(1)?,
                        file_name: r.get(2)?,
                        rel_path: r.get(3)?,
                        size_bytes: r.get(4)?,
                        created_at: NaiveDateTime::parse_from_str(&r.get::<_, String>(5)?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
                    })
                },
            )
            .optional()
            .map_err(DbError::from)
    }

    pub fn delete_photo(&self, id: &str) -> Result<Option<Photo>, DbError> {
        let p = self.get_photo(id)?;
        self.conn.execute("DELETE FROM photos WHERE id=?1", params![id])?;
        Ok(p)
    }

    // ----- Navigations -----

    pub fn list_navigations(&self) -> Result<Vec<Navigation>, DbError> {
        let mut stmt = self.conn.prepare("SELECT id, name, vessel, created_at FROM navigations ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |r| {
            Ok(Navigation {
                id: r.get(0)?,
                name: r.get(1)?,
                vessel: r.get(2)?,
                created_at: NaiveDateTime::parse_from_str(&r.get::<_, String>(3)?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn rename_navigation(&self, id: &str, name: &str) -> Result<(), DbError> {
        self.conn.execute("UPDATE navigations SET name=?1 WHERE id=?2", params![name, id])?;
        Ok(())
    }

    // ----- Réglages -----

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        self.conn
            .query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0))
            .optional()
            .map_err(DbError::from)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn all_settings(&self) -> Result<Vec<(String, String)>, DbError> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Logs en attente de météo (hors ligne à l'enregistrement) pour la file de reprise.
    pub fn pending_weather_logs(&self) -> Result<Vec<Log>, DbError> {
        let mut stmt = self.conn.prepare("SELECT * FROM logs WHERE weather_json IS NULL OR offline=1 ORDER BY log_datetime DESC")?;
        let rows = stmt.query_map([], Self::row_to_log)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_weather(&self, id: &str, weather: &Weather, captured_at: NaiveDateTime, source: WeatherSource, offline: bool) -> Result<(), DbError> {
        let wj = serde_json::to_string(weather)?;
        let ws = match source {
            WeatherSource::OpenMeteo => "open_meteo",
            WeatherSource::Manual => "manual",
            WeatherSource::Offline => "offline",
        };
        self.conn.execute(
            "UPDATE logs SET weather_json=?1, weather_captured_at=?2, weather_source=?3, offline=?4, updated_at=?5 WHERE id=?6",
            params![
                wj,
                captured_at.format("%Y-%m-%d %H:%M:%S").to_string(),
                ws,
                offline as i64,
                now_local().format("%Y-%m-%d %H:%M:%S").to_string(),
                id
            ],
        )?;
        Ok(())
    }

    // ----- Export / import -----

    pub fn all_logs_raw(&self) -> Result<Vec<Log>, DbError> {
        let mut stmt = self.conn.prepare("SELECT * FROM logs ORDER BY log_datetime")?;
        let rows = stmt.query_map([], Self::row_to_log)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn all_photos_raw(&self) -> Result<Vec<Photo>, DbError> {
        let mut stmt = self.conn.prepare("SELECT id, log_id, file_name, rel_path, size_bytes, created_at FROM photos ORDER BY created_at")?;
        let rows = stmt.query_map([], |r| {
            Ok(Photo {
                id: r.get(0)?,
                log_id: r.get(1)?,
                file_name: r.get(2)?,
                rel_path: r.get(3)?,
                size_bytes: r.get(4)?,
                created_at: NaiveDateTime::parse_from_str(&r.get::<_, String>(5)?, "%Y-%m-%d %H:%M:%S").unwrap_or_else(|_| now_local()),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    // ----- Insertions brutes (import JSON) -----

    pub fn insert_log_raw(&self, l: &Log) -> Result<(), DbError> {
        let weather_json = l.weather.as_ref().map(serde_json::to_string).transpose()?;
        let overrides_json = serde_json::to_string(&l.overrides)?;
        let (ps, ws) = (
            match l.position_source {
                PositionSource::Gps => "gps",
                PositionSource::LastKnown => "last_known",
                PositionSource::Manual => "manual",
            },
            match l.weather_source {
                WeatherSource::OpenMeteo => "open_meteo",
                WeatherSource::Manual => "manual",
                WeatherSource::Offline => "offline",
            },
        );
        self.conn.execute(
            r#"INSERT INTO logs (id, log_datetime, stardate, vessel, departure, destination, heading_deg, speed_kn,
                 sails, crew, lat, lon, position_source, observations, weather_json, weather_captured_at,
                 weather_source, overrides_json, offline, navigation_id, created_at, updated_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)"#,
            params![
                l.id,
                l.log_datetime.format("%Y-%m-%d %H:%M:%S").to_string(),
                l.stardate,
                l.vessel, l.departure, l.destination, l.heading_deg, l.speed_kn, l.sails, l.crew,
                l.lat, l.lon, ps, l.observations, weather_json,
                l.weather_captured_at.map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()),
                ws, overrides_json, l.offline as i64, l.navigation_id,
                l.created_at.format("%Y-%m-%d %H:%M:%S").to_string(),
                l.updated_at.format("%Y-%m-%d %H:%M:%S").to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn insert_photo_raw(&self, p: &Photo) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO photos (id, log_id, file_name, rel_path, size_bytes, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![p.id, p.log_id, p.file_name, p.rel_path, p.size_bytes, p.created_at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(())
    }

    pub fn conn_execute_navigation(&self, n: &Navigation) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO navigations (id, name, vessel, created_at) VALUES (?1,?2,?3,?4)",
            params![n.id, n.name, n.vessel, n.created_at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM photos", [])?;
        self.conn.execute("DELETE FROM logs", [])?;
        self.conn.execute("DELETE FROM navigations", [])?;
        Ok(())
    }
}

fn default_navigation_name(departure: &str, destination: &str, dt: NaiveDateTime) -> String {
    if !departure.trim().is_empty() && !destination.trim().is_empty() {
        format!("{} → {}", departure.trim(), destination.trim())
    } else {
        format!("Navigation du {}", dt.format("%d/%m/%Y"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn input(dt: NaiveDateTime, vessel: &str) -> LogInput {
        LogInput {
            id: None,
            log_datetime: dt,
            vessel: vessel.to_string(),
            departure: "Brest".into(),
            destination: "Douarnenez".into(),
            heading_deg: Some(120.0),
            speed_kn: Some(6.2),
            sails: "GV + génois".into(),
            crew: "Alice, Bob".into(),
            lat: Some(48.39),
            lon: Some(-4.48),
            position_source: PositionSource::Manual,
            observations: "Belle journée".into(),
            weather: Some(Weather { wind_speed_ms: Some(5.0), beaufort: Some(4), ..Default::default() }),
            weather_captured_at: Some(dt),
            weather_source: WeatherSource::OpenMeteo,
            overrides: vec![],
            offline: false,
        }
    }

    #[test]
    fn crud_log() {
        let s = Store::in_memory().unwrap();
        let t0 = now_local();
        let l = s.save_log(input(t0, " esperanza "), true).unwrap();
        assert!(l.stardate.is_some());
        let got = s.get_log(&l.id).unwrap().unwrap();
        assert_eq!(got.vessel, " esperanza ");
        assert_eq!(got.weather.unwrap().beaufort, Some(4));

        let mut upd = input(t0 + Duration::hours(1), "esperanza");
        upd.id = Some(l.id.clone());
        upd.observations = "Vent forcissant".into();
        upd.overrides = vec!["wind".into()];
        let l2 = s.save_log(upd, true).unwrap();
        assert_eq!(l2.id, l.id);
        assert_eq!(l2.observations, "Vent forcissant");
        assert_eq!(l2.overrides, vec!["wind".to_string()]);
        assert_eq!(l2.navigation_id, l.navigation_id);

        s.delete_log(&l.id).unwrap();
        assert!(s.get_log(&l.id).unwrap().is_none());
    }

    #[test]
    fn navigation_grouping_48h() {
        let s = Store::in_memory().unwrap();
        let t0 = now_local();
        let a = s.save_log(input(t0, "Kraken"), false).unwrap();
        let b = s.save_log(input(t0 + Duration::hours(20), "Kraken"), false).unwrap();
        let c = s.save_log(input(t0 + Duration::hours(70), "Kraken"), false).unwrap(); // écart 50h avec b -> nouvelle nav
        let d = s.save_log(input(t0 + Duration::hours(30), "autre"), false).unwrap(); // autre navire -> nouvelle nav
        assert_eq!(a.navigation_id, b.navigation_id);
        assert_ne!(a.navigation_id, c.navigation_id);
        assert_ne!(a.navigation_id, d.navigation_id);
        let navs = s.list_navigations().unwrap();
        assert_eq!(navs.len(), 3);
    }

    #[test]
    fn search_filter() {
        let s = Store::in_memory().unwrap();
        let t0 = now_local();
        let mut i1 = input(t0, "Kraken");
        i1.observations = "Dauphins à bâbord".into();
        s.save_log(i1, false).unwrap();
        let mut i2 = input(t0 + Duration::hours(1), "Kraken");
        i2.observations = "Rien à signaler".into();
        s.save_log(i2, false).unwrap();

        let r = s.list_logs(&LogFilter { query: Some("dauphins".into()), ..Default::default() }).unwrap();
        assert_eq!(r.len(), 1);
        assert!(r[0].observations.contains("Dauphins"));
        let r = s.list_logs(&LogFilter { query: Some("kraken".into()), ..Default::default() }).unwrap();
        assert_eq!(r.len(), 2);
        let from = t0 + Duration::minutes(30);
        let r = s.list_logs(&LogFilter { from: Some(from), ..Default::default() }).unwrap();
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn photos_crud() {
        let s = Store::in_memory().unwrap();
        let l = s.save_log(input(now_local(), "Kraken"), false).unwrap();
        let p = s.add_photo(&l.id, "a.jpg", "photos/a.jpg", 123456).unwrap();
        assert_eq!(s.list_photos(&l.id).unwrap().len(), 1);
        let del = s.delete_photo(&p.id).unwrap().unwrap();
        assert_eq!(del.rel_path, "photos/a.jpg");
        assert!(s.list_photos(&l.id).unwrap().is_empty());
        // suppression en cascade
        let p2 = s.add_photo(&l.id, "b.jpg", "photos/b.jpg", 1).unwrap();
        s.delete_log(&l.id).unwrap();
        assert!(s.get_photo(&p2.id).unwrap().is_none());
    }

    #[test]
    fn settings_roundtrip() {
        let s = Store::in_memory().unwrap();
        assert!(s.get_setting("theme").unwrap().is_none());
        s.set_setting("theme", "dark").unwrap();
        s.set_setting("theme", "dark2").unwrap();
        assert_eq!(s.get_setting("theme").unwrap().unwrap(), "dark2");
    }

    #[test]
    fn pending_weather() {
        let s = Store::in_memory().unwrap();
        let mut i = input(now_local(), "Kraken");
        i.weather = None;
        i.weather_source = WeatherSource::Offline;
        i.offline = true;
        let l = s.save_log(i, false).unwrap();
        let pending = s.pending_weather_logs().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, l.id);
        s.update_weather(&l.id, &Weather { wind_speed_ms: Some(3.0), ..Default::default() }, now_local(), WeatherSource::OpenMeteo, false).unwrap();
        assert!(s.pending_weather_logs().unwrap().is_empty());
        assert_eq!(s.get_log(&l.id).unwrap().unwrap().weather.unwrap().wind_speed_ms, Some(3.0));
    }
}
