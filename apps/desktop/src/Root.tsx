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
  MEMBERSHIP_URL,
  openInBrowser,
  startMembershipCheckout,
  setStoredToken,
} from "./lib/authApi";
import { isSetupComplete } from "./lib/setupPrefs";
import { useAppStore } from "./stores/useAppStore";

/**
 * Auth gate → first-run setup → main app.
 */
export function Root() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootHint, setBootHint] = useState("Starting LOLCallout…");
  const [needsSetup, setNeedsSetup] = useState(() => !isSetupComplete());

  const setMembership = useAppStore((s) => s.setMembership);

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
      setMembership({ active: false, email: null });
      setBooting(false);
      return;
    }
    setBootHint("Checking sign-in…");
    const me = await fetchMe();
    if (me) {
      setUser(me);
      setMembership({ active: Boolean(me.hasAccess), email: me.email });
    } else if (!getStoredToken()) {
      setUser(null);
      setMembership({ active: false, email: null });
    }
    setBooting(false);
  }, [setMembership]);

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
    setMembership({ active: false, email: null });
  };

  const handleSignedIn = (u?: AuthUser | null) => {
    if (u) {
      setUser(u);
      setMembership({ active: Boolean(u.hasAccess), email: u.email });
      setBooting(false);
      return;
    }
    void refresh();
  };

  const upgrade = async () => {
    if (!user?.email) {
      await openInBrowser(MEMBERSHIP_URL);
      return;
    }
    const res = await startMembershipCheckout(user.email, true);
    if (!res.ok) {
      await openInBrowser(MEMBERSHIP_URL);
    }
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

  const paid = Boolean(user.hasAccess);

  return (
    <>
      <UpdateBanner />
      <div className="auth-strip">
        <span className="auth-user">
          <span className="auth-dot" aria-hidden />
          {user.email}
          {paid && (
            <span className="plan-pill">
              {user.plan}
              {user.accessUntil
                ? ` · ${new Date(user.accessUntil).toLocaleDateString()}`
                : ""}
            </span>
          )}
          {!paid && <span className="plan-pill free">free · no AI</span>}
        </span>
        {!paid && (
          <button type="button" className="chip chip-primary" onClick={() => void upgrade()}>
            Unlock AI coach
          </button>
        )}
        {paid && (
          <button
            type="button"
            className="chip chip-ghost"
            title="Refresh membership after purchase"
            onClick={() => void refresh()}
          >
            Refresh plan
          </button>
        )}
        <button type="button" className="chip chip-ghost" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </div>
      {!paid && (
        <div className="membership-banner" role="status">
          <strong>Signed in free.</strong> Live board + local tips work.{" "}
          <strong>AI coach, cloud voice, and post-game AI need membership</strong> (same email
          as checkout on lolcallout.com).
          <button type="button" className="chip chip-primary" onClick={() => void upgrade()}>
            Get Founders
          </button>
          <button type="button" className="chip" onClick={() => void refresh()}>
            I already paid — refresh
          </button>
        </div>
      )}
      <App membershipActive={paid} onUpgrade={() => void upgrade()} />
    </>
  );
}

export { setStoredToken };
