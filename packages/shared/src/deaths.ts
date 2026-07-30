/** Death pattern tracking across a match */

export interface DeathRecord {
  gameTime: number;
  level: number;
  gold: number;
  kills: number;
  deaths: number;
  /** crude bucket for pattern matching */
  phase: "early" | "mid" | "late";
  note?: string;
}

export interface DeathPatternReport {
  total: number;
  early: number;
  mid: number;
  late: number;
  /** Human-readable dominant pattern if any */
  dominant: string | null;
  records: DeathRecord[];
}

export function phaseForTime(gameTime: number): DeathRecord["phase"] {
  if (gameTime < 14 * 60) return "early";
  if (gameTime < 25 * 60) return "mid";
  return "late";
}

export function analyzeDeaths(records: DeathRecord[]): DeathPatternReport {
  const early = records.filter((r) => r.phase === "early").length;
  const mid = records.filter((r) => r.phase === "mid").length;
  const late = records.filter((r) => r.phase === "late").length;

  let dominant: string | null = null;
  if (records.length >= 3) {
    if (early >= 3) dominant = "dying too much before 14:00";
    else if (late >= 3) dominant = "throwing late — overextending when fed or desperate";
    else if (mid >= 3) dominant = "mid-game fights without a plan";
    else if (early >= 2 && mid >= 2) dominant = "repeat early+mid deaths — reset habits";
  } else if (records.length === 2 && early === 2) {
    dominant = "two early deaths — stabilize lane first";
  }

  // gold greed: died with high gold multiple times
  const richDeaths = records.filter((r) => r.gold >= 1500).length;
  if (richDeaths >= 2) {
    dominant = dominant
      ? `${dominant}; also dying with big unspent gold`
      : "dying while sitting on big unspent gold — BASE";
  }

  // Cluster deaths: multiple deaths within 3 minutes → fighting without reset
  if (records.length >= 2) {
    const sorted = [...records].sort((a, b) => a.gameTime - b.gameTime);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].gameTime - sorted[i - 1].gameTime < 180) {
        dominant = dominant
          ? `${dominant}; back-to-back deaths — reset before re-fighting`
          : "back-to-back deaths — buy and wait for allies before re-fighting";
        break;
      }
    }
  }

  // Low level deaths: dying when clearly underleveled (level ≤ avg of death levels early)
  const earlyLow = records.filter((r) => r.phase === "early" && r.level <= 4).length;
  if (earlyLow >= 2 && !dominant) {
    dominant = "early levels lost — stop forcing all-ins before spike";
  }

  return {
    total: records.length,
    early,
    mid,
    late,
    dominant,
    records,
  };
}
