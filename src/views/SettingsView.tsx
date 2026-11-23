//! Réglages : stardate, transcription (Mistral / Whisper local), format de position,
//! export / import JSON, file d'attente météo hors ligne.
import { useEffect, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Backend, isTauri } from "../lib/backend";
import { DEFAULT_SETTINGS, Settings } from "../lib/types";

interface Props {
  backend: Backend;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  onDataChanged: () => void;
}

export function SettingsView({ backend, onToast, onError, onDataChanged }: Props) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void backend.getSettings().then(setS).catch(() => {});
  }, [backend]);

  async function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
    try { await backend.setSetting(key, String(value)); } catch (e) { onError(e instanceof Error ? e.message : "Réglage non enregistré"); }
  }

  async function exportJson() {
    try {
      const json = await backend.exportJSON();
      if (isTauri) {
        const path = await save({ defaultPath: `carnet-de-bord-export-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
        if (path) {
          await writeTextFile(path, json);
          onToast("Export JSON enregistré");
        }
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `carnet-de-bord-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        onToast("Export JSON téléchargé");
      }
    } catch (e) { onError(e instanceof Error ? e.message : "Export impossible"); }
  }

  async function importJson() {
    try {
      let json: string | null = null;
      if (isTauri) {
        const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
        if (!path || Array.isArray(path)) return;
        json = await readTextFile(path);
      } else {
        json = await new Promise<string | null>((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "application/json,.json";
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return resolve(null);
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsText(f);
          };
          input.click();
        });
      }
      if (!json) return;
      if (!window.confirm("L'import REMPLACE toutes les données actuelles par celles du fichier. Continuer ?")) return;
      const n = await backend.importJSON(json);
      onToast(`Import réussi — ${n} log(s) restauré(s)`);
      onDataChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Import impossible"); }
  }

  async function retryWeather() {
    setRetrying(true);
    try {
      const ids = await backend.retryPendingWeather();
      onToast(ids.length ? `Météo récupérée pour ${ids.length} log(s)` : "Rien à récupérer (toujours hors ligne ?)");
      onDataChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Reprise impossible"); }
    finally { setRetrying(false); }
  }

  return (
    <div className="content">
      <h1 style={{ marginBottom: "1.2rem" }}>Réglages</h1>

      <div className="card">
        <h3>Affichage</h3>
        <div className="settings-grid">
          <label className="toggle">
            <input type="checkbox" checked={s.stardate === "1"} onChange={(e) => void update("stardate", e.target.checked ? "1" : "0")} />
            Numérotation des logs « LOG AAAAMMJJ HHMM »
          </label>
          <div className="field">
            <label htmlFor="s-theme">Thème</label>
            <select id="s-theme" value={s.theme} onChange={(e) => void update("theme", e.target.value)}>
              <option value="dark">Nuit marine (par défaut)</option>
              <option value="dark" disabled>Clair — phase 2</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-posfmt">Format de saisie de position</label>
            <select id="s-posfmt" value={s.position_format} onChange={(e) => void update("position_format", e.target.value)}>
              <option value="decimal">Décimal — 48.6542, -4.4861</option>
              <option value="dm">Degrés-minutes — 48°39.25'N 4°29.17'W</option>
              <option value="dms">Degrés-minutes-secondes — 48°39'15"N</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Dictée vocale (transcription)</h3>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="s-tmode">Mode de transcription</label>
            <select id="s-tmode" value={s.transcription_mode} onChange={(e) => void update("transcription_mode", e.target.value)}>
              <option value="mistral">Mistral API (Whisper, envoi de l'audio à l'API)</option>
              <option value="local">Whisper local (whisper.cpp, 100 % hors ligne)</option>
              <option value="none">Désactivé</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-lang">Langue de dictée</label>
            <input id="s-lang" value={s.dictation_language} onChange={(e) => void update("dictation_language", e.target.value)} placeholder="fr" />
          </div>
          {s.transcription_mode === "mistral" && (
            <>
              <div className="field">
                <label htmlFor="s-key">Clé API Mistral</label>
                <input id="s-key" type="password" value={s.mistral_api_key} onChange={(e) => void update("mistral_api_key", e.target.value)} placeholder="…" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="s-model">Modèle</label>
                <input id="s-model" value={s.mistral_model} onChange={(e) => void update("mistral_model", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="s-base">URL de base API</label>
                <input id="s-base" value={s.mistral_base_url} onChange={(e) => void update("mistral_base_url", e.target.value)} />
              </div>
            </>
          )}
          {s.transcription_mode === "local" && (
            <>
              <div className="field">
                <label htmlFor="s-bin">Binaire whisper-cli</label>
                <input id="s-bin" value={s.whisper_binary} onChange={(e) => void update("whisper_binary", e.target.value)} placeholder="whisper-cli" />
              </div>
              <div className="field">
                <label htmlFor="s-ggml">Modèle ggml (chemin)</label>
                <input id="s-ggml" value={s.whisper_model_path} onChange={(e) => void update("whisper_model_path", e.target.value)} placeholder="/chemin/ggml-base.bin" />
              </div>
            </>
          )}
        </div>
        <p className="small muted">L'audio n'est jamais conservé : seul le texte transcrit est inséré dans les observations.</p>
      </div>

      <div className="card">
        <h3>Données</h3>
        <p className="small muted">
          Stockage local ({backend.kind === "tauri" ? "SQLite embarquée, un fichier sur disque" : "localStorage — mode développement navigateur"}).
          Aucune donnée ne quitte la machine, hormis les appels Open-Meteo et l'API de transcription si activée.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void exportJson()}>⬇ Exporter tout en JSON</button>
          <button type="button" className="btn" onClick={() => void importJson()}>⬆ Importer un JSON</button>
          <button type="button" className="btn" onClick={() => void retryWeather()} disabled={retrying}>
            {retrying ? "…" : "↻ Récupérer la météo en attente (file hors ligne)"}
          </button>
        </div>
      </div>
    </div>
  );
}
