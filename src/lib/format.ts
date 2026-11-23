//! Utilitaires de formatage partagés (miroir des règles du noyau Rust).

export function parsePosition(input: string): { lat: number; lon: number } | { error: string } {
  const s = input.trim();
  if (!s) return { error: "Position vide" };
  // Décimal : deux nombres séparés par virgule ou espace
  const parts = s.split(/[,\s;]+/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^-?\d+([.,]\d+)?$/.test(p))) {
    const lat = parseFloat(parts[0].replace(",", "."));
    const lon = parseFloat(parts[1].replace(",", "."));
    return validate(lat, lon);
  }
  // DM / DMS
  const re = /(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)\s*"?)?)?\s*([NS])\s+(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'?\s*(?:(\d+(?:[.,]\d+)?)\s*"?)?)?\s*([EW])/i;
  const m = re.exec(s.toUpperCase());
  if (!m) return { error: "Format non reconnu : décimal « 48.6542, -4.4861 », DM « 48°39.2'N 4°29.2'W » ou DMS « 48°39'12\"N 4°29'12\"W »" };
  const num = (x?: string) => (x ? parseFloat(x.replace(",", ".")) : 0);
  let lat = num(m[1]) + num(m[2]) / 60 + num(m[3]) / 3600;
  let lon = num(m[5]) + num(m[6]) / 60 + num(m[7]) / 3600;
  if (m[4] === "S") lat = -lat;
  if (m[8] === "W") lon = -lon;
  return validate(lat, lon);
}

function validate(lat: number, lon: number) {
  if (Number.isNaN(lat) || Number.isNaN(lon)) return { error: "Valeurs non numériques" };
  if (lat < -90 || lat > 90) return { error: `Latitude hors plage [-90, 90] : ${lat}` };
  if (lon < -180 || lon > 180) return { error: `Longitude hors plage [-180, 180] : ${lon}` };
  return { lat, lon };
}

export function formatPosition(lat: number, lon: number, fmt: string): string {
  if (fmt === "dm") return formatDm(lat, lon);
  if (fmt === "dms") return formatDms(lat, lon);
  return `${lat.toFixed(4)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
}

function oneDm(v: number, pos: string, neg: string): string {
  const hemi = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  const deg = Math.trunc(a);
  const min = (a - deg) * 60;
  return `${deg}°${min.toFixed(2).padStart(5, "0")}'${hemi}`;
}
export function formatDm(lat: number, lon: number): string {
  return `${oneDm(lat, "N", "S")} ${oneDm(lon, "E", "W")}`;
}
function oneDms(v: number, pos: string, neg: string): string {
  const hemi = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  const deg = Math.trunc(a);
  const rem = (a - deg) * 60;
  const min = Math.trunc(rem);
  const sec = Math.round((rem - min) * 60);
  return `${deg}°${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"${hemi}`;
}
export function formatDms(lat: number, lon: number): string {
  return `${oneDms(lat, "N", "S")} ${oneDms(lon, "E", "W")}`;
}

const BEAUFORT_BOUNDS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function beaufortFromMs(ms: number): number {
  for (let i = 0; i < BEAUFORT_BOUNDS.length; i++) if (ms < BEAUFORT_BOUNDS[i]) return i;
  return 12;
}
const BEAUFORT_LABELS = [
  "0 — Calme", "1 — Très légère brise", "2 — Légère brise", "3 — Petite brise",
  "4 — Jolie brise", "5 — Bonne brise", "6 — Vent frais", "7 — Grand frais",
  "8 — Coup de vent", "9 — Fort coup de vent", "10 — Tempête", "11 — Violente tempête", "12 — Ouragan",
];
export function beaufortLabel(f: number): string {
  return BEAUFORT_LABELS[Math.min(12, Math.max(0, f))];
}
export function msToKnots(ms: number): number {
  return ms * 1.943844;
}

const POINTS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
export function cardinal(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  return POINTS[Math.floor((norm + 11.25) / 22.5) % 16];
}

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function seaState(waveM?: number | null, windMs?: number | null): string | null {
  if (waveM != null) {
    if (waveM < 0.1) return "Calme (glace)";
    if (waveM < 0.5) return "Calme (ridée)";
    if (waveM < 1.25) return "Peu agitée";
    if (waveM < 2.5) return "Agitée";
    if (waveM < 4) return "Forte";
    if (waveM < 6) return "Grosse";
    if (waveM < 9) return "Très grosse";
    return "Énorme";
  }
  if (windMs != null) {
    const f = beaufortFromMs(windMs);
    if (f <= 2) return "Calme (ridée)";
    if (f <= 4) return "Peu agitée";
    if (f <= 6) return "Agitée";
    if (f <= 8) return "Forte";
    return "Grosse";
  }
  return null;
}

const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Ciel dégagé", icon: "clear" },
  1: { label: "Plutôt dégagé", icon: "clear" },
  2: { label: "Partiellement nuageux", icon: "partly" },
  3: { label: "Couvert", icon: "overcast" },
  45: { label: "Brouillard", icon: "fog" },
  48: { label: "Brouillard givrant", icon: "fog" },
  51: { label: "Bruine", icon: "drizzle" }, 53: { label: "Bruine", icon: "drizzle" }, 55: { label: "Bruine", icon: "drizzle" },
  56: { label: "Bruine verglaçante", icon: "drizzle" }, 57: { label: "Bruine verglaçante", icon: "drizzle" },
  61: { label: "Pluie", icon: "rain" }, 63: { label: "Pluie", icon: "rain" }, 65: { label: "Pluie forte", icon: "rain" },
  66: { label: "Pluie verglaçante", icon: "rain" }, 67: { label: "Pluie verglaçante", icon: "rain" },
  71: { label: "Neige", icon: "snow" }, 73: { label: "Neige", icon: "snow" }, 75: { label: "Neige forte", icon: "snow" },
  77: { label: "Grains de neige", icon: "snow" },
  80: { label: "Averses", icon: "shower" }, 81: { label: "Averses", icon: "shower" }, 82: { label: "Fortes averses", icon: "shower" },
  85: { label: "Averses de neige", icon: "snow" }, 86: { label: "Averses de neige", icon: "snow" },
  95: { label: "Orage", icon: "storm" }, 96: { label: "Orage avec grêle", icon: "storm" }, 99: { label: "Orage avec grêle", icon: "storm" },
};
export function wmoInfo(code: number): { label: string; icon: string } {
  return WMO[code] ?? { label: "Inconnu", icon: "overcast" };
}

// ---------- Dates ----------

/** "2026-11-23T14:32:00" (naive local) -> "23/11/2026" */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseNaive(iso);
  if (!d) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseNaive(iso);
  if (!d) return iso;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDateTime(iso?: string | null): string {
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
export function parseNaive(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}
/** Date -> valeur pour <input type="datetime-local"> */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** valeur datetime-local -> ISO naive "YYYY-MM-DDTHH:MM:SS" */
export function fromLocalInputValue(v: string): string {
  return v.length === 16 ? `${v}:00` : v;
}
export function nowNaiveISO(): string {
  return fromLocalInputValue(toLocalInputValue(new Date()));
}

/** Numéro de log : « LOG AAAAMMJJ HHMM » à partir de la date/heure du log (ISO naive). */
export function logNumber(iso: string): string {
  const d = parseNaive(iso);
  if (!d) return "LOG —";
  return `LOG ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function fmtDuration(hours?: number | null): string {
  if (hours == null) return "—";
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  const d = Math.floor(hours / 24);
  return `${d} j ${Math.round(hours % 24)} h`;
}
export function fmtNm(nm?: number | null): string {
  if (nm == null) return "—";
  return `${Math.round(nm * 10) / 10} M`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
