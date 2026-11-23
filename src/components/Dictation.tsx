//! Dictée vocale : enregistrement (MediaRecorder), transcription (Whisper via Mistral
//! ou binaire local selon les réglages), texte inséré et éditable. L'audio n'est pas conservé.
import { useEffect, useRef, useState } from "react";
import { Backend } from "../lib/backend";
import { Settings } from "../lib/types";

interface Props {
  backend: Backend;
  settings: Settings;
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
}

type RecState = "idle" | "recording" | "transcribing";

export function Dictation({ backend, settings, onTranscript, onError }: Props) {
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function start() {
    if (!supported) {
      onError("Microphone non disponible dans ce contexte.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        void transcribe(new Blob(chunksRef.current, { type: mime }));
      };
      mediaRef.current = rec;
      rec.start();
      setState("recording");
      setSeconds(0);
      setStatus("Enregistrement…");
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      onError("Accès au microphone refusé.");
    }
  }

  function stop() {
    if (mediaRef.current && state === "recording") mediaRef.current.stop();
  }

  async function transcribe(blob: Blob) {
    setState("transcribing");
    setStatus("Transcription en cours…");
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const text = await backend.transcribeAudio(buf, blob.type);
      if (text.trim()) {
        onTranscript(text.trim());
        setStatus("Transcription insérée dans les observations.");
      } else {
        setStatus("Aucun texte reconnu.");
      }
    } catch (e) {
      setStatus("");
      onError(e instanceof Error ? e.message : "Transcription impossible (hors ligne ou clé API manquante). L'audio n'est pas conservé.");
    } finally {
      setState("idle");
      setSeconds(0);
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="dictation">
      <h3>Dictée vocale</h3>
      <div className="rec-row">
        <button
          type="button"
          className={`rec-btn ${state === "recording" ? "recording" : ""}`}
          onClick={state === "recording" ? stop : start}
          disabled={state === "transcribing" || !supported}
          aria-label={state === "recording" ? "Arrêter l'enregistrement" : "Démarrer la dictée"}
          title={settings.transcription_mode === "none" ? "Transcription désactivée dans les réglages" : "Dictée"}
        >
          {state === "recording" ? "■" : "●"}
        </button>
        {state === "recording" && (
          <>
            <span className="rec-timer">{mm}:{ss}</span>
            <span className="wave" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ animationDelay: `${i * 0.09}s` }} />)}</span>
          </>
        )}
        {state === "transcribing" && <span className="rec-status">⏳ Transcription…</span>}
        {state === "idle" && status && <span className="rec-status">{status}</span>}
        {state === "idle" && !status && <span className="rec-status muted">Dictez vos observations — le texte est inséré ci-dessous, l'audio n'est pas conservé.</span>}
      </div>
      <p className="small muted" style={{ margin: "0.5rem 0 0" }}>
        Langue : {settings.dictation_language} · mode : {settings.transcription_mode === "mistral" ? "Mistral (API)" : settings.transcription_mode === "local" ? "Whisper local" : "désactivé"}
      </p>
    </div>
  );
}
