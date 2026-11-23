//! Smoke test live : récupère la météo réelle à Brest via Open-Meteo.
//! Usage : cargo run -p logbook-core --example live_weather
use logbook_core::weather::{fetch_weather, ReqwestClient, wind_direction_label};

#[tokio::main]
async fn main() {
    let http = ReqwestClient::new().expect("client http");
    let now = chrono::Local::now().naive_local();
    let w = fetch_weather(&http, 48.3904, -4.4861, now).await.expect("fetch météo");
    println!("capturé pour {}", now);
    println!("vent        : {:?} m/s, rafales {:?} m/s, dir {:?}", w.wind_speed_ms, w.wind_gust_ms, wind_direction_label(w.wind_dir_deg));
    println!("beaufort    : {:?}", w.beaufort);
    println!("ciel        : code {:?}, couverture {:?} %, précip {:?} mm, visibilité {:?} m", w.wmo_code, w.cloud_cover_pct, w.precipitation_mm, w.visibility_m);
    println!("mer         : houle {:?} m, dir {:?}°, période {:?} s, eau {:?} °C, état {:?}", w.wave_height_m, w.wave_dir_deg, w.wave_period_s, w.sea_temp_c, w.sea_state);
    println!("air         : {:?} °C, pression {:?} hPa", w.temp_air_c, w.pressure_hpa);

    // Historique (J-10)
    let past = now - chrono::Duration::days(10);
    let wp = fetch_weather(&http, 48.3904, -4.4861, past).await.expect("météo historique");
    println!("il y a 10 j : vent {:?} m/s, houle {:?} m, air {:?} °C", wp.wind_speed_ms, wp.wave_height_m, wp.temp_air_c);
}
