import { useState } from "react";
import { requestMagicLink } from "../lib/authApi";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [magicUrl, setMagicUrl] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    setMagicUrl(null);
    const res = await requestMagicLink(email);
    if (!res.ok) {
      setStatus("error");
      setMessage(res.error || "Could not send link");
      return;
    }
    setStatus("sent");
    setMessage(res.message || "Check your email for a secure sign-in link.");
    // Only if email provider didn't send (local API without Resend) — not a bypass
    if (res.devMagicUrl && res.emailed === false) {
      setMagicUrl(res.devMagicUrl);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src="/icon.jpg" alt="" width={48} height={48} />
          <h1>LOLCallout</h1>
        </div>
        <p className="login-lead">
          Secure sign-in with a <strong>magic link</strong> — no password. We’ll email you a one-time
          link that expires in 15 minutes.
        </p>

        {status !== "sent" ? (
          <form onSubmit={(e) => void submit(e)} className="login-form">
            <label className="slider-label">
              Email
              <input
                className="voice-select"
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
            <p className="muted">
              Open the email on this device, click the link, and you’ll land back here signed in.
            </p>
            {magicUrl && (
              <p className="muted" style={{ marginTop: 12 }}>
                Email not configured on this machine —{" "}
                <a href={magicUrl} className="dev-link">
                  open secure sign-in link
                </a>
              </p>
            )}
            <button type="button" className="chip" onClick={() => setStatus("idle")}>
              Use a different email
            </button>
          </div>
        )}

        {status === "error" && <p className="err">{message}</p>}

        <div className="login-plans">
          <p>
            <strong>One plan</strong> — everything included · <strong>$100/mo</strong>
          </p>
          <p>
            <strong>Founders (first 100):</strong> <strong>$50/mo</strong> for 6 months
            from activate (12 mo at $50/mo if seats sell out)
          </p>
        </div>

        <p className="legal login-legal">
          Not endorsed by Riot Games. lolcallout.com
        </p>
      </div>
    </div>
  );
}
