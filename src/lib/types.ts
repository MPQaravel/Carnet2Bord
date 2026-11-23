// Types miroir du noyau Rust (logbook-core). Les structures JSON échangées
// avec les commandes Tauri utilisent exactement ces noms (serde snake_case côté Rust
// pour les enums, champs en snake_case partout).

export interface Weather {
  wind_speed_ms?: number | null;
  wind_gust_ms?: number | null;
  wind_dir_deg?: number | null;
  beaufort?: number | null;
  wmo_code?: number | null;
  cloud_cover_pct?: number | null;
  precipitation_mm?: number | null;
  visibility_m?: number | null;
  wave_height_m?: number | null;
  wave_dir_deg?: number | null;
  wave_period_s?: number | null;
  sea_temp_c?: number | null;
  sea_state?: string | null;
  temp_air_c?: number | null;
  pressure_hpa?: number | null;
}

export type PositionSource = "gps" | "last_known" | "manual";
export type WeatherSource = "open_meteo" | "manual" | "offline";

export interface Log {
  id: string;
  log_datetime: string; // "YYYY-MM-DDTHH:MM:SS" (naive local)
  stardate?: string | null;
  vessel: string;
  departure: string;
  destination: string;
  heading_deg?: number | null;
  speed_kn?: number | null;
  sails: string;
  crew: string;
  lat?: number | null;
  lon?: number | null;
  position_source: PositionSource;
  observations: string;
  weather?: Weather | null;
  weather_captured_at?: string | null;
  weather_source: WeatherSource;
  overrides: string[];
  offline: boolean;
  navigation_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogInput {
  id?: string | null;
  log_datetime: string;
  vessel: string;
  departure: string;
  destination: string;
  heading_deg?: number | null;
  speed_kn?: number | null;
  sails: string;
  crew: string;
  lat?: number | null;
  lon?: number | null;
  position_source: PositionSource;
  observations: string;
  weather?: Weather | null;
  weather_captured_at?: string | null;
  weather_source: WeatherSource;
  overrides: string[];
  offline: boolean;
}

export interface Photo {
  id: string;
  log_id: string;
  file_name: string;
  rel_path: string;
  size_bytes: number;
  created_at: string;
}

export interface Navigation {
  id: string;
  name: string;
  vessel: string;
  created_at: string;
}

export interface NavigationSummary {
  navigation: Navigation;
  log_ids: string[];
  start?: string | null;
  end?: string | null;
  duration_hours?: number | null;
  distance_nm?: number | null;
  avg_wind_ms?: number | null;
  avg_temp_c?: number | null;
  max_wave_m?: number | null;
  status: "ongoing" | "finished";
}

export interface LogFilter {
  query?: string | null;
  vessel?: string | null;
  navigation_id?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface Settings {
  theme: string; // "dark" (clair en phase 2)
  stardate: string; // "1" | "0"
  transcription_mode: string; // "mistral" | "local" | "none"
  mistral_api_key: string;
  mistral_model: string; // ex. whisper-large-v3
  mistral_base_url: string;
  whisper_binary: string; // ex. whisper-cli
  whisper_model_path: string; // ex. ggml-base.bin
  dictation_language: string; // "fr"
  position_format: string; // "decimal" | "dm" | "dms"
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  stardate: "1",
  transcription_mode: "mistral",
  mistral_api_key: "",
  mistral_model: "whisper-large-v3",
  mistral_base_url: "https://api.mistral.ai/v1",
  whisper_binary: "whisper-cli",
  whisper_model_path: "",
  dictation_language: "fr",
  position_format: "decimal",
};
