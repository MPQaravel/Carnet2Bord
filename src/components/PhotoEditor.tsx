//! Photos d'une entrée : glisser-déposer ou import, compression locale < 300 Ko,
//! suppression individuelle. Tant que le log n'est pas enregistré, les photos restent
//! en attente côté client (transférées à l'enregistrement).
import { useRef, useState } from "react";
import { Backend } from "../lib/backend";
import { compressImage } from "../lib/photos";
import { Photo } from "../lib/types";
import { fmtBytes } from "../lib/format";

export interface PendingPhoto {
  fileName: string;
  blob: Blob;
}

interface Props {
  backend: Backend;
  logId: string | null;
  savedPhotos: Photo[];
  pendingPhotos: PendingPhoto[];
  photoURLs: Record<string, string | null>;
  onAddPending: (p: PendingPhoto) => void;
  onRemovePending: (index: number) => void;
  onDeleteSaved: (id: string) => void;
  onError: (msg: string) => void;
}

export function PhotoEditor({ backend, logId, savedPhotos, pendingPhotos, photoURLs, onAddPending, onRemovePending, onDeleteSaved, onError }: Props) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | File[]) {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const blob = await compressImage(f);
        const pending: PendingPhoto = { fileName: f.name.replace(/\.[^.]+$/, "") + ".jpg", blob };
        if (logId) {
          await backend.addPhoto(logId, pending.fileName, new Uint8Array(await blob.arrayBuffer()));
        } else {
          onAddPending(pending);
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import de photo impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Photos</h3>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      >
        {busy ? "Compression en cours…" : "Glissez-déposez des photos ici, ou cliquez pour importer (compressées localement, < 300 Ko)."}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>
      <div className="photo-grid">
        {savedPhotos.map((p) => (
          <div className="photo-item" key={p.id}>
            {photoURLs[p.id] ? <img src={photoURLs[p.id]!} alt={p.file_name} /> : <div style={{ width: 96, height: 96, borderRadius: 10, border: "1px solid var(--border)" }} />}
            <button type="button" className="del" title="Supprimer la photo" onClick={() => onDeleteSaved(p.id)}>✕</button>
            <div className="size">{fmtBytes(p.size_bytes)}</div>
          </div>
        ))}
        {pendingPhotos.map((p, i) => (
          <div className="photo-item" key={`pending-${i}`}>
            <img src={URL.createObjectURL(p.blob)} alt={p.fileName} />
            <button type="button" className="del" title="Retirer" onClick={() => onRemovePending(i)}>✕</button>
            <div className="size">{fmtBytes(p.blob.size)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
