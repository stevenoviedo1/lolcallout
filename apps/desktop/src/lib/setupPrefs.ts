/** First-run setup wizard completion flag */

const SETUP_KEY = "rc_setup_complete";
const SETUP_VERSION = "1";

export function isSetupComplete(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === SETUP_VERSION;
  } catch {
    return false;
  }
}

export function markSetupComplete(): void {
  try {
    localStorage.setItem(SETUP_KEY, SETUP_VERSION);
  } catch {
    /* ignore */
  }
}

export function clearSetupComplete(): void {
  try {
    localStorage.removeItem(SETUP_KEY);
  } catch {
    /* ignore */
  }
}

export type CoachIntensity = "quiet" | "normal" | "talkative";

export function getCoachIntensity(): CoachIntensity {
  try {
    const v = localStorage.getItem("rc_coach_intensity");
    if (v === "quiet" || v === "talkative") return v;
  } catch {
    /* ignore */
  }
  return "normal";
}

export function setCoachIntensity(v: CoachIntensity): void {
  try {
    localStorage.setItem("rc_coach_intensity", v);
  } catch {
    /* ignore */
  }
}

export function getAutoCompact(): boolean {
  try {
    return localStorage.getItem("rc_auto_compact") !== "0";
  } catch {
    return true;
  }
}

export function setAutoCompact(on: boolean): void {
  try {
    localStorage.setItem("rc_auto_compact", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
