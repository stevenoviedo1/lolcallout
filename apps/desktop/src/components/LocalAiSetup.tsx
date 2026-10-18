import { useEffect, useState } from "react";
import { fetchLocalAiStatus, type LocalAiStatus } from "../lib/api";
import { useAppStore } from "../stores/useAppStore";

/** Rough GPU read from WebGL (browsers can't report VRAM, so this is a heuristic). */
function detectGpu(): { name: string; integrated: boolean } {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as
      | WebGLRenderingContext
      | null;
    if (!gl) return { name: "Unknown GPU", integrated: true };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    );
    const integrated =
      /intel|uhd|iris|microsoft basic|swiftshader|llvmpipe/i.test(name) ||
      (/radeon\(tm\)? graphics|radeon graphics/i.test(name) && !/rx\s?\d/i.test(name));
    return { name, integrated };
  } catch {
    return { name: "Unknown GPU", integrated: true };
  }
}

export function LocalAiSetup() {
  const refreshLocalAi = useAppStore((s) => s.refreshLocalAi);
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const gpu = useState(() => detectGpu())[0];

  const check = async () => {
    setChecking(true);
    const s = await fetchLocalAiStatus(true);
    setStatus(s);
    setChecked(true);
    setChecking(false);
    void refreshLocalAi(true);
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentDown = checked && !status;
  const ollamaDown = status && !status.ollamaRunning;
  const noModel = status && status.ollamaRunning && !status.model;
  const ready = Boolean(status?.model);

  return (
    <div className="setup-panel">
      <p className="muted">
        LOLCallout's AI runs <strong>on your own PC</strong> with{" "}
        <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
          Ollama
        </a>
        . It's free, and your game data never goes to an AI company. If it isn't set up, you still
        get the built-in coach lines.
      </p>

      <ul className="setup-checklist">
        <li>
          {agentDown ? "⚠️" : status ? "✅" : "…"} LOLCallout agent{" "}
          {agentDown && <span className="muted">— not running (start the app's agent)</span>}
        </li>
        <li>
          {ollamaDown || agentDown ? "⚠️" : status?.ollamaRunning ? "✅" : "…"} Ollama at
          127.0.0.1:11434{" "}
          {ollamaDown && (
            <span className="muted">— not found. Install from ollama.com, then open it.</span>
          )}
        </li>
        <li>
          {ready ? "✅" : noModel ? "⚠️" : "…"} Coach model{" "}
          {ready && <span className="muted">— using {status?.model}</span>}
          {noModel && <span className="muted">— not installed yet</span>}
        </li>
      </ul>

      {!ready && (
        <>
          <p className="setup-section-label">Run this in a terminal (one time, ~2 GB download)</p>
          <pre className="setup-code">ollama pull qwen2.5:3b-instruct</pre>
          <p className="muted">
            Optional tuned coach (from the LOLCallout folder):{" "}
            <code>ollama create lolcoach -f models/lolcoach/Modelfile</code>
          </p>
        </>
      )}

      <p className="setup-section-label">Your GPU</p>
      <p className="muted">
        {gpu.name}
        <br />
        {gpu.integrated
          ? "Looks like integrated graphics — local AI may be slow and cost FPS. 6GB+ VRAM recommended; built-in lines work fine without it."
          : "6GB+ VRAM recommended for smooth callouts while you play (a 3B model uses ~2.5 GB)."}
      </p>

      <button type="button" className="chip chip-on" disabled={checking} onClick={() => void check()}>
        {checking ? "Checking…" : "Check again"}
      </button>
      {status?.hint && <p className="err">{status.hint}</p>}
    </div>
  );
}
