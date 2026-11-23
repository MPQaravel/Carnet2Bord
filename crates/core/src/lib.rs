//! logbook-core : noyau métier du carnet de bord numérique de navigation.
//! Pur (sans dépendance Tauri) pour être partagé avec une future version mobile
//! et testable hors ligne.

pub mod db;
pub mod exchange;
pub mod geo;
pub mod models;
pub mod navigation;
pub mod weather;

pub use db::{DbError, Store};
pub use models::*;
