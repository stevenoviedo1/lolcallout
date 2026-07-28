import { useEffect, useState } from "react";
import {
  openInBrowser,
  requestDesktopMagicLink,
  type AuthUser,
} from "../lib/authApi";
import {
  getAppVersion,
  openUpdateDownload,
  resolveLatestDownloadUrl,
} from "../lib/updates";

export function LoginScreen({
  onSignedIn,
}: {
  onSignedIn?: (user?: AuthUser | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [localVersion, setLocalVersion] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void getAppVersion().then((v) => setLocalVersion(v));
  }, []);

  // Deep link / hash may complete sign-in while this screen is open
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
    setStatus("sending");
    setMessage("");

    const res = await requestDesktopMagicLink(email);
    if (!res.ok) {
      setStatus("error");
      setMessage(res.error || "Could not start sign-in");
      return;
    }

    setStatus("sent");

    if (res.emailed) {
      setMessage(
        "Check your email — click “Sign in securely”. Windows will ask to open LOLCallout."
      );
      return;
    }

    // No Resend on server: open the one-shot verify URL in the system browser.
    // Verify page redirects to lolcallout://auth?token=… which reopens this app signed in.
    if (res.browserAuthUrl) {
      setMessage("Opening your browser to finish secure sign-in…");
      await openInBrowser(res.browserAuthUrl);
      setMessage(
        "Finish in the browser window. If Windows asks to open LOLCallout, click Open. This app will sign you in automatically."
      );
      return;
    }

    setMessage(
      res.message ||
        "Check your email for a sign-in link. Then return here — the app will open signed in."
    );
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
            Installer from our official GitHub release — no sign-in required.
          </p>
        </div>

        <p className="login-lead">
          Sign in with a <strong>magic link</strong>: we open your browser / email, you click once,
          then Windows brings you back into this app. No password.
        </p>

        {status !== "sent" ? (
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
                disabled={status === "sending"}
              />
            </label>
            <button className="send login-btn" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        ) : (
          <div className="login-sent">
            <p className="ok-msg">{message}</p>
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              Keep this window open. After you click the link, you should land here signed in.
            </p>
            <button
              type="button"
              className="chip"
              style={{ marginTop: 14 }}
              onClick={() => {
                setStatus("idle");
                setMessage("");
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        {status === "error" && message && <p className="err">{message}</p>}

        <div className="login-security">
          <p className="login-security-title">How this works</p>
          <ul>
            <li>
              Sign-in is handled by our secure server + browser (not a free-for-all “type any
              email”).
            </li>
            <li>
              The link proves you control the inbox, then opens <strong>LOLCallout</strong> via a
              private deep link.
            </li>
            <li>Use the same email you use for Founders / Pro on lolcallout.com.</li>
          </ul>
        </div>

        <ul className="login-trust">
          <li>Live Client only · no injection</li>
          <li>One coach voice · second monitor ready</li>
          <li>Browser sign-in · returns to this app</li>
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
