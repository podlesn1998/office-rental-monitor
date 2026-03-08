/**
 * Listing quality score calculator.
 *
 * Ideal criteria (as specified by user):
 *   - 1st floor
 *   - Ceiling height ≥ 3.5 m  ← more important than entrance
 *   - Area 30–60 m² (ideal), < 25 m² unusable, > 60 m² too large
 *   - Separate entrance (отдельный вход)
 *
 * Score breakdown (max 100):
 *   Floor:            30 pts  (floor=1: 30, floor=2: 12, floor=3: 4, unknown: 8)
 *   Ceiling height:   35 pts  (≥3.5m: 35, ≥3.0m: 21, ≥2.7m: 9, unknown: 12)
 *   Area:             20 pts  (30–60m²: 20, 25–30m²: 10, 60–70m²: 10, <25m²: -50, >70m²: 0, unknown: 5)
 *   Separate entrance: 15 pts (keyword match in title/description)
 */

export interface ScoreInput {
  floor?: number | null;
  totalFloors?: number | null;
  ceilingHeight?: number | null; // in cm, e.g. 350 = 3.5m
  area?: number | null;          // in m²
  title?: string | null;
  description?: string | null;
}

export interface ScoreBreakdown {
  total: number;
  floor: number;
  entrance: number;
  ceiling: number;
  area: number;
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
  let areaScore = 0;

  // ---- Floor score (30 pts max) ----
  if (input.floor == null) {
    floorScore = 8; // unknown — slight bonus, might be 1st
    details.push("Этаж неизвестен (+8)");
  } else if (input.floor === 1) {
    floorScore = 30;
    details.push("1-й этаж ✓ (+30)");
  } else if (input.floor === 2) {
    floorScore = 12;
    details.push("2-й этаж (+12)");
  } else if (input.floor === 3) {
    floorScore = 4;
    details.push(`${input.floor}-й этаж (+4)`);
  } else {
    floorScore = 0;
    details.push(`${input.floor}-й этаж (0)`);
  }

  // ---- Ceiling height score (35 pts max) ----
  if (input.ceilingHeight == null) {
    ceilingScore = 12; // unknown — moderate bonus
    details.push("Высота потолков неизвестна (+12)");
  } else {
    const heightM = input.ceilingHeight / 100;
    if (heightM >= 3.5) {
      ceilingScore = 35;
      details.push(`Потолки ${heightM.toFixed(1)} м ✓ (+35)`);
    } else if (heightM >= 3.0) {
      ceilingScore = 21;
      details.push(`Потолки ${heightM.toFixed(1)} м (+21)`);
    } else if (heightM >= 2.7) {
      ceilingScore = 9;
      details.push(`Потолки ${heightM.toFixed(1)} м (+9)`);
    } else {
      ceilingScore = 0;
      details.push(`Потолки ${heightM.toFixed(1)} м — низко (0)`);
    }
  }

  // ---- Area score (20 pts max, -50 penalty if < 25 m²) ----
  if (input.area == null) {
    areaScore = 5; // unknown — slight bonus
    details.push("Площадь неизвестна (+5)");
  } else if (input.area < 25) {
    areaScore = -50; // unusable
    details.push(`Площадь ${input.area} м² — непригодно (-50)`);
  } else if (input.area >= 30 && input.area <= 60) {
    areaScore = 20; // ideal range
    details.push(`Площадь ${input.area} м² ✓ идеально (+20)`);
  } else if (input.area >= 25 && input.area < 30) {
    areaScore = 10; // slightly small but acceptable
    details.push(`Площадь ${input.area} м² — немного мало (+10)`);
  } else if (input.area > 60 && input.area <= 70) {
    areaScore = 10; // slightly large but acceptable
    details.push(`Площадь ${input.area} м² — немного много (+10)`);
  } else {
    // > 70 m²
    areaScore = 0;
    details.push(`Площадь ${input.area} м² — слишком много (0)`);
  }

  // ---- Separate entrance score (15 pts max) ----
  const haystack = `${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();
  const hasEntrance = ENTRANCE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
  if (hasEntrance) {
    entranceScore = 15;
    details.push("Отдельный вход ✓ (+15)");
  } else if (haystack.includes("вход")) {
    // Mentions "вход" but not specifically separate
    entranceScore = 3;
    details.push("Упоминание входа (+3)");
  } else {
    entranceScore = 0;
    details.push("Отдельный вход не указан (0)");
  }

  const rawTotal = floorScore + entranceScore + ceilingScore + areaScore;
  const total = Math.max(0, Math.min(100, rawTotal));

  return {
    total,
    floor: floorScore,
    entrance: entranceScore,
    ceiling: ceilingScore,
    area: areaScore,
    details,
  };
}

/**
 * Returns just the numeric score (0-100).
 */
export function computeScore(input: ScoreInput): number {
  return scoreListing(input).total;
}
