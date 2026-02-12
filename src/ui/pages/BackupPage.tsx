import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../data/api";

type BackupFile = { name: string; path: string; modified_at: string; size_bytes: number };

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const BackupPage: React.FC = () => {
  const [path, setPath] = useState("");
  const [interval, setInterval] = useState("1440");
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | "info">("success");
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const showStatus = (msg: string, type: "success" | "error" | "info" = "success") => {
    setStatus(msg); setStatusType(type);
  };

  const loadFiles = async (targetPath: string) => {
    setLoadingFiles(true);
    try {
      const data = await apiGet<{ files: BackupFile[] }>("/backup/files?path=" + encodeURIComponent(targetPath));
      setFiles(data.files);
      setSelectedFile((prev) => {
        if (prev && data.files.some((f) => f.name === prev)) return prev;
        return data.files[0]?.name || "";
      });
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const data = await apiGet<{ backup_path: string; backup_interval_minutes: number }>("/backup/settings");
      setPath(data.backup_path);
      setInterval(String(data.backup_interval_minutes));
      await loadFiles(data.backup_path);
    };
    void init();
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await apiPost("/backup/settings", { backup_path: path, backup_interval_minutes: Number(interval || "0") });
      showStatus("Backup settings saved", "success");
      await loadFiles(path);
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Failed to save settings", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const manualBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await apiPost<{ file: string }>("/backup/run", { target: path });
      const latest = res.file.split(/[/\\]/).pop() || "";
      showStatus("Backup created: " + latest);
      await loadFiles(path);
      if (latest) setSelectedFile(latest);
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Backup failed", "error");
    } finally {
      setCreatingBackup(false);
    }
  };

  const restore = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setRestoring(true);
    try {
      const source = selectedFile ? path + "/" + selectedFile : path;
      const res = await apiPost<{ ok: boolean }>("/backup/restore", { source });
      showStatus(res.ok ? "Restore complete. Please restart the app." : "Restore failed", res.ok ? "success" : "error");
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Restore failed", "error");
    } finally {
      setRestoring(false);
    }
  };

  const selected = files.find((f) => f.name === selectedFile) || null;

  return (
    <div>
      <div className="page-title">Backup & Restore</div>

      <div className="backup-grid">
        <div className="card">
          <div className="card-header">Backup Settings</div>
          <div className="backup-settings">
            <input className="input" placeholder="Backup folder path" value={path} onChange={(e) => setPath(e.target.value)} />
            <input className="input" placeholder="Interval (min)" value={interval} onChange={(e) => setInterval(e.target.value)} style={{ textAlign: "right" }} />
            <button className="button primary" onClick={saveSettings} disabled={savingSettings || !path.trim()}>
              {savingSettings ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="backup-hint">
            Auto-backup runs every <strong>{interval}</strong> minute(s).
          </div>
        </div>

        <div className="card">
          <div className="card-header">Quick Actions</div>
          <div className="backup-actions">
            <button className="button success" onClick={manualBackup} disabled={creatingBackup || !path.trim()}>
              {creatingBackup ? "Creating backup..." : "Create Backup Now"}
            </button>
            <button className="button" onClick={() => void loadFiles(path)} disabled={loadingFiles || !path.trim()}>
              {loadingFiles ? "Refreshing..." : "Refresh Files"}
            </button>
          </div>
          <div className="backup-meta">
            <div><span className="muted">Folder</span><strong>{path || "Not set"}</strong></div>
            <div><span className="muted">Files</span><strong>{files.length}</strong></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Backup Files</div>
        {selected && (
          <div className="backup-selected">
            <span className="muted">Selected:</span>
            <strong>{selected.name}</strong>
            <span className="muted">{fmtSize(selected.size_bytes)} • {fmtDate(selected.modified_at)}</span>
          </div>
        )}
        {loadingFiles ? (
          <div className="empty-state">Loading backup files...</div>
        ) : files.length > 0 ? (
          <table className="table backup-files-table">
            <thead>
              <tr>
                <th></th>
                <th>File</th>
                <th className="text-right">Size</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr
                  key={f.name}
                  className={selectedFile === f.name ? "selected" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedFile(f.name)}
                >
                  <td className="text-center">
                    <input type="radio" name="backup-file" checked={selectedFile === f.name} onChange={() => setSelectedFile(f.name)} />
                  </td>
                  <td><strong>{f.name}</strong></td>
                  <td className="text-right muted">{fmtSize(f.size_bytes)}</td>
                  <td className="muted">{fmtDate(f.modified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No backup files found in this folder</div>
        )}
      </div>

      <div className="card">
        <div className="card-header">Restore</div>
        <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
          Select a backup file above, then click Restore. The current database will be replaced.
        </p>
        <div className="row backup-restore-row">
          <button
            className={"button " + (confirming ? "danger" : "primary")}
            onClick={restore}
            disabled={restoring || !selectedFile}
          >
            {restoring ? "Restoring..." : confirming ? "Confirm Restore?" : "Restore Selected Backup"}
          </button>
          {confirming && (
            <button className="button" onClick={() => setConfirming(false)}>Cancel</button>
          )}
        </div>
        {status && <div className={"toast toast-" + statusType}>{status}</div>}
      </div>
    </div>
  );
};

export default BackupPage;
