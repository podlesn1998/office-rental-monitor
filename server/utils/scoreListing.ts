/**
 * Listing quality score calculator.
 *
 * Ideal criteria (as specified by user):
 *   - 1st floor
 *   - Separate entrance (отдельный вход)
 *   - Ceiling height ≥ 3.5 m
 *
 * Score breakdown (max 100):
 *   Floor:            35 pts  (floor=1: 35, floor=2: 15, floor=3+: 0, unknown: 10)
 *   Separate entrance: 35 pts (keyword match in title/description)
 *   Ceiling height:   30 pts  (≥3.5m: 30, ≥3.0m: 18, ≥2.7m: 8, unknown: 10)
 */

export interface ScoreInput {
  floor?: number | null;
  totalFloors?: number | null;
  ceilingHeight?: number | null; // in cm, e.g. 350 = 3.5m
  title?: string | null;
  description?: string | null;
}

export interface ScoreBreakdown {
  total: number;
  floor: number;
  entrance: number;
  ceiling: number;
  details: string[];
}

const ENTRANCE_KEYWORDS = [
  "отдельный вход",
  "отдельн. вход",
  "отд. вход",
  "собственный вход",
  "свой вход",
  "вход с улицы",
  "вход со двора",
  "отдельный выход",
  "отдельный парадный",
  "separate entrance",
];

export function scoreListing(input: ScoreInput): ScoreBreakdown {
  const details: string[] = [];
  let floorScore = 0;
  let entranceScore = 0;
  let ceilingScore = 0;

  // ---- Floor score (35 pts max) ----
  if (input.floor == null) {
    floorScore = 10; // unknown — slight bonus, might be 1st
    details.push("Этаж неизвестен (+10)");
  } else if (input.floor === 1) {
    floorScore = 35;
    details.push("1-й этаж ✓ (+35)");
  } else if (input.floor === 2) {
    floorScore = 15;
    details.push("2-й этаж (+15)");
  } else if (input.floor === 3) {
    floorScore = 5;
    details.push(`${input.floor}-й этаж (+5)`);
  } else {
    floorScore = 0;
    details.push(`${input.floor}-й этаж (0)`);
  }

  // ---- Separate entrance score (35 pts max) ----
  const haystack = `${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();
  const hasEntrance = ENTRANCE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
  if (hasEntrance) {
    entranceScore = 35;
    details.push("Отдельный вход ✓ (+35)");
  } else if (haystack.includes("вход")) {
    // Mentions "вход" but not specifically separate
    entranceScore = 5;
    details.push("Упоминание входа (+5)");
  } else {
    entranceScore = 0;
    details.push("Отдельный вход не указан (0)");
  }

  // ---- Ceiling height score (30 pts max) ----
  if (input.ceilingHeight == null) {
    ceilingScore = 10; // unknown — slight bonus
    details.push("Высота потолков неизвестна (+10)");
  } else {
    const heightM = input.ceilingHeight / 100;
    if (heightM >= 3.5) {
      ceilingScore = 30;
      details.push(`Потолки ${heightM.toFixed(1)} м ✓ (+30)`);
    } else if (heightM >= 3.0) {
      ceilingScore = 18;
      details.push(`Потолки ${heightM.toFixed(1)} м (+18)`);
    } else if (heightM >= 2.7) {
      ceilingScore = 8;
      details.push(`Потолки ${heightM.toFixed(1)} м (+8)`);
    } else {
      ceilingScore = 0;
      details.push(`Потолки ${heightM.toFixed(1)} м — низко (0)`);
    }
  }

  const total = Math.min(100, floorScore + entranceScore + ceilingScore);

  return {
    total,
    floor: floorScore,
    entrance: entranceScore,
    ceiling: ceilingScore,
    details,
  };
}

/**
 * Returns just the numeric score (0-100).
 */
export function computeScore(input: ScoreInput): number {
  return scoreListing(input).total;
}
