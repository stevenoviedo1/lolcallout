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
  extendAccess,
  getUserByEmail,
  getUserByStripeCustomerId,
  grantFounders,
  grantPro,
  revokeAccess,
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

/**
 * Stripe webhook handler (raw body + signature).
 * Events: checkout.session.completed, invoice.paid, customer.subscription.deleted
 */
export async function handleStripeWebhook(
  rawBody: Buffer | string,
  signature: string | undefined
): Promise<{ ok: true; handled: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe not configured" };

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;

  try {
    if (secret && signature) {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } else if (process.env.NODE_ENV !== "production") {
      // Dev only: allow unsigned parse
      event = JSON.parse(
        typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
      ) as Stripe.Event;
    } else {
      return { ok: false, error: "STRIPE_WEBHOOK_SECRET required in production" };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid webhook signature",
    };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" && session.mode !== "payment") break;
        if (session.payment_status !== "paid" && session.status !== "complete") break;
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          session.metadata?.email ||
          "";
        if (!email) break;
        const plan = session.metadata?.plan === "founders" ? "founders" : "pro";
        const monthsMeta = Number(
          session.metadata?.founders_rate_months || session.metadata?.months || 0
        );
        applyCheckoutEntitlement({
          email,
          plan,
          months: plan === "founders" && monthsMeta > 0 ? monthsMeta : undefined,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : undefined,
        });
        return { ok: true, handled: "checkout.session.completed" };
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const email =
          invoice.customer_email ||
          (typeof invoice.customer === "string"
            ? getUserByStripeCustomerId(invoice.customer)?.email
            : undefined) ||
          "";
        if (!email) break;
        const cust =
          typeof invoice.customer === "string" ? invoice.customer : undefined;
        if (cust) upsertUser(email, { stripeCustomerId: cust });
        // Renew monthly access (Stripe v18+: plan metadata lives on parent.subscription_details)
        const metaPlan =
          invoice.parent?.subscription_details?.metadata?.plan ??
          (invoice as { subscription_details?: { metadata?: { plan?: string } } })
            .subscription_details?.metadata?.plan;
        const user = getUserByEmail(email);
        const plan =
          metaPlan === "founders" || user?.plan === "founders" ? "founders" : "pro";
        extendAccess(email, 1, plan);
        return { ok: true, handled: "invoice.paid" };
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const email =
          sub.metadata?.email ||
          (typeof sub.customer === "string"
            ? getUserByStripeCustomerId(sub.customer)?.email
            : undefined) ||
          "";
        if (!email) break;
        revokeAccess(email);
        return { ok: true, handled: "customer.subscription.deleted" };
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.status === "active" || sub.status === "trialing") {
          const email =
            sub.metadata?.email ||
            (typeof sub.customer === "string"
              ? getUserByStripeCustomerId(sub.customer)?.email
              : undefined) ||
            "";
          if (!email) break;
          const plan = sub.metadata?.plan === "founders" ? "founders" : "pro";
          const cust = typeof sub.customer === "string" ? sub.customer : undefined;
          if (cust) upsertUser(email, { stripeCustomerId: cust });
          // Keep at least ~35 days of access while active
          extendAccess(email, 1, plan);
          return { ok: true, handled: "customer.subscription.updated" };
        }
        if (
          sub.status === "canceled" ||
          sub.status === "unpaid" ||
          sub.status === "incomplete_expired"
        ) {
          const email =
            sub.metadata?.email ||
            (typeof sub.customer === "string"
              ? getUserByStripeCustomerId(sub.customer)?.email
              : undefined) ||
            "";
          if (email) revokeAccess(email);
          return { ok: true, handled: "customer.subscription.updated-revoke" };
        }
        break;
      }
      default:
        return { ok: true, handled: `ignored:${event.type}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Webhook handler failed",
    };
  }

  return { ok: true, handled: `noop:${event.type}` };
}
