/**
 * Stripe — LOLCallout (one package, everything included)
 * Standard: $100/mo recurring (STRIPE_PRICE_PRO)
 * Founders (first 100): $50/mo for 6 months from activation
 *   (12 months at $50/mo if founders sell out — FOUNDERS_ACCESS_MONTHS=12)
 *
 * Env:
 *  STRIPE_SECRET_KEY=
 *  STRIPE_PRICE_PRO=price_...          # $100/mo
 *  STRIPE_PRICE_FOUNDERS=price_...     # $50/mo founders
 *  FOUNDERS_ACCESS_MONTHS=6            # months at founders rate; 12 if sold out
 *  APP_URL=https://lolcallout.com
 */
import Stripe from "stripe";
import {
  getUserByEmail,
  grantFounders,
  grantPro,
  upsertUser,
  userHasAccess,
} from "./authStore.js";

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/** How many months founders keep the $50/mo rate (from activation). */
export function foundersAccessMonths(): number {
  const n = Number(process.env.FOUNDERS_ACCESS_MONTHS || 6);
  return n === 12 ? 12 : 6;
}

export async function createCheckoutSession(opts: {
  email?: string;
  founders?: boolean;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) {
    return {
      error: "Stripe not configured. Set STRIPE_SECRET_KEY in .env",
    };
  }

  const appUrl = process.env.APP_URL || "https://lolcallout.com";
  const founders = Boolean(opts.founders);
  const months = foundersAccessMonths();

  if (founders && !process.env.STRIPE_PRICE_FOUNDERS) {
    return {
      error:
        "Founders checkout not ready. Set STRIPE_PRICE_FOUNDERS to a $50/mo recurring Price in Stripe.",
    };
  }

  const price = founders
    ? process.env.STRIPE_PRICE_FOUNDERS!
    : process.env.STRIPE_PRICE_PRO;

  if (!price) {
    return {
      error:
        "STRIPE_PRICE_PRO missing. Create a $100/mo recurring Price in Stripe and set the env var.",
    };
  }

  // Both plans are monthly subscriptions ($50 founders / $100 standard)
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url:
      opts.successUrl ||
      `${appUrl}/?checkout=${founders ? "founders_success" : "success"}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: opts.cancelUrl || `${appUrl}/?checkout=cancel`,
    allow_promotion_codes: !founders,
    metadata: {
      product: "lolcallout",
      plan: founders ? "founders" : "pro",
      founders_rate_months: founders ? String(months) : "",
      email: opts.email || "",
    },
    subscription_data: {
      metadata: {
        product: "lolcallout",
        plan: founders ? "founders" : "pro",
        founders_rate_months: founders ? String(months) : "",
        email: opts.email || "",
      },
    },
  };

  if (opts.email) sessionParams.customer_email = opts.email;

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) return { error: "No checkout URL returned" };
    return { url: session.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stripe checkout failed" };
  }
}

/** Call after successful checkout (webhook or success page verify) */
export function applyCheckoutEntitlement(opts: {
  email: string;
  plan: "founders" | "pro";
  stripeCustomerId?: string;
  months?: number;
}) {
  const email = opts.email.trim().toLowerCase();
  if (!email) return null;
  upsertUser(email, { stripeCustomerId: opts.stripeCustomerId });
  if (opts.plan === "founders") {
    // Active founders subscription: access while paying; track rate window
    const months = opts.months ?? foundersAccessMonths();
    return grantFounders(email, months);
  }
  return grantPro(email, 1);
}

export function isEntitled(email?: string): boolean {
  if (!email) return false;
  return userHasAccess(getUserByEmail(email));
}

export function listEntitled(): string[] {
  return [];
}

export function markEntitled(email: string) {
  return grantFounders(email, foundersAccessMonths());
}
