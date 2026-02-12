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

  const showStatus = (msg: string, type: "success" | "error" | "info" = "success") => {
    setStatus(msg); setStatusType(type);
  };

  const loadFiles = async (targetPath: string) => {
    try {
      const data = await apiGet<{ files: BackupFile[] }>("/backup/files?path=" + encodeURIComponent(targetPath));
      setFiles(data.files);
      setSelectedFile((prev) => {
        if (prev && data.files.some((f) => f.name === prev)) return prev;
        return data.files[0]?.name || "";
      });
    } catch { setFiles([]); }
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
    await apiPost("/backup/settings", { backup_path: path, backup_interval_minutes: Number(interval || "0") });
    showStatus("Settings saved");
    await loadFiles(path);
  };

  const manualBackup = async () => {
    try {
      const res = await apiPost<{ file: string }>("/backup/run", { target: path });
      const latest = res.file.split(/[/\\]/).pop() || "";
      showStatus("Backup created: " + latest);
      await loadFiles(path);
      if (latest) setSelectedFile(latest);
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Backup failed", "error");
    }
  };

  const restore = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    try {
      const source = selectedFile ? path + "/" + selectedFile : path;
      const res = await apiPost<{ ok: boolean }>("/backup/restore", { source });
      showStatus(res.ok ? "Restore complete. Please restart the app." : "Restore failed", res.ok ? "success" : "error");
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Restore failed", "error");
    }
  };

  return (
    <div>
      <div className="page-title">Backup & Restore</div>

      <div className="card">
        <div className="card-header">Settings</div>
        <div className="backup-settings">
          <input className="input" placeholder="Backup folder path" value={path} onChange={(e) => setPath(e.target.value)} />
          <input className="input" placeholder="Interval (min)" value={interval} onChange={(e) => setInterval(e.target.value)} style={{ textAlign: "right" }} />
          <button className="button primary" onClick={saveSettings}>Save</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Auto-backup every {interval} minutes to the folder above.
        </div>
      </div>

      <div className="card">
        <div className="card-header">Backup Files</div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="button success" onClick={manualBackup}>Create Backup Now</button>
          <button className="button" onClick={() => void loadFiles(path)}>Refresh</button>
        </div>
        {files.length > 0 ? (
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
                <tr key={f.name} style={{ cursor: "pointer" }} onClick={() => setSelectedFile(f.name)}>
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
        <div className="row">
          <button
            className={"button " + (confirming ? "danger" : "primary")}
            onClick={restore}
            disabled={!selectedFile && !path}
          >
            {confirming ? "Confirm Restore?" : "Restore Selected Backup"}
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
