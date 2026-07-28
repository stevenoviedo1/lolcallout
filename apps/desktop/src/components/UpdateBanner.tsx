import { useEffect, useState } from "react";
import {
  checkForUpdate,
  getAppVersion,
  openUpdateDownload,
  skipVersion,
  type UpdateInfo,
} from "../lib/updates";

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [local, setLocal] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await getAppVersion();
      if (cancelled) return;
      setLocal(v);
      // Delay slightly so login/boot isn't blocked
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled) return;
      const info = await checkForUpdate(v);
      if (!cancelled && info) setUpdate(info);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  return (
    <div className="update-banner" role="dialog" aria-label="Update available">
      <div className="update-banner-inner">
        <div className="update-banner-copy">
          <strong>Update available</strong>
          <span>
            v{local || "?"} → <span className="update-ver">v{update.version}</span>
            {update.name ? ` · ${update.name}` : ""}
          </span>
          {update.notes ? (
            <p className="update-notes">{update.notes.split("\n").slice(0, 3).join(" ")}</p>
          ) : null}
        </div>
        <div className="update-banner-actions">
          <button
            type="button"
            className="chip chip-primary"
            onClick={() => void openUpdateDownload(update.downloadUrl)}
          >
            Download update
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              skipVersion(update.version);
              setUpdate(null);
            }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
