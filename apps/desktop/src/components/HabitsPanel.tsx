import { useEffect, useState } from "react";
import type { HabitProfile } from "@riftcoach/shared";
import { fetchHabits, resetHabits } from "../lib/api";

/** "My habits" — cross-game habit memory stored only on this PC by the agent. */
export function HabitsPanel() {
  const [profile, setProfile] = useState<HabitProfile | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchHabits().then((r) => {
      if (r) {
        setProfile(r.profile);
        setPath(r.path);
      }
    });
  }, []);

  const onReset = async () => {
    if (!window.confirm("Reset your habit memory on this PC?")) return;
    setBusy(true);
    const r = await resetHabits();
    if (r) setProfile(r.profile);
    setBusy(false);
  };

  const r = profile?.rolling;
  return (
    <div className="summary-card habits-panel">
      <div className="meta">My habits · stored only on this PC</div>
      {!profile || !profile.games.length ? (
        <p className="muted">No games recorded yet. Finish a live match and your habits show up here.</p>
      ) : (
        <>
          <p className="muted">
            {r!.games} games · {r!.avgDeaths} deaths/game · {r!.avgCsPerMin} CS/min · {r!.avgControlWards} control
            wards/game · {r!.avgGoldAtDeath}g avg at death
          </p>
          {profile.top.length ? (
            <ol>
              {profile.top.map((h) => (
                <li key={h.id}>
                  <strong>{h.line}</strong> — {h.fix}.
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No repeat habits in your last games. Nice.</p>
          )}
        </>
      )}
      <button type="button" className="chip" disabled={busy} onClick={() => void onReset()}>
        Reset habits
      </button>
      {path && <p className="muted" style={{ fontSize: "0.8em" }}>{path}</p>}
    </div>
  );
}
