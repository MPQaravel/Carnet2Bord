//! Petits composants partagés : tags, icônes météo SVG, toast, divers.
import { useEffect, useState } from "react";
import { wmoInfo } from "../lib/format";

export function Tag({ kind, children }: { kind: "auto" | "manual" | "edited"; children?: string }) {
  const label = children ?? (kind === "auto" ? "AUTO" : kind === "manual" ? "MANUEL" : "✍️ modifié");
  return <span className={`tag ${kind}`}>{label}</span>;
}

export function WmoIcon({ code, size = 15 }: { code?: number | null; size?: number }) {
  const icon = code != null ? wmoInfo(code).icon : "overcast";
  const paths: Record<string, JSX.Element> = {
    clear: <><circle cx="12" cy="12" r="4.2" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="12" y1="2.5" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21.5" /><line x1="2.5" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21.5" y2="12" /><line x1="5.3" y1="5.3" x2="7" y2="7" /><line x1="17" y1="17" x2="18.7" y2="18.7" /><line x1="18.7" y1="5.3" x2="17" y2="7" /><line x1="7" y1="17" x2="5.3" y2="18.7" /></g></>,
    partly: <><circle cx="9" cy="9" r="3.4" fill="currentColor" opacity="0.9" /><path d="M7 18.5h9.2a3.4 3.4 0 0 0 .6-6.75A5 5 0 0 0 7 13.4a2.9 2.9 0 0 0 0 5.1z" fill="currentColor" opacity="0.75" /></>,
    overcast: <path d="M7 18.5h9.2a3.4 3.4 0 0 0 .6-6.75A5 5 0 0 0 7 13.4a2.9 2.9 0 0 0 0 5.1z" fill="currentColor" />,
    fog: <><path d="M7 15.5h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 7 11.1a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><line x1="5" y1="19" x2="19" y2="19" /><line x1="7" y1="21.5" x2="17" y2="21.5" /></g></>,
    drizzle: <><path d="M7 13h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 7 8.6a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="8.5" y1="16" x2="7.8" y2="18" /><line x1="12.5" y1="16" x2="11.8" y2="18" /><line x1="16" y1="16" x2="15.3" y2="18" /></g></>,
    rain: <><path d="M7 12.5h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 7 8.1a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><line x1="8.5" y1="15.5" x2="7.3" y2="19" /><line x1="12.5" y1="15.5" x2="11.3" y2="19" /><line x1="16" y1="15.5" x2="14.8" y2="19" /></g></>,
    snow: <><path d="M7 12h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 7 7.6a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><g fill="currentColor"><circle cx="8.5" cy="16.5" r="1.15" /><circle cx="12.5" cy="18" r="1.15" /><circle cx="16" cy="16.5" r="1.15" /></g></>,
    shower: <><path d="M6.5 11h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 6.5 6.6a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><line x1="8" y1="14.5" x2="6.8" y2="18.5" /><line x1="12.5" y1="14.5" x2="11.3" y2="18.5" /><line x1="17" y1="14.5" x2="15.8" y2="18.5" /><line x1="9.8" y1="19.5" x2="9" y2="21.5" /><line x1="14.5" y1="19.5" x2="13.7" y2="21.5" /></g></>,
    storm: <><path d="M7 13h9.2a3 3 0 0 0 .6-5.95A4.6 4.6 0 0 0 7 8.6a2.6 2.6 0 0 0 0 4.4z" fill="currentColor" opacity="0.8" /><path d="M12.8 13.5 9.6 18h2.6l-1.4 4 4-5.4h-2.7l1.5-3.1z" fill="#d9a441" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths[icon] ?? paths.overcast}
    </svg>
  );
}

export function WindIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2" /><path d="M3 12h13.5a2.5 2.5 0 1 1-2.4 3.2" /><path d="M3 16h7" />
    </svg>
  );
}
export function SeaIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M2 15c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0" /><path d="M2 19c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0" opacity="0.55" />
    </svg>
  );
}
export function AirIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3v3" /><circle cx="12" cy="12" r="6.5" /><path d="M12 21v-2.5" /><path d="M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M3 12h2.5M18.5 12H21M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </svg>
  );
}

export function Toast({ message, kind, onClose }: { message: string; kind?: "err"; onClose: () => void }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onClose(); }, 3200);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!visible) return null;
  return <div className={`toast ${kind ?? ""}`} role="status" onClick={() => { setVisible(false); onClose(); }}>{message}</div>;
}
