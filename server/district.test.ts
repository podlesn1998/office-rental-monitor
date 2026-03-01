import { describe, it, expect } from "vitest";
import { guessDistrict } from "./scrapers/district";

describe("guessDistrict", () => {
  it("returns null for null/undefined address", () => {
    expect(guessDistrict(null)).toBeNull();
    expect(guessDistrict(undefined)).toBeNull();
    expect(guessDistrict("")).toBeNull();
  });

  it("detects Центральный by Лиговский проспект", () => {
    expect(guessDistrict("Лиговский проспект, 10/118")).toBe("Центральный");
  });

  it("detects Центральный by Казанская улица", () => {
    expect(guessDistrict("Казанская улица, 7")).toBe("Центральный");
  });

  it("detects Центральный by Апраксин переулок", () => {
    expect(guessDistrict("Апраксин переулок, 8")).toBe("Центральный");
  });

  it("detects Выборгский by улица Комсомола", () => {
    expect(guessDistrict("улица Комсомола, 1-3М")).toBe("Выборгский");
  });

  it("detects Выборгский by проспект Тореза", () => {
    expect(guessDistrict("проспект Тореза, 98к1")).toBe("Выборгский");
  });

  it("detects Выборгский by Новолитовская улица", () => {
    expect(guessDistrict("Новолитовская улица, 15")).toBe("Выборгский");
  });

  it("detects Петроградский by Большой проспект Петроградской стороны", () => {
    expect(guessDistrict("Большой проспект Петроградской стороны, 18")).toBe("Петроградский");
  });

  it("detects Красногвардейский by Октябрьская набережная", () => {
    expect(guessDistrict("Октябрьская набережная, 104к43")).toBe("Красногвардейский");
  });

  it("detects Адмиралтейский by Красноармейская улица", () => {
    expect(guessDistrict("8-я Красноармейская улица, 19")).toBe("Адмиралтейский");
  });

  it("detects Пушкинский by Пушкин in address", () => {
    expect(guessDistrict("Пушкин, улица Архитектора Данини, 5")).toBe("Пушкинский");
  });

  it("is case-insensitive", () => {
    expect(guessDistrict("ЛИГОВСКИЙ ПРОСПЕКТ, 10")).toBe("Центральный");
  });

  it("returns null for unknown address", () => {
    expect(guessDistrict("улица Неизвестная, 999")).toBeNull();
  });
});

// Test the district filter logic (mirrors applyDistrictFilter in index.ts)
function applyDistrictFilter(district: string | null, districts: string[]): boolean {
  if (!districts || districts.length === 0) return true;
  if (!district) return true; // keep if district unknown
  return districts.includes(district);
}

describe("applyDistrictFilter", () => {
  it("allows all listings when no districts configured", () => {
    expect(applyDistrictFilter("Выборгский", [])).toBe(true);
    expect(applyDistrictFilter(null, [])).toBe(true);
  });

  it("allows listing when district matches configured list", () => {
    expect(applyDistrictFilter("Центральный", ["Центральный"])).toBe(true);
    expect(applyDistrictFilter("Выборгский", ["Центральный", "Выборгский"])).toBe(true);
  });

  it("blocks listing when district does not match configured list", () => {
    expect(applyDistrictFilter("Выборгский", ["Центральный"])).toBe(false);
    expect(applyDistrictFilter("Кировский", ["Центральный", "Адмиралтейский"])).toBe(false);
  });

  it("allows listing with unknown district even when filter is set", () => {
    expect(applyDistrictFilter(null, ["Центральный"])).toBe(true);
  });
});
