//! Couche d'accès aux données : backend Tauri (SQLite embarquée) en production,
//! backend navigateur (localStorage) pour le développement `npm run dev`.
//! Même interface, logique métier côté noyau Rust quand Tauri est présent.

import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Log, LogFilter, LogInput, Navigation, NavigationSummary, Photo, Settings,
  Weather, DEFAULT_SETTINGS,
} from "./types";
import { haversineNm, logNumber, parseNaive, seaState, beaufortFromMs } from "./format";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Backend {
  readonly kind: "tauri" | "browser";
  listLogs(filter: LogFilter): Promise<Log[]>;
  getLog(id: string): Promise<Log | null>;
  saveLog(input: LogInput): Promise<Log>;
  deleteLog(id: string): Promise<void>;
  lastLog(): Promise<Log | null>;
  lastPosition(): Promise<{ lat: number; lon: number } | null>;
  listNavigations(): Promise<Navigation[]>;
  renameNavigation(id: string, name: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSetting(key: keyof Settings, value: string): Promise<void>;
  fetchWeather(lat: number, lon: number, datetimeISO: string): Promise<Weather>;
  retryPendingWeather(): Promise<string[]>;
  addPhoto(logId: string, fileName: string, data: Uint8Array): Promise<Photo>;
  listPhotos(logId: string): Promise<Photo[]>;
  deletePhoto(id: string): Promise<void>;
  photoURL(p: Photo): Promise<string | null>;
  exportJSON(): Promise<string>;
  importJSON(json: string): Promise<number>;
  transcribeAudio(bytes: Uint8Array, mime: string): Promise<string>;
}

// ---------- Météo Open-Meteo (miroir du noyau Rust) ----------

export class OfflineError extends Error {
  constructor() {
    super("hors ligne");
    this.name = "OfflineError";
  }
}

function forecastUrl(lat: number, lon: number, target: Date): string {
  const t0 = new Date(target); t0.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, "0")}-${String(t0.getDate()).padStart(2, "0")}`;
  const range = t0 < today ? `start_date=${d}&end_date=${d}` : "forecast_days=1";
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&wind_speed_unit=ms`
    + `&current=temperature_2m,weather_code,cloud_cover,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`
    + `&hourly=temperature_2m,weather_code,cloud_cover,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&${range}`;
}

function marineUrl(lat: number, lon: number, target: Date): string {
  const t0 = new Date(target); t0.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, "0")}-${String(t0.getDate()).padStart(2, "0")}`;
  const range = t0 < today ? `start_date=${d}&end_date=${d}` : "forecast_days=1";
  return `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto`
    + `&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature&${range}`;
}

function nearestIndex(times: unknown, target: Date): number {
  if (!Array.isArray(times)) return -1;
  let best = -1;
  let bestDelta = Infinity;
  times.forEach((t, i) => {
    if (typeof t !== "string") return;
    const dt = parseNaive(t.replace("Z", ""));
    if (!dt) return;
    const delta = Math.abs(dt.getTime() - target.getTime());
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  });
  return best;
}

function pick(arr: unknown, idx: number): number | null {
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return null;
  const v = arr[idx];
  return typeof v === "number" ? v : null;
}

export function buildWeather(forecast: any, marine: any, targetISO: string): Weather {
  const target = parseNaive(targetISO)!;
  const cur = forecast?.current ?? {};
  const hourly = forecast?.hourly ?? {};
  const idx = nearestIndex(hourly.time, target);
  const p = (key: string): number | null => {
    const h = pick(hourly[key], idx);
    return h ?? (typeof cur[key] === "number" ? cur[key] : null);
  };
  const w: Weather = {};
  w.temp_air_c = p("temperature_2m");
  w.wmo_code = p("weather_code") ?? (typeof cur.weather_code === "number" ? cur.weather_code : null);
  w.cloud_cover_pct = p("cloud_cover");
  w.precipitation_mm = p("precipitation");
  w.pressure_hpa = p("pressure_msl");
  w.wind_speed_ms = p("wind_speed_10m");
  const wd = p("wind_direction_10m");
  w.wind_dir_deg = wd != null ? ((wd % 360) + 360) % 360 : null;
  w.wind_gust_ms = p("wind_gusts_10m");
  w.visibility_m = p("visibility") ?? (typeof cur.visibility === "number" ? cur.visibility : null);
  w.beaufort = w.wind_speed_ms != null ? beaufortFromMs(w.wind_speed_ms) : null;

  const mh = marine?.hourly ?? {};
  const midx = nearestIndex(mh.time, target);
  const mp = (key: string): number | null => pick(mh[key], midx);
  w.wave_height_m = mp("wave_height");
  const wdir = mp("wave_direction");
  w.wave_dir_deg = wdir != null ? ((wdir % 360) + 360) % 360 : null;
  w.wave_period_s = mp("wave_period");
  w.sea_temp_c = mp("sea_surface_temperature");
  w.sea_state = seaState(w.wave_height_m, w.wind_speed_ms);
  return w;
}

export async function fetchWeatherHTTP(lat: number, lon: number, datetimeISO: string): Promise<Weather> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new OfflineError();
  const target = parseNaive(datetimeISO)!;
  let fr: unknown;
  try {
    const r = await fetch(forecastUrl(lat, lon, target));
    if (!r.ok) throw new Error(`Open-Meteo : HTTP ${r.status}`);
    fr = await r.json();
  } catch (e) {
    // échec réseau / CORS -> vraiment hors ligne ; HTTP -> erreur explicite
    if (e instanceof Error && e.message.startsWith("Open-Meteo")) throw e;
    throw new OfflineError();
  }
  let mr: unknown = null;
  try {
    const r = await fetch(marineUrl(lat, lon, target));
    if (r.ok) mr = await r.json();
  } catch { /* la houle est optionnelle */ }
  return buildWeather(fr as any, mr as any, datetimeISO);
}

// ---------- Récapitulatifs de navigation (miroir du noyau) ----------

export function summarizeNavigations(logs: Log[], navs: Navigation[]): NavigationSummary[] {
  const byNav = new Map<string, Log[]>();
  const orphan: Log[] = [];
  for (const l of logs) {
    if (l.navigation_id) {
      if (!byNav.has(l.navigation_id)) byNav.set(l.navigation_id, []);
      byNav.get(l.navigation_id)!.push(l);
    } else orphan.push(l);
  }
  const now = new Date();
  const out: NavigationSummary[] = [];
  for (const n of navs) {
    const group = (byNav.get(n.id) ?? []).slice().sort((a, b) => a.log_datetime.localeCompare(b.log_datetime));
    const start = group[0]?.log_datetime ?? null;
    const end = group[group.length - 1]?.log_datetime ?? null;
    const duration = start && end ? (parseNaive(end)!.getTime() - parseNaive(start)!.getTime()) / 3.6e6 : null;
    let dist: number | null = 0;
    let prev: [number, number] | null = null;
    let nPos = 0;
    for (const l of group) {
      if (l.lat != null && l.lon != null) {
        nPos++;
        if (prev) dist! += haversineNm(prev[0], prev[1], l.lat, l.lon);
        prev = [l.lat, l.lon];
      }
    }
    if (nPos < 2) dist = null;
    const avg = (f: (w: Weather) => number | null | undefined): number | null => {
      const vals = group.map((l) => l.weather && f(l.weather)).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const waves = group.map((l) => l.weather?.wave_height_m).filter((v): v is number => typeof v === "number");
    const endDate = end ? parseNaive(end)! : null;
    out.push({
      navigation: n,
      log_ids: group.map((l) => l.id),
      start,
      end,
      duration_hours: duration,
      distance_nm: dist,
      avg_wind_ms: avg((w) => w.wind_speed_ms),
      avg_temp_c: avg((w) => w.temp_air_c),
      max_wave_m: waves.length ? Math.max(...waves) : null,
      status: endDate && now.getTime() - endDate.getTime() < 48 * 3.6e6 ? "ongoing" : "finished",
    });
  }
  if (orphan.length) {
    out.push({
      navigation: { id: "__orphan__", name: "Sans navigation", vessel: "", created_at: "" },
      log_ids: orphan.map((l) => l.id),
      start: null, end: null, duration_hours: null, distance_nm: null,
      avg_wind_ms: null, avg_temp_c: null, max_wave_m: null, status: "finished",
    });
  }
  out.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
  return out;
}

// ---------- Backend Tauri ----------

class TauriBackend implements Backend {
  readonly kind = "tauri" as const;
  listLogs(filter: LogFilter) { return invoke<Log[]>("list_logs", { filter }); }
  getLog(id: string) { return invoke<Log | null>("get_log", { id }); }
  saveLog(input: LogInput) { return invoke<Log>("save_log", { input }); }
  deleteLog(id: string) { return invoke<void>("delete_log", { id }); }
  lastLog() { return invoke<Log | null>("last_log"); }
  lastPosition() { return invoke<{ lat: number; lon: number } | null>("last_position"); }
  listNavigations() { return invoke<Navigation[]>("list_navigations"); }
  renameNavigation(id: string, name: string) { return invoke<void>("rename_navigation", { id, name }); }
  async getSettings(): Promise<Settings> {
    const kv = await invoke<[string, string][]>("get_settings");
    const s = { ...DEFAULT_SETTINGS };
    for (const [k, v] of kv) if (k in s) (s as any)[k] = v;
    return s;
  }
  setSetting(key: keyof Settings, value: string) { return invoke<void>("set_setting", { key, value }); }
  async fetchWeather(lat: number, lon: number, datetimeISO: string): Promise<Weather> {
    try {
      return await invoke<Weather>("fetch_weather", { lat, lon, datetime: datetimeISO });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("OFFLINE") || (typeof navigator !== "undefined" && !navigator.onLine)) throw new OfflineError();
      throw new Error(msg);
    }
  }
  retryPendingWeather() { return invoke<string[]>("retry_pending_weather"); }
  addPhoto(logId: string, fileName: string, data: Uint8Array) {
    return invoke<Photo>("add_photo", { logId, fileName, bytes: Array.from(data) });
  }
  listPhotos(logId: string) { return invoke<Photo[]>("list_photos", { logId }); }
  deletePhoto(id: string) { return invoke<void>("delete_photo", { id }); }
  async photoURL(p: Photo): Promise<string | null> {
    const path = await invoke<string | null>("photo_path", { id: p.id });
    return path ? convertFileSrc(path) : null;
  }
  exportJSON() { return invoke<string>("export_json_cmd"); }
  importJSON(json: string) { return invoke<number>("import_json_cmd", { json }); }
  transcribeAudio(bytes: Uint8Array, mime: string) {
    return invoke<string>("transcribe_audio", { bytes: Array.from(bytes), mime });
  }
}

// ---------- Backend navigateur (dev hors Tauri) ----------

interface BrowserDb {
  logs: Log[];
  photos: { photo: Photo; dataURL: string }[];
  navigations: Navigation[];
  settings: Record<string, string>;
}

const LS_KEY = "logbook.db.v1";

function loadDb(): BrowserDb {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* base corrompue -> on repart à zéro */ }
  return { logs: [], photos: [], navigations: [], settings: {} };
}
function persistDb(db: BrowserDb) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

class BrowserBackend implements Backend {
  readonly kind = "browser" as const;
  private db(): BrowserDb { return loadDb(); }

  async listLogs(filter: LogFilter): Promise<Log[]> {
    let logs = this.db().logs.slice();
    if (filter.query) {
      const q = filter.query.toLowerCase();
      logs = logs.filter((l) =>
        [l.observations, l.vessel, l.crew, l.departure, l.destination].some((f) => f.toLowerCase().includes(q)));
    }
    if (filter.vessel) logs = logs.filter((l) => l.vessel.toLowerCase() === filter.vessel!.toLowerCase());
    if (filter.navigation_id) logs = logs.filter((l) => l.navigation_id === filter.navigation_id);
    if (filter.from) logs = logs.filter((l) => l.log_datetime >= filter.from!);
    if (filter.to) logs = logs.filter((l) => l.log_datetime <= filter.to!);
    return logs.sort((a, b) => b.log_datetime.localeCompare(a.log_datetime) || b.created_at.localeCompare(a.created_at));
  }
  async getLog(id: string) { return this.db().logs.find((l) => l.id === id) ?? null; }
  async saveLog(input: LogInput): Promise<Log> {
    const db = this.db();
    const now = new Date();
    const nowISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const id = input.id ?? crypto.randomUUID();
    let navigationId: string | null = null;
    const existing = db.logs.find((l) => l.id === id);
    if (existing) navigationId = existing.navigation_id ?? null;
    else {
      const prev = db.logs
        .filter((l) => l.vessel.toLowerCase() === input.vessel.toLowerCase() && l.log_datetime < input.log_datetime)
        .sort((a, b) => b.log_datetime.localeCompare(a.log_datetime))[0];
      if (prev?.navigation_id) {
        const gapH = (parseNaive(input.log_datetime)!.getTime() - parseNaive(prev.log_datetime)!.getTime()) / 3.6e6;
        if (gapH < 48) navigationId = prev.navigation_id;
      }
      if (!navigationId) {
        navigationId = crypto.randomUUID();
        const name = input.departure.trim() && input.destination.trim()
          ? `${input.departure.trim()} → ${input.destination.trim()}`
          : `Navigation du ${input.log_datetime.slice(8, 10)}/${input.log_datetime.slice(5, 7)}/${input.log_datetime.slice(0, 4)}`;
        db.navigations.push({ id: navigationId, name, vessel: input.vessel, created_at: nowISO });
      }
    }
    const settings = await this.getSettings();
    const log: Log = {
      id,
      log_datetime: input.log_datetime,
      stardate: settings.stardate === "1" ? logNumber(input.log_datetime) : null,
      vessel: input.vessel, departure: input.departure, destination: input.destination,
      heading_deg: input.heading_deg ?? null, speed_kn: input.speed_kn ?? null,
      sails: input.sails, crew: input.crew,
      lat: input.lat ?? null, lon: input.lon ?? null,
      position_source: input.position_source,
      observations: input.observations,
      weather: input.weather ?? null,
      weather_captured_at: input.weather_captured_at ?? null,
      weather_source: input.weather_source,
      overrides: input.overrides,
      offline: input.offline,
      navigation_id: navigationId,
      created_at: existing?.created_at ?? nowISO,
      updated_at: nowISO,
    };
    const i = db.logs.findIndex((l) => l.id === id);
    if (i >= 0) db.logs[i] = log; else db.logs.push(log);
    persistDb(db);
    return log;
  }
  async deleteLog(id: string) {
    const db = this.db();
    db.logs = db.logs.filter((l) => l.id !== id);
    db.photos = db.photos.filter((p) => p.photo.log_id !== id);
    persistDb(db);
  }
  async lastLog() {
    const logs = this.db().logs.slice().sort((a, b) => b.log_datetime.localeCompare(a.log_datetime));
    return logs[0] ?? null;
  }
  async lastPosition() {
    const l = this.db().logs.filter((l) => l.lat != null && l.lon != null).sort((a, b) => b.log_datetime.localeCompare(a.log_datetime))[0];
    return l ? { lat: l.lat!, lon: l.lon! } : null;
  }
  async listNavigations() { return this.db().navigations; }
  async renameNavigation(id: string, name: string) {
    const db = this.db();
    const n = db.navigations.find((n) => n.id === id);
    if (n) n.name = name;
    persistDb(db);
  }
  async getSettings(): Promise<Settings> {
    const s = { ...DEFAULT_SETTINGS };
    for (const [k, v] of Object.entries(this.db().settings)) if (k in s) (s as any)[k] = v;
    return s;
  }
  async setSetting(key: keyof Settings, value: string) {
    const db = this.db();
    db.settings[key] = value;
    persistDb(db);
  }
  async fetchWeather(lat: number, lon: number, datetimeISO: string) { return fetchWeatherHTTP(lat, lon, datetimeISO); }
  async retryPendingWeather(): Promise<string[]> {
    const db = this.db();
    const updated: string[] = [];
    for (const l of db.logs) {
      if (!l.weather && l.lat != null && l.lon != null) {
        try {
          l.weather = await fetchWeatherHTTP(l.lat, l.lon, l.log_datetime);
          l.weather_captured_at = new Date().toISOString().slice(0, 19);
          l.weather_source = "open_meteo";
          l.offline = false;
          updated.push(l.id);
        } catch { /* toujours hors ligne */ }
      }
    }
    if (updated.length) persistDb(db);
    return updated;
  }
  async addPhoto(logId: string, fileName: string, data: Uint8Array): Promise<Photo> {
    const db = this.db();
    const photo: Photo = {
      id: crypto.randomUUID(), log_id: logId, file_name: fileName,
      rel_path: `photos/${crypto.randomUUID()}.jpg`, size_bytes: data.length,
      created_at: new Date().toISOString().slice(0, 19),
    };
    const dataURL = `data:image/jpeg;base64,${btoa(String.fromCharCode(...data))}`;
    db.photos.push({ photo, dataURL });
    persistDb(db);
    return photo;
  }
  async listPhotos(logId: string) { return this.db().photos.filter((p) => p.photo.log_id === logId).map((p) => p.photo); }
  async deletePhoto(id: string) {
    const db = this.db();
    db.photos = db.photos.filter((p) => p.photo.id !== id);
    persistDb(db);
  }
  async photoURL(p: Photo): Promise<string | null> {
    return this.db().photos.find((x) => x.photo.id === p.id)?.dataURL ?? null;
  }
  async exportJSON(): Promise<string> {
    const db = this.db();
    return JSON.stringify({
      app: "logbook", version: 1, exported_at: new Date().toISOString(),
      settings: Object.entries(db.settings), navigations: db.navigations, logs: db.logs,
      photos: db.photos.map((p) => ({ ...p.photo, data_base64: p.dataURL.split(",")[1] ?? null })),
    }, null, 2);
  }
  async importJSON(json: string): Promise<number> {
    const ex = JSON.parse(json);
    if (ex.version !== 1) throw new Error(`Version d'export non supportée : ${ex.version}`);
    const db: BrowserDb = { logs: ex.logs ?? [], navigations: ex.navigations ?? [], settings: Object.fromEntries(ex.settings ?? []), photos: [] };
    for (const p of ex.photos ?? []) {
      db.photos.push({ photo: { id: p.id, log_id: p.log_id, file_name: p.file_name, rel_path: p.rel_path, size_bytes: p.size_bytes, created_at: p.created_at }, dataURL: `data:image/jpeg;base64,${p.data_base64 ?? ""}` });
    }
    persistDb(db);
    return db.logs.length;
  }
  async transcribeAudio(bytes: Uint8Array, mime: string): Promise<string> {
    const s = await this.getSettings();
    if (s.transcription_mode === "none") throw new Error("Transcription désactivée dans les réglages");
    if (s.transcription_mode === "local") throw new Error("Le mode Whisper local n'est disponible que dans l'application Tauri");
    if (!s.mistral_api_key.trim()) throw new Error("Clé API Mistral manquante — la renseigner dans ⚙️ Réglages → Dictée vocale");
    const base = (s.mistral_base_url.trim() || "https://api.mistral.ai/v1").replace(/\/+$/, "");
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
    const form = new FormData();
    form.append("model", s.mistral_model.trim() || "whisper-large-v3");
    form.append("language", s.dictation_language.trim() || "fr");
    form.append("response_format", "text");
    form.append("file", new File([bytes as BlobPart], `audio.${ext}`, { type: mime }));
    let r: Response;
    try {
      r = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.mistral_api_key.trim()}` },
        body: form,
      });
    } catch {
      throw new OfflineError();
    }
    if (!r.ok) throw new Error(`API Mistral : HTTP ${r.status}`);
    const t = (await r.text()).trim();
    try {
      const j = JSON.parse(t);
      return typeof j.text === "string" ? j.text : t;
    } catch {
      return t;
    }
  }
}

export function getBackend(): Backend {
  return isTauri ? new TauriBackend() : new BrowserBackend();
}
