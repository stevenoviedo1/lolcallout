import { randomUUID } from "node:crypto";
import type { DetectedSignal, GameContext } from "@riftcoach/shared";
import {
  buildSignalCoachLines,
  buildSituationBrief,
  hpPercent,
  isAramMode,
  isArenaMode,
  isNoRecallMode,
} from "@riftcoach/shared";

const SIGNAL_COOLDOWN_MS: Record<string, number> = {
  death: 14_000,
  base: 50_000,
  low_hp: 22_000,
  objective: 35_000,
  level_up: 18_000,
  game_end: 5_000,
  shutdown: 50_000,
  kill: 16_000,
  numbers: 25_000,
  match_start: 120_000,
  tempo: 48_000,
  generic: 30_000,
};

function teamOfYou(ctx: GameContext): "ORDER" | "CHAOS" | "UNKNOWN" {
  const you = ctx.you;
  if (!you) return "UNKNOWN";
  const hit =
    ctx.scoreboard.find(
      (p) =>
        p.championName === you.championName &&
        p.kills === you.kills &&
        p.deaths === you.deaths
    ) || ctx.scoreboard.find((p) => p.championName === you.championName);
  return hit?.team ?? "UNKNOWN";
}

export class EventDetector {
  private prev: GameContext | null = null;
  private lastFire = new Map<string, number>();
  private buffer: DetectedSignal[] = [];
  private matchStartEmitted = false;
  private lastAllyDead = 0;
  private lastEnemyDead = 0;

  ingest(next: GameContext): DetectedSignal[] {
    const created: DetectedSignal[] = [];
    const prev = this.prev;
    const noRecall = isNoRecallMode(next);
    const aram = isAramMode(next);
    const arena = isArenaMode(next);

    if (!next.inGame) {
      this.matchStartEmitted = false;
      this.lastAllyDead = 0;
      this.lastEnemyDead = 0;
    }

    if (prev?.inGame && !next.inGame) {
      const lines = buildSignalCoachLines("game_end", prev.inGame ? prev : next);
      const brief = buildSituationBrief(prev.inGame ? prev : next, "game_end");
      const s = this.tryEmit("game_end", "urgent", next, {
        title: lines?.title || "Game ended",
        detail: lines?.detail || brief.fallback,
        coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
        spokenFallback: brief.fallback,
      });
      if (s) created.push(s);
    }

    if (next.inGame && next.you) {
      const you = next.you;

      // Match start plan (once)
      if (!this.matchStartEmitted && next.gameTime > 5 && next.gameTime < 90) {
        this.matchStartEmitted = true;
        const brief = buildSituationBrief(next, "match_start");
        const s = this.tryEmit("match_start", "info", next, {
          title: "Open",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }

      const wasDead = Boolean(prev?.you?.isDead);
      if (you.isDead && !wasDead && prev?.inGame) {
        const snap: GameContext = {
          ...next,
          you: {
            ...you,
            currentGold: prev.you?.currentGold ?? you.currentGold,
            currentHealth: prev.you?.currentHealth ?? you.currentHealth,
            maxHealth: prev.you?.maxHealth ?? you.maxHealth,
          },
          deathReport: next.deathReport || prev.deathReport,
        };
        const brief = buildSituationBrief(snap, "death");
        const s = this.tryEmit("death", "urgent", snap, {
          title: "Coach",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }

      // Your kill / assist (deaths counter of enemies via your K/A rising)
      if (prev?.you && !you.isDead) {
        const gotKill = you.kills > (prev.you.kills ?? 0);
        const gotAssist = you.assists > (prev.you.assists ?? 0);
        if (gotKill || gotAssist) {
          const brief = buildSituationBrief(next, "kill", {
            extra: gotKill ? "YOU got a kill" : "YOU got an assist",
          });
          const s = this.tryEmit("kill", "warn", next, {
            title: gotKill ? "Kill" : "Assist",
            detail: brief.fallback,
            coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
            spokenFallback: brief.fallback,
          });
          if (s) created.push(s);
        }
      }

      // Numbers swing
      const team = teamOfYou(next);
      const allies = next.scoreboard.filter((p) => p.team === team && team !== "UNKNOWN");
      const enemies = next.scoreboard.filter(
        (p) => p.team !== team && p.team !== "UNKNOWN"
      );
      const allyDead = allies.filter((p) => p.isDead).length;
      const enemyDead = enemies.filter((p) => p.isDead).length;
      if (
        (allyDead >= 2 && allyDead > this.lastAllyDead) ||
        (enemyDead >= 2 && enemyDead > this.lastEnemyDead)
      ) {
        const brief = buildSituationBrief(next, "numbers", {
          extra: `alliesDead=${allyDead} enemiesDead=${enemyDead}`,
        });
        const s = this.tryEmit("numbers", "warn", next, {
          title: "Numbers",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }
      this.lastAllyDead = allyDead;
      this.lastEnemyDead = enemyDead;

      if (prev?.you && you.level > prev.you.level) {
        const brief = buildSituationBrief(next, "level_up");
        const s = this.tryEmit("level_up", "info", next, {
          title: `L${you.level}`,
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }

      const hp = hpPercent(you);
      if (hp != null && hp > 0 && hp < 28 && !you.isDead) {
        const brief = buildSituationBrief(next, "low_hp");
        const s = this.tryEmit("low_hp", "warn", next, {
          title: "HP",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }

      if (!noRecall && you.currentGold >= 1600 && !you.isDead) {
        const brief = buildSituationBrief(next, "base");
        const s = this.tryEmit("base", "info", next, {
          title: "Base",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }

      if (you.kills >= 3 && you.deaths <= you.kills && !you.isDead) {
        const brief = buildSituationBrief(next, "shutdown");
        const s = this.tryEmit("shutdown", "warn", next, {
          title: "Lead",
          detail: brief.fallback,
          coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
          spokenFallback: brief.fallback,
        });
        if (s) created.push(s);
      }
    }

    // Objectives
    if (next.inGame && prev) {
      const prevIds = new Set(
        (prev.recentEvents || []).map((e) => `${e.type}:${e.gameTime}:${e.message}`)
      );
      for (const e of next.recentEvents || []) {
        const key = `${e.type}:${e.gameTime}:${e.message}`;
        if (prevIds.has(key)) continue;
        if (e.type === "DRAGON" || e.type === "BARON" || e.type === "HERALD") {
          if (aram || arena) continue;
        }
        if (
          e.type === "DRAGON" ||
          e.type === "BARON" ||
          e.type === "HERALD" ||
          e.type === "TURRET"
        ) {
          const brief = buildSituationBrief(next, "objective", {
            extra: `${e.type} ${e.message || ""}`,
          });
          const s = this.tryEmit("objective", "warn", next, {
            title: e.type,
            detail: brief.fallback,
            coachPrompt: `${brief.instruction}\n\n${brief.text}\n\nFALLBACK: ${brief.fallback}`,
            spokenFallback: brief.fallback,
          });
          if (s) created.push(s);
        }
      }
    }

    this.prev = structuredClone(next);
    return created;
  }

  drain(): DetectedSignal[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  /** Peek without clearing (debug) */
  peek(): DetectedSignal[] {
    return [...this.buffer];
  }

  clearSignals() {
    this.buffer = [];
  }

  resetSoft() {
    this.buffer = [];
    this.prev = null;
    this.lastFire.clear();
    this.matchStartEmitted = false;
    this.lastAllyDead = 0;
    this.lastEnemyDead = 0;
  }

  private tryEmit(
    kind: DetectedSignal["kind"],
    severity: DetectedSignal["severity"],
    ctx: GameContext,
    parts: {
      title: string;
      detail?: string;
      coachPrompt: string;
      spokenFallback?: string;
    }
  ): DetectedSignal | null {
    const now = Date.now();
    const cd = SIGNAL_COOLDOWN_MS[kind] ?? 30_000;
    const last = this.lastFire.get(kind) ?? 0;
    if (now - last < cd) return null;
    this.lastFire.set(kind, now);

    const signal: DetectedSignal = {
      id: randomUUID(),
      kind,
      severity,
      gameTime: ctx.gameTime,
      title: parts.title,
      detail: parts.detail,
      coachPrompt: parts.coachPrompt,
      spokenFallback: parts.spokenFallback,
      createdAt: new Date().toISOString(),
    };
    this.buffer.push(signal);
    if (this.buffer.length > 24) this.buffer = this.buffer.slice(-16);
    return signal;
  }
}
