//! Journal : logs groupés par navigation, recherche plein texte, filtres
//! (date, navire, navigation), édition / suppression, photos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Backend, summarizeNavigations } from "../lib/backend";
import { Log, LogFilter, Navigation, Photo, Settings, Weather } from "../lib/types";
import {
  beaufortLabel, cardinal, fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtNm, fmtTime, msToKnots, stardate, wmoInfo,
} from "../lib/format";
import { AirIcon, SeaIcon, Tag, WmoIcon, WindIcon } from "../components/bits";

interface Props {
  backend: Backend;
  settings: Settings;
  onNewLog: () => void;
  onEditLog: (id: string) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  refreshKey: number;
}

function weatherChips(log: Log) {
  const w: Weather | undefined = log.weather ?? undefined;
  if (!w) return <span className="chip">météo non renseignée {log.offline && "(hors ligne)"}</span>;
  const chips: JSX.Element[] = [];
  const edited = (b: string) => log.overrides.includes(b) ? <span className="edited-mark" title="modifié manuellement">✍️</span> : null;
  if (w.beaufort != null || w.wind_speed_ms != null) {
    chips.push(
      <span className="chip" key="wind" title={w.beaufort != null ? beaufortLabel(w.beaufort) : ""}>
        <WindIcon /> {w.beaufort != null ? `F${w.beaufort}` : "—"}
        {w.wind_speed_ms != null && ` · ${Math.round(msToKnots(w.wind_speed_ms) * 10) / 10} nd`}
        {w.wind_dir_deg != null && ` · ${cardinal(w.wind_dir_deg)}`} {edited("wind")}
      </span>,
    );
  }
  if (w.wmo_code != null) {
    chips.push(
      <span className="chip" key="sky" title={w.cloud_cover_pct != null ? `couverture ${Math.round(w.cloud_cover_pct)} %` : ""}>
        <WmoIcon code={w.wmo_code} /> {wmoInfo(w.wmo_code).label} {edited("sky")}
      </span>,
    );
  }
  if (w.wave_height_m != null || w.sea_state) {
    chips.push(
      <span className="chip" key="sea" title={w.sea_temp_c != null ? `eau ${w.sea_temp_c} °C` : ""}>
        <SeaIcon /> {w.wave_height_m != null ? `${w.wave_height_m} m` : ""}{w.sea_state ? ` ${w.sea_state}` : ""} {edited("sea")}
      </span>,
    );
  }
  if (w.temp_air_c != null || w.pressure_hpa != null) {
    chips.push(
      <span className="chip" key="air">
        <AirIcon /> {w.temp_air_c != null ? `${w.temp_air_c} °C` : ""}{w.pressure_hpa != null ? ` · ${Math.round(w.pressure_hpa)} hPa` : ""} {edited("air")}
      </span>,
    );
  }
  return <>{chips}</>;
}

function LogCard({ backend, log, settings, onEdit, onDelete, onToast }: {
  backend: Backend; log: Log; settings: Settings;
  onEdit: (id: string) => void; onDelete: (id: string) => void; onToast: (msg: string) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ps = await backend.listPhotos(log.id);
      setPhotos(ps);
      const u: Record<string, string | null> = {};
      for (const p of ps) u[p.id] = await backend.photoURL(p);
      setUrls(u);
    })();
  }, [backend, log.id]);

  const d = new Date(log.log_datetime.replace(" ", "T"));
  const anyEdited = log.overrides.length > 0;

  return (
    <article className="log-card">
      <div className="log-date">
        <div className="d">{fmtDate(log.log_datetime)}</div>
        <div className="t">{fmtTime(log.log_datetime)}</div>
        {settings.stardate === "1" && <div className="sd">stardate {stardate(d)}</div>}
      </div>
      <div className="log-main">
        <div className="log-title">
          <span className="vessel">{log.vessel || "—"}</span>
          {(log.departure || log.destination) && <span className="route">{log.departure} → {log.destination}</span>}
          {log.heading_deg != null && <span className="nav">cap {Math.round(log.heading_deg)}° ({cardinal(log.heading_deg)})</span>}
          {log.speed_kn != null && <span className="nav">{log.speed_kn} nd</span>}
          {log.sails && <span className="nav">{log.sails}</span>}
          {log.lat != null && log.lon != null && <span className="nav">📍 {log.lat.toFixed(4)}°, {log.lon.toFixed(4)}°</span>}
        </div>
        {log.crew && <div className="small muted">Équipage : {log.crew}</div>}
        <p className={`log-obs ${log.observations ? "" : "empty"}`}>{log.observations || "Aucune observation."}</p>
        <div className="log-weather">
          {weatherChips(log)}
          {log.weather_source === "offline" && <Tag kind="manual" />}
          {log.weather_source === "open_meteo" && !log.offline && <Tag kind="auto" />}
          {log.weather_captured_at && <span className="chip small">météo capturée à {fmtTime(log.weather_captured_at)}</span>}
        </div>
        {anyEdited && <div className="edited-note">✍️ champs modifiés manuellement : {log.overrides.join(", ")}</div>}
        {photos.length > 0 && (
          <div className="log-photos">
            {photos.map((p) => urls[p.id]
              ? <img key={p.id} src={urls[p.id]!} alt={p.file_name} title={`${p.file_name} — ${fmtBytes(p.size_bytes)}`} onClick={() => setLightbox(urls[p.id]!)} />
              : null)}
          </div>
        )}
        {lightbox && (
          <div className="modal-backdrop" onClick={() => setLightbox(null)}>
            <div className="lightbox"><img src={lightbox} alt="photo" /></div>
          </div>
        )}
      </div>
      <div className="log-actions">
        <button type="button" className="icon-btn" title="Modifier" onClick={() => onEdit(log.id)}>✏️</button>
        <button type="button" className="icon-btn del" title="Supprimer"
          onClick={() => {
            if (window.confirm(`Supprimer le log du ${fmtDateTime(log.log_datetime)} ?`)) {
              onDelete(log.id);
              onToast("Log supprimé");
            }
          }}>🗑</button>
      </div>
    </article>
  );
}

export function Journal({ backend, settings, onNewLog, onEditLog, onToast, onError, refreshKey }: Props) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [navs, setNavs] = useState<Navigation[]>([]);
  const [query, setQuery] = useState("");
  const [vessel, setVessel] = useState("");
  const [navId, setNavId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    const filter: LogFilter = {
      query: query || null,
      vessel: vessel || null,
      navigation_id: navId || null,
      from: from ? `${from}T00:00:00` : null,
      to: to ? `${to}T23:59:59` : null,
    };
    const [l, n] = await Promise.all([backend.listLogs(filter), backend.listNavigations()]);
    setLogs(l);
    setNavs(n);
  }, [backend, query, vessel, navId, from, to]);

  useEffect(() => { void load().catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible")); }, [load, refreshKey]);

  const summaries = useMemo(() => summarizeNavigations(logs, navs), [logs, navs]);
  const vessels = useMemo(() => Array.from(new Set(logs.map((l) => l.vessel).filter(Boolean))).sort(), [logs]);

  const deleteLog = async (id: string) => {
    try { await backend.deleteLog(id); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Suppression impossible"); }
  };

  const commitRename = async (id: string) => {
    if (renameValue.trim()) {
      await backend.renameNavigation(id, renameValue.trim());
      await load();
    }
    setRenaming(null);
  };

  return (
    <div className="content">
      <div className="toolbar">
        <input type="search" placeholder="Rechercher (observations, navire, équipage, route)…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Recherche plein texte" />
        <select value={vessel} onChange={(e) => setVessel(e.target.value)} aria-label="Filtrer par navire">
          <option value="">Tous les navires</option>
          {vessels.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={navId} onChange={(e) => setNavId(e.target.value)} aria-label="Filtrer par navigation">
          <option value="">Toutes les navigations</option>
          {navs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Depuis le" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Jusqu'au" />
        <button type="button" className="btn primary big" onClick={onNewLog}>＋ Enregistrer un log</button>
      </div>

      {logs.length === 0 && (
        <div className="empty-state">
          <p>Aucun log pour le moment.</p>
          <p>Cliquez sur <strong>＋ Enregistrer un log</strong> pour ouvrir une session de saisie : l'ordinateur capture date, heure, position et météo, vous dictez vos observations.</p>
        </div>
      )}

      {summaries.map((s) => {
        const groupLogs = s.log_ids.map((id) => logs.find((l) => l.id === id)).filter((l): l is Log => !!l);
        if (!groupLogs.length) return null;
        return (
          <section key={s.navigation.id}>
            <div className="nav-header">
              {renaming === s.navigation.id ? (
                <>
                  <input className="nav-name-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void commitRename(s.navigation.id); if (e.key === "Escape") setRenaming(null); }}
                    autoFocus />
                  <button type="button" className="btn" onClick={() => void commitRename(s.navigation.id)}>OK</button>
                </>
              ) : (
                <>
                  <span className="nav-name">{s.navigation.name}</span>
                  <button type="button" className="icon-btn" title="Renommer la navigation"
                    onClick={() => { setRenaming(s.navigation.id); setRenameValue(s.navigation.name); }}>✏️</button>
                </>
              )}
              <span className={`badge ${s.status}`}>{s.status === "ongoing" ? "en cours" : "terminée"}</span>
              <span className="nav-meta">
                {s.navigation.vessel && <span>{s.navigation.vessel}</span>}
                <span>{s.log_ids.length} log{s.log_ids.length > 1 ? "s" : ""}</span>
                {s.start && <span>du {fmtDate(s.start)} au {fmtDate(s.end)}</span>}
                <span>durée {fmtDuration(s.duration_hours)}</span>
                <span>distance {fmtNm(s.distance_nm)}</span>
                {s.avg_wind_ms != null && <span>vent moyen {Math.round(msToKnots(s.avg_wind_ms) * 10) / 10} nd</span>}
                {s.avg_temp_c != null && <span>{Math.round(s.avg_temp_c * 10) / 10} °C moy.</span>}
                {s.max_wave_m != null && <span>houle max {s.max_wave_m} m</span>}
              </span>
            </div>
            {groupLogs.map((l) => (
              <LogCard key={l.id} backend={backend} log={l} settings={settings}
                onEdit={onEditLog} onDelete={(id) => void deleteLog(id)} onToast={onToast} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
