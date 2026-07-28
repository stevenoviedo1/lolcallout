/** Check GitHub Releases for a newer LOLCallout build and surface a soft update prompt. */

export type UpdateInfo = {
  version: string;
  name: string;
  notes: string;
  downloadUrl: string;
  htmlUrl: string;
};

const GH_LATEST =
  "https://api.github.com/repos/stevenoviedo1/lolcallout/releases/latest";
const SKIP_KEY = "lc_skip_update";

export function parseVersion(v: string): number[] {
  return String(v || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((p) => parseInt(p, 10) || 0);
}

/** true if remote is newer than local */
export function isNewerVersion(remote: string, local: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function getAppVersion(): Promise<string> {
  try {
    const w = window as Window & { lolcallout?: { getVersion?: () => Promise<string> } };
    if (w.lolcallout?.getVersion) {
      const v = await w.lolcallout.getVersion();
      if (v) return v;
    }
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

export function wasSkipped(version: string): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === version;
  } catch {
    return false;
  }
}

export function skipVersion(version: string) {
  try {
    localStorage.setItem(SKIP_KEY, version);
  } catch {
    /* ignore */
  }
}

export async function checkForUpdate(localVersion: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(GH_LATEST, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const remote = (data.tag_name || "").replace(/^v/i, "");
    if (!remote || !isNewerVersion(remote, localVersion)) return null;
    if (wasSkipped(remote)) return null;

    const assets = data.assets || [];
    const setup =
      assets.find((a) => /setup/i.test(a.name) && /\.exe$/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name));
    const downloadUrl =
      setup?.browser_download_url ||
      data.html_url ||
      "https://lolcallout.com/#download";

    return {
      version: remote,
      name: data.name || `LOLCallout ${remote}`,
      notes: (data.body || "").slice(0, 600),
      downloadUrl,
      htmlUrl: data.html_url || "https://github.com/stevenoviedo1/lolcallout/releases",
    };
  } catch {
    return null;
  }
}

export async function openUpdateDownload(url: string) {
  try {
    const w = window as Window & {
      lolcallout?: { openExternal?: (u: string) => Promise<boolean> };
    };
    if (w.lolcallout?.openExternal) {
      await w.lolcallout.openExternal(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const FALLBACK_LATEST =
  "https://github.com/stevenoviedo1/lolcallout/releases/latest";

/**
 * Resolve best download URL for the latest release (Setup .exe preferred).
 * Always works from the sign-in page even if local API is down.
 */
export async function resolveLatestDownloadUrl(): Promise<string> {
  try {
    const res = await fetch(GH_LATEST, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return FALLBACK_LATEST;
    const data = (await res.json()) as {
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const assets = data.assets || [];
    const setup =
      assets.find((a) => /setup/i.test(a.name) && /\.exe$/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name));
    return (
      setup?.browser_download_url ||
      data.html_url ||
      FALLBACK_LATEST
    );
  } catch {
    return FALLBACK_LATEST;
  }
}
