import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { LoginScreen } from "./components/LoginScreen";
import {
  AuthUser,
  consumeAuthHash,
  fetchMe,
  getStoredToken,
  logout,
  setStoredToken,
} from "./lib/authApi";

/**
 * Auth gate: magic-link login required (no dev bypass).
 */
export function Root() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    // Clear any old playtest bypass
    try {
      localStorage.removeItem("lc_dev_bypass");
    } catch {
      /* ignore */
    }
    consumeAuthHash();
    if (getStoredToken()) {
      const me = await fetchMe();
      setUser(me);
    } else {
      setUser(null);
    }
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

  if (booting) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ textAlign: "center" }}>
          <img src="/icon.jpg" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
          <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
            Starting LOLCallout…
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <>
      <div className="auth-strip">
        <span>
          {user.email}
          {user.plan !== "free" && (
            <span className="plan-pill">
              {" "}
              · {user.plan}
              {user.accessUntil
                ? ` until ${new Date(user.accessUntil).toLocaleDateString()}`
                : ""}
            </span>
          )}
          {user.plan === "free" && <span className="plan-pill free"> · free</span>}
        </span>
        <button type="button" className="chip" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </div>
      <App />
    </>
  );
}

// re-export setStoredToken for tests
export { setStoredToken };
