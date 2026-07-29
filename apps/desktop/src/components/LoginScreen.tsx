import { useEffect, useMemo, useState } from "react";
import {
  getRememberMe,
  getRememberedEmail,
  isStrongPassword,
  loginWithPassword,
  openInBrowser,
  passwordStrength,
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
  const remembered = getRememberedEmail();
  const [mode, setMode] = useState<Mode>(() => (remembered ? "signin" : "signup"));
  const [email, setEmail] = useState(() => remembered);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => getRememberMe() || Boolean(remembered)
  );
  const [status, setStatus] = useState<"idle" | "busy" | "error" | "ok">("idle");
  const [message, setMessage] = useState("");
  const [localVersion, setLocalVersion] = useState("");
  const [updating, setUpdating] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

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

  const switchMode = (next: Mode) => {
    setMode(next);
    setStatus("idle");
    setMessage("");
    setPassword("");
    setPassword2("");
    setShowPassword(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("busy");
    setMessage("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setStatus("error");
      setMessage("Enter a valid email address.");
      return;
    }

    if (mode === "signup") {
      if (!isStrongPassword(password)) {
        setStatus("error");
        setMessage(
          "Password must be at least 8 characters and include a letter and a number."
        );
        return;
      }
      if (password !== password2) {
        setStatus("error");
        setMessage("Passwords do not match.");
        return;
      }
      const res = await registerWithPassword(trimmedEmail, password, rememberMe);
      if (!res.ok || !res.user) {
        setStatus("error");
        if (res.code === "ACCOUNT_EXISTS") {
          setMessage(res.error || "Account already exists.");
          // Soft-steer to sign-in
          setMode("signin");
        } else {
          setMessage(res.error || "Could not create account");
        }
        return;
      }
      setStatus("ok");
      onSignedIn?.(res.user);
      return;
    }

    // Sign in
    if (password.length < 8) {
      setStatus("error");
      setMessage("Enter your password (at least 8 characters).");
      return;
    }

    const res = await loginWithPassword(trimmedEmail, password, rememberMe);
    if (!res.ok || !res.user) {
      setStatus("error");
      if (res.code === "NO_PASSWORD") {
        setMessage(
          res.error ||
            "No password on this account yet. Create account with the same email to set one."
        );
        setMode("signup");
        setPassword2("");
      } else {
        setMessage(res.error || "Could not sign in");
      }
      return;
    }
    setStatus("ok");
    onSignedIn?.(res.user);
  };

  return (
    <div className="login-screen">
      <div className="login-card login-card-premium">
        <div className="login-glow" aria-hidden />
        <div className="login-brand">
          <img src="/logo-circle.png" alt="LOLCallout" width={52} height={52} />
          <div>
            <p className="login-eyebrow">Live AI League coach</p>
            <h1>LOLCallout</h1>
          </div>
        </div>

        <p className="login-lead login-lead-tight">
          Secure account for this app. Same email on any PC you install — no website login
          required after setup.
        </p>

        <div className="login-howto" aria-label="Getting started">
          <p className="login-howto-title">First time here?</p>
          <ol>
            <li>
              <strong>Create account</strong> with your email + a password
            </li>
            <li>
              Paid / Founders? Use the <strong>same email</strong> you used on lolcallout.com
            </li>
            <li>
              Check <strong>Remember me</strong> so you stay signed in on this PC
            </li>
          </ol>
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
            ? "Welcome back — enter the email and password for this app."
            : "Create your secure login. If you already subscribed, use that email so Pro/Founders stays linked."}
        </p>

        <form onSubmit={(e) => void submit(e)} className="login-form" autoComplete="on">
          <label className="slider-label">
            Email
            <input
              className="voice-select login-input"
              type="email"
              required
              autoComplete="username email"
              inputMode="email"
              spellCheck={false}
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "busy"}
              autoFocus={!remembered}
            />
          </label>

          <label className="slider-label">
            Password
            <div className="login-password-row">
              <input
                className="voice-select login-input"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={
                  mode === "signup" ? "8+ chars, letter + number" : "Your password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === "busy"}
              />
              <button
                type="button"
                className="login-show-pw"
                onClick={() => setShowPassword((v) => !v)}
                disabled={status === "busy"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {mode === "signup" && password ? (
            <div
              className={`login-strength login-strength-${strength.score}`}
              aria-live="polite"
            >
              <div className="login-strength-bar" aria-hidden>
                <i style={{ width: `${(strength.score / 4) * 100}%` }} />
              </div>
              <span>
                Strength: <strong>{strength.label || "…"}</strong>
                {!isStrongPassword(password) ? (
                  <span className="muted"> — need letter + number, 8+ chars</span>
                ) : null}
              </span>
            </div>
          ) : null}

          {mode === "signup" ? (
            <label className="slider-label">
              Confirm password
              <input
                className="voice-select login-input"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Repeat password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={status === "busy"}
              />
            </label>
          ) : null}

          <label className="login-remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={status === "busy"}
            />
            <span>
              <strong>Remember me</strong>
              <span className="muted">
                {" "}
                — stay signed in on this device and save my email. Your password is never
                stored in the app.
              </span>
            </span>
          </label>

          <button className="send login-btn" type="submit" disabled={status === "busy"}>
            {status === "busy"
              ? mode === "signup"
                ? "Creating account…"
                : "Signing in…"
              : mode === "signup"
                ? "Create secure account"
                : "Sign in securely"}
          </button>
        </form>

        {status === "error" && message ? (
          <div className="login-error" role="alert">
            <p className="err">{message}</p>
            {/no password|create account/i.test(message) ? (
              <button
                type="button"
                className="chip chip-primary login-error-cta"
                onClick={() => switchMode("signup")}
              >
                Create account with this email
              </button>
            ) : null}
            {/already exists|sign in instead/i.test(message) ? (
              <button
                type="button"
                className="chip chip-primary login-error-cta"
                onClick={() => switchMode("signin")}
              >
                Go to Sign in
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="login-security">
          <p className="login-security-title">Your account is protected</p>
          <ul>
            <li>Passwords are hashed with scrypt — we never store plain text.</li>
            <li>Sign-in uses encrypted HTTPS to the LOLCallout account service.</li>
            <li>
              Remember me keeps a secure session token (not your password) for up to 90 days.
            </li>
          </ul>
        </div>

        <div className="login-footer-links">
          <button
            type="button"
            className="login-text-link"
            onClick={() => void openInBrowser("https://lolcallout.com")}
          >
            lolcallout.com
          </button>
          <span className="login-footer-dot" aria-hidden>
            ·
          </span>
          <button
            type="button"
            className="login-text-link"
            disabled={updating}
            onClick={() => void openLatest()}
          >
            {updating
              ? "Opening…"
              : localVersion
                ? `Update (v${localVersion})`
                : "Get latest update"}
          </button>
        </div>

        <p className="legal login-legal">Not endorsed by Riot Games · lolcallout.com</p>
      </div>
    </div>
  );
}
