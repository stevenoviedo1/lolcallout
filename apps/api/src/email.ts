/**
 * Magic-link email delivery.
 * Configure RESEND_API_KEY for real email, else log link (dev).
 */

export async function sendMagicLinkEmail(opts: {
  to: string;
  magicUrl: string;
  expiresMinutes: number;
}): Promise<{ sent: boolean; provider: string }> {
  const from = process.env.AUTH_FROM_EMAIL || "LOLCallout <onboarding@resend.dev>";
  const key = process.env.RESEND_API_KEY;

  const subject = "Your LOLCallout sign-in link";
  const text = `Sign in to LOLCallout

Click this link (expires in ${opts.expiresMinutes} minutes):

${opts.magicUrl}

If you didn't request this, ignore this email.

— LOLCallout
Not affiliated with Riot Games.`;

  const html = `
  <div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0b0f1a;color:#e8eefc;border-radius:12px">
    <h2 style="margin:0 0 12px">Sign in to LOLCallout</h2>
    <p style="color:#8b9bb8;line-height:1.5">Click the button below. This link expires in <strong>${opts.expiresMinutes} minutes</strong>.</p>
    <p style="margin:24px 0">
      <a href="${opts.magicUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">
        Sign in securely
      </a>
    </p>
    <p style="color:#64748b;font-size:12px;word-break:break-all">${opts.magicUrl}</p>
    <p style="color:#64748b;font-size:12px;margin-top:24px">If you didn't request this, you can ignore this email.</p>
  </div>`;

  if (!key) {
    console.log("\n========== MAGIC LINK (dev — no RESEND_API_KEY) ==========");
    console.log(`To: ${opts.to}`);
    console.log(opts.magicUrl);
    console.log("=========================================================\n");
    return { sent: false, provider: "console" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[email] Resend failed", err);
    throw new Error(`Email send failed: ${res.status}`);
  }

  return { sent: true, provider: "resend" };
}
