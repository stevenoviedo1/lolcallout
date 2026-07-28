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
 * Auth gate: magic-link login required unless user chooses dev bypass
 * (local playtest without email).
 */
export function Root() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [devBypass, setDevBypass] = useState(
    () => localStorage.getItem("lc_dev_bypass") === "1"
  );

  const refresh = useCallback(async () => {
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
    // Re-check when hash changes (magic link redirect)
    const onHash = () => {
      if (window.location.hash.includes("auth_token=")) void refresh();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setDevBypass(false);
    localStorage.removeItem("lc_dev_bypass");
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

  if (!user && !devBypass) {
    return (
      <LoginScreen
        onDevBypass={() => {
          localStorage.setItem("lc_dev_bypass", "1");
          setDevBypass(true);
        }}
      />
    );
  }

  return (
    <>
      {(user || devBypass) && (
        <div className="auth-strip">
          {user ? (
            <>
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
            </>
          ) : (
            <>
              <span className="muted">Dev mode (no login)</span>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  localStorage.removeItem("lc_dev_bypass");
                  setDevBypass(false);
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      )}
      <App />
    </>
  );
}

// re-export setStoredToken for tests
export { setStoredToken };
