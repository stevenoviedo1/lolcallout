import {
  analyzeDeaths,
  phaseForTime,
  type DeathPatternReport,
  type DeathRecord,
} from "@riftcoach/shared";
import type { GameContext } from "@riftcoach/shared";

export class DeathTracker {
  private records: DeathRecord[] = [];
  private lastDeathCount = 0;
  private wasDead = false;

  reset() {
    this.records = [];
    this.lastDeathCount = 0;
    this.wasDead = false;
  }

  /** Call each poll with latest context */
  ingest(ctx: GameContext): DeathPatternReport {
    const you = ctx.you;
    if (!you || !ctx.inGame) {
      return analyzeDeaths(this.records);
    }

    const deaths = you.deaths ?? 0;
    const isDead = Boolean(you.isDead);

    // Rising death counter or transition into dead
    if (deaths > this.lastDeathCount || (isDead && !this.wasDead)) {
      if (deaths > this.lastDeathCount || isDead) {
        this.records.push({
          gameTime: ctx.gameTime,
          level: you.level,
          gold: you.currentGold,
          kills: you.kills,
          deaths,
          phase: phaseForTime(ctx.gameTime),
          note: you.currentGold >= 1500 ? "died_with_gold" : undefined,
        });
      }
    }

    this.lastDeathCount = deaths;
    this.wasDead = isDead;
    return analyzeDeaths(this.records);
  }

  report(): DeathPatternReport {
    return analyzeDeaths(this.records);
  }
}
