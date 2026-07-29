import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { LoginScreen } from "./components/LoginScreen";
import { SetupWizard } from "./components/SetupWizard";
import { UpdateBanner } from "./components/UpdateBanner";
import {
  AuthUser,
  consumeAuthHash,
  fetchMe,
  getStoredToken,
  logout,
  setStoredToken,
} from "./lib/authApi";
import { isSetupComplete } from "./lib/setupPrefs";

/**
 * Auth gate → first-run setup → main app.
 */
export function Root() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootHint, setBootHint] = useState("Starting LOLCallout…");
  const [needsSetup, setNeedsSetup] = useState(() => !isSetupComplete());

  const refresh = useCallback(async () => {
    try {
      localStorage.removeItem("lc_dev_bypass");
    } catch {
      /* ignore */
    }
    consumeAuthHash();
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setBooting(false);
      return;
    }
    setBootHint("Checking sign-in…");
    const me = await fetchMe();
    if (me) setUser(me);
    else if (!getStoredToken()) setUser(null);
    setBooting(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => {
      if (window.location.hash.includes("auth_token=")) void refresh();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  const handleSignedIn = (u?: AuthUser | null) => {
    if (u) {
      setUser(u);
      setBooting(false);
      return;
    }
    void refresh();
  };

  if (booting) {
    return (
      <div className="login-screen">
        <div className="login-card login-card-premium boot-card">
          <div className="login-glow" aria-hidden />
          <img src="/logo-circle.png" alt="LOLCallout" width={44} height={44} />
          <p className="boot-title">LOLCallout</p>
          <p className="muted boot-sub">{bootHint}</p>
          <div className="boot-bar" aria-hidden>
            <i />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <UpdateBanner />
        <LoginScreen onSignedIn={handleSignedIn} />
      </>
    );
  }

  // First download / new PC: guided setup before the main HUD
  if (needsSetup) {
    return (
      <>
        <UpdateBanner />
        <SetupWizard onDone={() => setNeedsSetup(false)} />
      </>
    );
  }

  return (
    <>
      <UpdateBanner />
      <div className="auth-strip">
        <span className="auth-user">
          <span className="auth-dot" aria-hidden />
          {user.email}
          {user.plan !== "free" && (
            <span className="plan-pill">
              {user.plan}
              {user.accessUntil
                ? ` · ${new Date(user.accessUntil).toLocaleDateString()}`
                : ""}
            </span>
          )}
          {user.plan === "free" && <span className="plan-pill free">free</span>}
        </span>
        <button type="button" className="chip chip-ghost" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </div>
      <App />
    </>
  );
}

export { setStoredToken };
