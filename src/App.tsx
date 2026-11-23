//! Application : barre supérieure, bannière hors ligne, vues (journal / session / réglages).
import { useEffect, useMemo, useState } from "react";
import { getBackend } from "./lib/backend";
import { Log, Settings, DEFAULT_SETTINGS } from "./lib/types";
import { fmtTime } from "./lib/format";
import { Journal } from "./views/Journal";
import { LogSession } from "./views/LogSession";
import { SettingsView } from "./views/SettingsView";
import { Toast } from "./components/bits";

type View = { name: "journal" } | { name: "session"; logId: string | null } | { name: "settings" };

export default function App() {
  const backend = useMemo(() => getBackend(), []);
  const [view, setView] = useState<View>({ name: "journal" });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void backend.getSettings().then(setSettings).catch(() => {});
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [backend]);

  useEffect(() => {
    void backend.getSettings().then(setSettings).catch(() => {});
  }, [backend, refreshKey]);

  const showToast = (msg: string, err = false) => { setToast(msg); setToastErr(err); };

  return (
    <div className="app" data-theme={settings.theme}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">⚓</span>
          <h1>Carnet de bord</h1>
          <span className="small muted">ordinateur de bord</span>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => setView({ name: "journal" })}>Journal</button>
        <button type="button" className="btn primary" onClick={() => setView({ name: "session", logId: null })}>＋ Enregistrer un log</button>
        <button type="button" className="btn" title="Réglages" onClick={() => setView({ name: "settings" })}>⚙️</button>
      </header>

      {offline && (
        <div className="content" style={{ paddingBottom: 0 }}>
          <div className="offline-banner" role="alert">
            Hors ligne — la météo Open-Meteo n'est pas disponible : champs météo en saisie manuelle (« MANUEL »).
            La dictée locale (Whisper embarqué) et l'enregistrement restent fonctionnels.
            <button type="button" className="btn" style={{ marginLeft: "0.8rem", minHeight: 36, padding: "0.2rem 0.7rem" }}
              onClick={async () => {
                const ids = await backend.retryPendingWeather().catch(() => [] as string[]);
                setOffline(!navigator.onLine);
                setRefreshKey((k) => k + 1);
                showToast(ids.length ? `Météo récupérée pour ${ids.length} log(s)` : "Toujours hors ligne");
              }}>Réessayer</button>
          </div>
        </div>
      )}

      {view.name === "journal" && (
        <Journal
          backend={backend}
          settings={settings}
          refreshKey={refreshKey}
          onNewLog={() => setView({ name: "session", logId: null })}
          onEditLog={(id) => setView({ name: "session", logId: id })}
          onToast={(m) => showToast(m)}
          onError={(m) => showToast(m, true)}
        />
      )}

      {view.name === "session" && (
        <LogSession
          backend={backend}
          settings={settings}
          logId={view.logId}
          onSaved={(log: Log) => { setRefreshKey((k) => k + 1); setView({ name: "journal" }); void log; }}
          onCancel={() => setView({ name: "journal" })}
          onError={(m) => showToast(m, true)}
          onToast={(m) => showToast(m)}
        />
      )}

      {view.name === "settings" && (
        <SettingsView
          backend={backend}
          onToast={(m) => showToast(m)}
          onError={(m) => showToast(m, true)}
          onDataChanged={() => { setRefreshKey((k) => k + 1); void backend.getSettings().then(setSettings); }}
        />
      )}

      {toast && <Toast message={toast} kind={toastErr ? "err" : undefined} onClose={() => setToast(null)} />}
      <footer className="content small muted" style={{ paddingTop: 0 }}>
        Données 100 % locales · météo : Open-Meteo · dernière synchro : {fmtTime(new Date().toISOString().slice(0, 19))}
      </footer>
    </div>
  );
}
