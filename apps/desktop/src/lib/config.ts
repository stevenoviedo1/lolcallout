function fromQuery(key: string): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get(key);
  } catch {
    return null;
  }
}

/** Packaged Electron injects ?api=&agent= ; Vite env for dev */
export const API_URL =
  fromQuery("api") || import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";
export const AGENT_URL =
  fromQuery("agent") || import.meta.env.VITE_AGENT_URL || "http://127.0.0.1:3847";
