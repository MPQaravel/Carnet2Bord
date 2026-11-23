//! Panneau météo : 4 blocs (vent, ciel, mer, air), tags AUTO / MANUEL / ✍️ modifié,
//! édition inline de toute valeur automatique.
import { useState } from "react";
import { Weather, WeatherSource } from "../lib/types";
import { beaufortFromMs, beaufortLabel, cardinal, msToKnots, seaState, wmoInfo } from "../lib/format";
import { AirIcon, SeaIcon, Tag, WindIcon, WmoIcon } from "./bits";

interface Props {
  weather: Weather | null;
  source: WeatherSource;
  offline: boolean;
  overrides: Set<string>;
  capturedAt?: string | null;
  refreshing: boolean;
  onEdit(block: string, patch: Partial<Weather>): void;
  onRefresh(): void;
}

function num(v?: number | null): string {
  return v == null ? "—" : String(Math.round(v * 100) / 100);
}

export function WeatherPanel({ weather, source, offline, overrides, capturedAt, refreshing, onEdit, onRefresh }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const w = weather;
  const empty = !w || (w.wind_speed_ms == null && w.wmo_code == null && w.wave_height_m == null && w.temp_air_c == null);

  const tagFor = (block: string) => {
    if (overrides.has(block)) return <Tag kind="edited" />;
    if (offline || source === "offline" || source === "manual") return <Tag kind="manual" />;
    return <Tag kind="auto" />;
  };

  const set = (block: string, patch: Partial<Weather>) => {
    const base: Weather = { ...(w ?? {}) };
    Object.assign(base, patch);
    if (patch.wind_speed_ms !== undefined) base.beaufort = patch.wind_speed_ms != null ? beaufortFromMs(patch.wind_speed_ms) : null;
    if (patch.wave_height_m !== undefined || patch.wind_speed_ms !== undefined) base.sea_state = seaState(base.wave_height_m, base.wind_speed_ms);
    onEdit(block, base);
  };

  const inp = (label: string, value: number | null | undefined, onChange: (v: number | null) => void) => (
    <label className="field" key={label}>
      <span style={{ fontSize: "0.7rem", color: "var(--text-2)" }}>{label}</span>
      <input
        type="number" step="any" inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
      />
    </label>
  );

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.6rem" }}>
        <h3>Contexte automatique</h3>
        <div className="row">
          {capturedAt && <span className="small muted">capturé à {capturedAt.slice(11, 16)}</span>}
          <button type="button" className="btn ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Actualisation…" : "↻ Rafraîchir la météo"}
          </button>
        </div>
      </div>
      <div className="weather-grid">
        {/* VENT */}
        <div className={`wblock ${editing === "wind" ? "editing" : ""} ${w?.wind_speed_ms == null && !overrides.has("wind") ? "empty" : ""}`}>
          <div className="wlabel"><WindIcon /> Vent</div>
          <div className="wvalue">
            {w?.beaufort != null ? `F${w.beaufort}` : w?.wind_speed_ms == null ? "saisie manuelle requise" : "—"}
          </div>
          <div className="wsub">
            {w?.wind_speed_ms != null && `${num(msToKnots(w.wind_speed_ms))} nd · ${num(w.wind_speed_ms)} m/s`}
            {w?.wind_gust_ms != null && ` · rafales ${num(msToKnots(w.wind_gust_ms))} nd`}
          </div>
          <div className="wsub">{w?.wind_dir_deg != null ? `${Math.round(w.wind_dir_deg)}° (${cardinal(w.wind_dir_deg)})` : ""}</div>
          {w?.beaufort != null && <div className="wsub">{beaufortLabel(w.beaufort)}</div>}
          <span className="wtag">{tagFor("wind")}</span>
          <button type="button" className="wedit" title="Modifier le vent" onClick={() => setEditing(editing === "wind" ? null : "wind")}>✍️</button>
          {editing === "wind" && (
            <div className="winputs">
              {inp("vitesse (m/s)", w?.wind_speed_ms, (v) => set("wind", { wind_speed_ms: v }))}
              {inp("rafales (m/s)", w?.wind_gust_ms, (v) => set("wind", { wind_gust_ms: v }))}
              {inp("direction (°)", w?.wind_dir_deg, (v) => set("wind", { wind_dir_deg: v }))}
            </div>
          )}
        </div>

        {/* CIEL */}
        <div className={`wblock ${editing === "sky" ? "editing" : ""} ${w?.wmo_code == null && !overrides.has("sky") ? "empty" : ""}`}>
          <div className="wlabel"><WmoIcon code={w?.wmo_code} /> Ciel</div>
          <div className="wvalue">{w?.wmo_code != null ? wmoInfo(w.wmo_code).label : "saisie manuelle requise"}</div>
          <div className="wsub">
            {w?.cloud_cover_pct != null && `couverture ${Math.round(w.cloud_cover_pct)} %`}
            {w?.precipitation_mm != null && w.precipitation_mm > 0 && ` · précip. ${num(w.precipitation_mm)} mm`}
          </div>
          <div className="wsub">{w?.visibility_m != null ? `visibilité ${w.visibility_m >= 1000 ? `${Math.round(w.visibility_m / 100) / 10} km` : `${Math.round(w.visibility_m)} m`}` : ""}</div>
          <span className="wtag">{tagFor("sky")}</span>
          <button type="button" className="wedit" title="Modifier le ciel" onClick={() => setEditing(editing === "sky" ? null : "sky")}>✍️</button>
          {editing === "sky" && (
            <div className="winputs">
              <label className="field"><span style={{ fontSize: "0.7rem", color: "var(--text-2)" }}>code météo</span>
                <select value={w?.wmo_code ?? ""} onChange={(e) => set("sky", { wmo_code: e.target.value === "" ? null : parseInt(e.target.value) })}>
                  <option value="">—</option>
                  {[0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 80, 81, 82, 95, 96, 99].map((c) => (
                    <option key={c} value={c}>{c} — {wmoInfo(c).label}</option>
                  ))}
                </select>
              </label>
              {inp("couverture (%)", w?.cloud_cover_pct, (v) => set("sky", { cloud_cover_pct: v }))}
              {inp("précip. (mm)", w?.precipitation_mm, (v) => set("sky", { precipitation_mm: v }))}
              {inp("visibilité (m)", w?.visibility_m, (v) => set("sky", { visibility_m: v }))}
            </div>
          )}
        </div>

        {/* MER */}
        <div className={`wblock ${editing === "sea" ? "editing" : ""} ${w?.wave_height_m == null && !overrides.has("sea") ? "empty" : ""}`}>
          <div className="wlabel"><SeaIcon /> Mer</div>
          <div className="wvalue">{w?.wave_height_m != null ? `${num(w.wave_height_m)} m` : "saisie manuelle requise"}</div>
          <div className="wsub">
            {w?.sea_state && w.sea_state}
            {w?.wave_period_s != null && ` · période ${num(w.wave_period_s)} s`}
          </div>
          <div className="wsub">
            {w?.wave_dir_deg != null && `de ${cardinal(w.wave_dir_deg)}`}
            {w?.sea_temp_c != null && ` · eau ${num(w.sea_temp_c)} °C`}
          </div>
          <span className="wtag">{tagFor("sea")}</span>
          <button type="button" className="wedit" title="Modifier la mer" onClick={() => setEditing(editing === "sea" ? null : "sea")}>✍️</button>
          {editing === "sea" && (
            <div className="winputs">
              {inp("houle (m)", w?.wave_height_m, (v) => set("sea", { wave_height_m: v }))}
              {inp("direction (°)", w?.wave_dir_deg, (v) => set("sea", { wave_dir_deg: v }))}
              {inp("période (s)", w?.wave_period_s, (v) => set("sea", { wave_period_s: v }))}
              {inp("temp. eau (°C)", w?.sea_temp_c, (v) => set("sea", { sea_temp_c: v }))}
            </div>
          )}
        </div>

        {/* AIR */}
        <div className={`wblock ${editing === "air" ? "editing" : ""} ${w?.temp_air_c == null && !overrides.has("air") ? "empty" : ""}`}>
          <div className="wlabel"><AirIcon /> Air</div>
          <div className="wvalue">{w?.temp_air_c != null ? `${num(w.temp_air_c)} °C` : "saisie manuelle requise"}</div>
          <div className="wsub">{w?.pressure_hpa != null ? `pression ${num(w.pressure_hpa)} hPa` : ""}</div>
          <span className="wtag">{tagFor("air")}</span>
          <button type="button" className="wedit" title="Modifier l'air" onClick={() => setEditing(editing === "air" ? null : "air")}>✍️</button>
          {editing === "air" && (
            <div className="winputs">
              {inp("température (°C)", w?.temp_air_c, (v) => set("air", { temp_air_c: v }))}
              {inp("pression (hPa)", w?.pressure_hpa, (v) => set("air", { pressure_hpa: v }))}
            </div>
          )}
        </div>
      </div>
      {empty && <p className="small" style={{ color: "var(--amber)", marginTop: "0.5rem" }}>Aucune donnée météo disponible — saisie manuelle requise (hors ligne ?).</p>}
    </div>
  );
}
