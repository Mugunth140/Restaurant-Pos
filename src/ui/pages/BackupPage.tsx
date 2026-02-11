import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../data/api";

const BackupPage: React.FC = () => {
  const [path, setPath] = useState("");
  const [interval, setInterval] = useState("1440");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await apiGet<{ backup_path: string; backup_interval_minutes: number }>(
        "/backup/settings"
      );
      setPath(data.backup_path);
      setInterval(String(data.backup_interval_minutes));
    };
    void load();
  }, []);

  const saveSettings = async () => {
    await apiPost("/backup/settings", {
      backup_path: path,
      backup_interval_minutes: Number(interval || "0")
    });
    setStatus("Settings saved");
  };

  const manualBackup = async () => {
    const res = await apiPost<{ file: string }>("/backup/run", { target: path });
    setStatus(`Backup created: ${res.file}`);
  };

  const restore = async () => {
    const res = await apiPost<{ ok: boolean }>("/backup/restore", { source: path });
    setStatus(res.ok ? "Restore complete. Please restart the app." : "Restore failed");
  };

  return (
    <div>
      <div className="page-title">Backup</div>
      <div className="card">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Backup folder or file path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <input
            className="input"
            style={{ width: 120 }}
            placeholder="Minutes"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
          <button className="button" onClick={saveSettings}>
            Save
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="button success" onClick={manualBackup}>
            Manual Backup
          </button>
          <button className="button danger" onClick={restore}>
            Restore
          </button>
        </div>
        {status && <div style={{ marginTop: 8 }}>{status}</div>}
      </div>
    </div>
  );
};

export default BackupPage;
