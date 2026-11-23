//! Session d'enregistrement / édition d'un log.
//! Règles du cahier des charges :
//!  1. les champs automatiques sont capturés à l'enregistrement (pas à l'ouverture) ;
//!  2. toute valeur auto est écrasable, marquée « ✍️ modifié » ;
//!  3. si la date change, proposition de rafraîchir la météo correspondante.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Backend, OfflineError } from "../lib/backend";
import { Log, LogInput, Photo, Settings, Weather, WeatherSource } from "../lib/types";
import {
  fmtTime, formatPosition, fromLocalInputValue, nowNaiveISO, parsePosition, toLocalInputValue,
} from "../lib/format";
import { WeatherPanel } from "../components/WeatherPanel";
import { Dictation } from "../components/Dictation";
import { PendingPhoto, PhotoEditor } from "../components/PhotoEditor";

interface Props {
  backend: Backend;
  settings: Settings;
  logId: string | null;
  onSaved: (log: Log) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
  onToast: (msg: string) => void;
}

const BLOCK_FIELDS: Record<string, (keyof Weather)[]> = {
  wind: ["wind_speed_ms", "wind_gust_ms", "wind_dir_deg", "beaufort"],
  sky: ["wmo_code", "cloud_cover_pct", "precipitation_mm", "visibility_m"],
  sea: ["wave_height_m", "wave_dir_deg", "wave_period_s", "sea_temp_c", "sea_state"],
  air: ["temp_air_c", "pressure_hpa"],
};

function mergeWeather(fetched: Weather, current: Weather | null, overrides: Set<string>): Weather {
  const out: Weather = { ...fetched };
  if (current) {
    for (const [block, fields] of Object.entries(BLOCK_FIELDS)) {
      if (overrides.has(block)) for (const f of fields) (out as any)[f] = (current as any)[f] ?? null;
    }
  }
  return out;
}

export function LogSession({ backend, settings, logId, onSaved, onCancel, onError, onToast }: Props) {
  const [datetime, setDatetime] = useState(toLocalInputValue(new Date()));
  const [vessel, setVessel] = useState("");
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [heading, setHeading] = useState("");
  const [speed, setSpeed] = useState("");
  const [sails, setSails] = useState("");
  const [crew, setCrew] = useState("");
  const [positionText, setPositionText] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [positionSource, setPositionSource] = useState<"gps" | "last_known" | "manual">("manual");
  const [positionError, setPositionError] = useState("");
  const [observations, setObservations] = useState("");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherSource, setWeatherSource] = useState<WeatherSource>("open_meteo");
  const [weatherCapturedAt, setWeatherCapturedAt] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [savedPhotos, setSavedPhotos] = useState<Photo[]>([]);
  const [photoURLs, setPhotoURLs] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const prefillRef = useRef<Record<string, string>>({});
  const gpsTriedRef = useRef(false);

  const markOverride = useCallback((key: string) => {
    setOverrides((prev) => new Set(prev).add(key));
  }, []);

  const applyPosition = useCallback((text: string, source: "gps" | "last_known" | "manual") => {
    setPositionText(text);
    const r = parsePosition(text);
    if ("lat" in r) {
      setLat(r.lat); setLon(r.lon); setPositionError("");
      setPositionSource(source);
      if (source === "manual") markOverride("position");
    } else {
      setLat(null); setLon(null); setPositionError(r.error);
    }
  }, [markOverride]);

  const fetchWeatherFor = useCallback(async (la: number, lo: number, dtISO: string) => {
    setRefreshing(true);
    try {
      const w = await backend.fetchWeather(la, lo, dtISO);
      setWeather(w);
      setWeatherSource("open_meteo");
      setWeatherCapturedAt(nowNaiveISO());
      setOffline(false);
      return w;
    } catch (e) {
      if (e instanceof OfflineError) {
        setOffline(true);
        return null;
      }
      throw e;
    } finally {
      setRefreshing(false);
    }
  }, [backend]);

  // Initialisation
  useEffect(() => {
    void (async () => {
      if (logId) {
        const log = await backend.getLog(logId);
        if (!log) { onError("Log introuvable."); onCancel(); return; }
        setDatetime(toLocalInputValue(new Date(log.log_datetime.replace(" ", "T"))));
        setVessel(log.vessel); setDeparture(log.departure); setDestination(log.destination);
        setHeading(log.heading_deg != null ? String(log.heading_deg) : "");
        setSpeed(log.speed_kn != null ? String(log.speed_kn) : "");
        setSails(log.sails); setCrew(log.crew);
        if (log.lat != null && log.lon != null) {
          applyPosition(formatPosition(log.lat, log.lon, settings.position_format), log.position_source);
        }
        setObservations(log.observations);
        setWeather(log.weather ?? null);
        setWeatherSource(log.weather_source);
        setWeatherCapturedAt(log.weather_captured_at ?? null);
        setOverrides(new Set(log.overrides));
        setOffline(log.offline);
        prefillRef.current = {};
        const photos = await backend.listPhotos(log.id);
        setSavedPhotos(photos);
        const urls: Record<string, string | null> = {};
        for (const p of photos) urls[p.id] = await backend.photoURL(p);
        setPhotoURLs(urls);
      } else {
        // Pré-remplissage avec la dernière entrée
        const last = await backend.lastLog();
        const pre: Record<string, string> = {};
        if (last) {
          pre.vessel = last.vessel; pre.departure = last.departure; pre.destination = last.destination;
          pre.heading = last.heading_deg != null ? String(last.heading_deg) : "";
          pre.speed = last.speed_kn != null ? String(last.speed_kn) : "";
          pre.sails = last.sails; pre.crew = last.crew;
          prefillRef.current = pre;
          setVessel(pre.vessel); setDeparture(pre.departure); setDestination(pre.destination);
          setHeading(pre.heading); setSpeed(pre.speed); setSails(pre.sails); setCrew(pre.crew);
        }
        // Position : GPS d'abord, sinon dernière position connue, sinon saisie manuelle.
        let done = false;
        if (!gpsTriedRef.current && navigator.geolocation) {
          gpsTriedRef.current = true;
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 60000 }));
            applyPosition(formatPosition(pos.coords.latitude, pos.coords.longitude, settings.position_format), "gps");
            done = true;
          } catch { /* pas de GPS (desktop) -> repli */ }
        }
        if (!done) {
          const lastPos = await backend.lastPosition();
          if (lastPos) {
            applyPosition(formatPosition(lastPos.lat, lastPos.lon, settings.position_format), "last_known");
          }
        }
        setDatetime(toLocalInputValue(new Date()));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId]);

  // Météo de prévisualisation dès qu'une position est connue (sera recapturée à l'enregistrement).
  useEffect(() => {
    if (lat != null && lon != null && !logId) {
      void fetchWeatherFor(lat, lon, fromLocalInputValue(datetime)).catch(() => setOffline(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  const onDatetimeChange = (v: string) => {
    setDatetime(v);
    if (lat != null && lon != null) {
      const ok = window.confirm("La date/heure a changé — rafraîchir la météo pour cette date ?");
      if (ok) void fetchWeatherFor(lat, lon, fromLocalInputValue(v)).catch(() => setOffline(true));
    }
  };

  const onWeatherEdit = (block: string, w: Weather) => {
    setWeather(w);
    markOverride(block);
    if (offline || weatherSource !== "open_meteo") setWeatherSource("manual");
  };

  const tryGps = () => {
    if (!navigator.geolocation) { onError("GPS non disponible sur cette machine — saisie manuelle."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPosition(formatPosition(pos.coords.latitude, pos.coords.longitude, settings.position_format), "gps"),
      () => onError("Position GPS indisponible — saisie manuelle ou dernière position connue."),
      { timeout: 6000 },
    );
  };

  async function save() {
    setSaving(true);
    try {
      // Position
      if (positionText.trim()) {
        const r = parsePosition(positionText);
        if ("error" in r) { setPositionError(r.error); setSaving(false); return; }
        setLat(r.lat); setLon(r.lon);
      }
      // Règle 1 : recapture des champs automatiques à l'enregistrement (sauf blocs écrasés).
      let finalWeather: Weather | null = weather;
      let finalSource: WeatherSource = weatherSource;
      let finalOffline = offline;
      const dtISO = fromLocalInputValue(datetime);
      if (lat != null && lon != null) {
        try {
          const fetched = await backend.fetchWeather(lat, lon, dtISO);
          finalWeather = overrides.size ? mergeWeather(fetched, weather, overrides) : fetched;
          finalSource = "open_meteo";
          finalOffline = false;
          setWeather(finalWeather);
          setWeatherCapturedAt(nowNaiveISO());
        } catch (e) {
          if (e instanceof OfflineError) {
            finalOffline = true;
            finalSource = overrides.size ? "manual" : "offline";
            if (weather) {
              const kept: Weather = {};
              for (const [block, fields] of Object.entries(BLOCK_FIELDS)) {
                if (overrides.has(block)) for (const f of fields) (kept as any)[f] = (weather as any)[f] ?? null;
              }
              finalWeather = Object.keys(kept).length ? kept : null;
            } else finalWeather = null;
          } else throw e;
        }
      } else if (offline) {
        finalSource = overrides.size ? "manual" : "offline";
      }

      // Champs pré-remplis modifiés -> marqués « modifié »
      const ov = new Set(overrides);
      const pre = prefillRef.current;
      if (pre.vessel !== undefined && pre.vessel !== vessel) ov.add("vessel");
      if (pre.departure !== undefined && (pre.departure !== departure || pre.destination !== destination)) ov.add("route");
      if (pre.sails !== undefined && pre.sails !== sails) ov.add("sails");
      if (pre.crew !== undefined && pre.crew !== crew) ov.add("crew");
      if (pre.heading !== undefined && pre.heading !== heading) ov.add("heading");
      if (pre.speed !== undefined && pre.speed !== speed) ov.add("speed");

      const input: LogInput = {
        id: logId,
        log_datetime: dtISO,
        vessel, departure, destination,
        heading_deg: heading === "" ? null : parseFloat(heading),
        speed_kn: speed === "" ? null : parseFloat(speed),
        sails, crew,
        lat, lon,
        position_source: positionSource,
        observations,
        weather: finalWeather,
        weather_captured_at: finalSource === "open_meteo" ? nowNaiveISO() : (weatherCapturedAt ?? null),
        weather_source: finalSource,
        overrides: Array.from(ov),
        offline: finalOffline,
      };
      const saved = await backend.saveLog(input);
      for (const p of pendingPhotos) {
        await backend.addPhoto(saved.id, p.fileName, new Uint8Array(await p.blob.arrayBuffer()));
      }
      onToast(`Log enregistré — ${fmtTime(saved.log_datetime)}`);
      onSaved(saved);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const positionExample = settings.position_format === "dm" ? "48°39.25'N 4°29.17'W"
    : settings.position_format === "dms" ? "48°39'15\"N 4°29'10\"W"
    : "48.6542, -4.4861";

  const previewUrls = useMemo(() => {
    const m: Record<string, string | null> = { ...photoURLs };
    return m;
  }, [photoURLs]);

  return (
    <div className="content">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1>{logId ? "Modifier le log" : "Nouveau log"}</h1>
        <span className="small muted">{logId ? `entrée ${logId.slice(0, 8)}` : "session de saisie"}</span>
      </div>

      <div className="card">
        <WeatherPanel
          weather={weather}
          source={weatherSource}
          offline={offline}
          overrides={overrides}
          capturedAt={weatherCapturedAt}
          refreshing={refreshing}
          onEdit={onWeatherEdit}
          onRefresh={() => { if (lat != null && lon != null) void fetchWeatherFor(lat, lon, fromLocalInputValue(datetime)).catch(() => setOffline(true)); }}
        />
      </div>

      <div className="card">
        <h3>Identité du bord</h3>
        <div className="grid cols-2">
          <div className="field">
            <label htmlFor="f-date">Date et heure</label>
            <input id="f-date" type="datetime-local" value={datetime} onChange={(e) => onDatetimeChange(e.target.value)} />
            <span className="hint">Horloge système — modifiable ; la météo est recapturée à l'enregistrement.</span>
          </div>
          <div className="field">
            <label htmlFor="f-pos">Position (lat/lon)</label>
            <div className="row">
              <input id="f-pos" value={positionText} placeholder={positionExample}
                onChange={(e) => applyPosition(e.target.value, "manual")} />
              <button type="button" className="btn" onClick={tryGps} title="Utiliser le GPS">📍</button>
            </div>
            {positionError && <span className="error">{positionError}</span>}
            <span className="hint">
              {positionSource === "gps" ? "GPS" : positionSource === "last_known" ? "Dernière position connue" : "Saisie manuelle"}
              {lat != null && lon != null && ` — ${formatPosition(lat, lon, "decimal")}`}
              {overrides.has("position") && <span className="edited-note"> ✍️ modifié</span>}
            </span>
          </div>
          <div className="field"><label htmlFor="f-vessel">Navire</label><input id="f-vessel" value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="Kraken" /></div>
          <div className="field">
            <label>Route (départ → destination)</label>
            <div className="row">
              <input aria-label="Départ" value={departure} onChange={(e) => setDeparture(e.target.value)} placeholder="Brest" />
              <span className="muted">→</span>
              <input aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Douarnenez" />
            </div>
          </div>
          <div className="field"><label htmlFor="f-cap">Cap (°)</label><input id="f-cap" type="number" min={0} max={360} step="1" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="120" /></div>
          <div className="field"><label htmlFor="f-speed">Vitesse (nœuds)</label><input id="f-speed" type="number" min={0} step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="6.2" /></div>
          <div className="field"><label htmlFor="f-sails">Voiles</label><input id="f-sails" value={sails} onChange={(e) => setSails(e.target.value)} placeholder="GV 2 ris + génois" /></div>
          <div className="field"><label htmlFor="f-crew">Équipage</label><input id="f-crew" value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Alice, Bob" /></div>
        </div>
      </div>

      <div className="card">
        <h3>Observations</h3>
        <Dictation
          backend={backend}
          settings={settings}
          onTranscript={(t) => setObservations((prev) => (prev ? `${prev}\n${t}` : t))}
          onError={onError}
        />
        <div className="field" style={{ marginTop: "0.8rem" }}>
          <label htmlFor="f-obs">Texte des observations (dictée ou clavier)</label>
          <textarea id="f-obs" value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Vent tournant, mer croisée…" />
        </div>
      </div>

      <div className="card">
        <PhotoEditor
          backend={backend}
          logId={logId}
          savedPhotos={savedPhotos}
          pendingPhotos={pendingPhotos}
          photoURLs={previewUrls}
          onAddPending={(p) => setPendingPhotos((prev) => [...prev, p])}
          onRemovePending={(i) => setPendingPhotos((prev) => prev.filter((_, idx) => idx !== i))}
          onDeleteSaved={async (id) => {
            await backend.deletePhoto(id);
            setSavedPhotos((prev) => prev.filter((p) => p.id !== id));
            setPhotoURLs((prev) => { const m = { ...prev }; delete m[id]; return m; });
          }}
          onError={onError}
        />
      </div>

      <div className="actions-end">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Annuler</button>
        <button type="button" className="btn primary big" onClick={save} disabled={saving || !!positionError}>
          {saving ? "Enregistrement…" : "Enregistrer le log"}
        </button>
      </div>
    </div>
  );
}
