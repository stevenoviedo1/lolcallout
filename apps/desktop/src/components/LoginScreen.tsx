import { useEffect, useState } from "react";
import {
  loginWithPassword,
  registerWithPassword,
  type AuthUser,
} from "../lib/authApi";
import {
  getAppVersion,
  openUpdateDownload,
  resolveLatestDownloadUrl,
} from "../lib/updates";

type Mode = "signin" | "signup";

export function LoginScreen({
  onSignedIn,
}: {
  onSignedIn?: (user?: AuthUser | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");
  const [localVersion, setLocalVersion] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void getAppVersion().then((v) => setLocalVersion(v));
  }, []);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.includes("auth_token=")) {
        onSignedIn?.();
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [onSignedIn]);

  const openLatest = async () => {
    setUpdating(true);
    try {
      const url = await resolveLatestDownloadUrl();
      await openUpdateDownload(url);
    } finally {
      setUpdating(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("busy");
    setMessage("");

    if (mode === "signup") {
      if (password.length < 8) {
        setStatus("error");
        setMessage("Password must be at least 8 characters.");
        return;
      }
      if (password !== password2) {
        setStatus("error");
        setMessage("Passwords do not match.");
        return;
      }
      const res = await registerWithPassword(email, password);
      if (!res.ok || !res.user) {
        setStatus("error");
        setMessage(res.error || "Could not create account");
        return;
      }
      onSignedIn?.(res.user);
      return;
    }

    const res = await loginWithPassword(email, password);
    if (!res.ok || !res.user) {
      setStatus("error");
      setMessage(res.error || "Could not sign in");
      return;
    }
    onSignedIn?.(res.user);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setStatus("idle");
    setMessage("");
    setPassword("");
    setPassword2("");
  };

  return (
    <div className="login-screen">
      <div className="login-card login-card-premium">
        <div className="login-glow" aria-hidden />
        <div className="login-brand">
          <img src="/logo-circle.png" alt="LOLCallout" width={52} height={52} />
          <div>
            <p className="login-eyebrow">Live AI coach</p>
            <h1>LOLCallout</h1>
          </div>
        </div>

        <div className="login-update-box">
          <p>
            <strong>Need the newest build?</strong>
            {localVersion ? <span className="muted"> You’re on v{localVersion}.</span> : null}
          </p>
          <button
            type="button"
            className="chip chip-primary login-update-btn"
            disabled={updating}
            onClick={() => void openLatest()}
          >
            {updating ? "Opening…" : "Get latest update"}
          </button>
          <p className="muted login-update-hint">
            Installer from our official GitHub release.
          </p>
        </div>

        <div className="login-mode-tabs" role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            className={`chip ${mode === "signin" ? "chip-primary" : ""}`}
            aria-selected={mode === "signin"}
            onClick={() => switchMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            className={`chip ${mode === "signup" ? "chip-primary" : ""}`}
            aria-selected={mode === "signup"}
            onClick={() => switchMode("signup")}
          >
            Create account
          </button>
        </div>

        <p className="login-lead">
          {mode === "signin"
            ? "Sign in with your LOLCallout email and password."
            : "Create a secure account — email + password. Works on any PC you install on."}
        </p>

        <form onSubmit={(e) => void submit(e)} className="login-form">
          <label className="slider-label">
            Email
            <input
              className="voice-select login-input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "busy"}
            />
          </label>
          <label className="slider-label">
            Password
            <input
              className="voice-select login-input"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === "busy"}
            />
          </label>
          {mode === "signup" ? (
            <label className="slider-label">
              Confirm password
              <input
                className="voice-select login-input"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Repeat password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={status === "busy"}
              />
            </label>
          ) : null}
          <button className="send login-btn" type="submit" disabled={status === "busy"}>
            {status === "busy"
              ? mode === "signup"
                ? "Creating…"
                : "Signing in…"
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        {status === "error" && message ? <p className="err">{message}</p> : null}

        <div className="login-security">
          <p className="login-security-title">Secure account</p>
          <ul>
            <li>Password is hashed on our servers (scrypt). We never store plain text.</li>
            <li>Same login works on every PC you download LOLCallout to.</li>
            <li>Use the same email you use for Founders / Pro on lolcallout.com.</li>
          </ul>
        </div>

        <ul className="login-trust">
          <li>Live Client only · no injection</li>
          <li>One coach voice · second monitor ready</li>
          <li>Email + password · your account</li>
        </ul>

        <div className="login-plans">
          <p>
            <strong>Full coach</strong> · everything included · <strong>$100/mo</strong>
          </p>
          <p>
            <strong>Founders (first 100):</strong> <strong>$50/mo</strong> for 6 months from
            activate
          </p>
        </div>

        <p className="legal login-legal">Not endorsed by Riot Games · lolcallout.com</p>
      </div>
    </div>
  );
}
