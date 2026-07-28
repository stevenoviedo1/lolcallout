/**
 * Opt-in primary-monitor capture.
 * Uses screenshot-desktop when available; never injects into League.
 */

export async function capturePrimaryScreenJpeg(): Promise<{
  base64: string;
  mime: string;
} | null> {
  try {
    // Dynamic import so agent still boots if optional native deps fail
    const mod = await import("screenshot-desktop");
    const screenshot = mod.default || mod;
    const img: Buffer = await screenshot({ format: "jpg" });
    if (!img || img.length < 1000 || img.length > 2_500_000) return null;
    return { base64: img.toString("base64"), mime: "image/jpeg" };
  } catch (e) {
    console.warn("[capture] failed", e instanceof Error ? e.message : e);
    return null;
  }
}
