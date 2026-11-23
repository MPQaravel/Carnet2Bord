import { describe, expect, it } from "vitest";
import {
  beaufortFromMs, beaufortLabel, cardinal, formatDm, formatDms, formatPosition,
  haversineNm, parsePosition, seaState, stardate, wmoInfo,
} from "./format";

describe("parsePosition", () => {
  it("décimal", () => {
    expect(parsePosition("48.6542, -4.4861")).toEqual({ lat: 48.6542, lon: -4.4861 });
    expect(parsePosition("48.6542 -4.4861")).toEqual({ lat: 48.6542, lon: -4.4861 });
  });
  it("degrés-minutes", () => {
    const r = parsePosition("48°39.2'N 4°29.2'W");
    expect("lat" in r && Math.abs(r.lat - 48.65333) < 1e-4).toBe(true);
    expect("lon" in r && Math.abs(r.lon + 4.48667) < 1e-4).toBe(true);
  });
  it("degrés-minutes-secondes", () => {
    const r = parsePosition("48°39'12\"N 4°29'12\"W");
    expect("lat" in r && Math.abs(r.lat - (48 + 39 / 60 + 12 / 3600)) < 1e-6).toBe(true);
  });
  it("erreurs", () => {
    expect("error" in parsePosition("abc")).toBe(true);
    expect("error" in parsePosition("95, 0")).toBe(true);
    expect("error" in parsePosition("0, 200")).toBe(true);
  });
});

describe("formatPosition", () => {
  it("roundtrip dm/dms", () => {
    const dm = formatPosition(48.6542, -4.4861, "dm");
    const r = parsePosition(dm);
    expect("lat" in r && Math.abs(r.lat - 48.6542) < 1e-3).toBe(true);
    const dms = formatPosition(48.6542, -4.4861, "dms");
    const r2 = parsePosition(dms);
    expect("lat" in r2 && Math.abs(r2.lat - 48.6542) < 1e-4).toBe(true);
    expect(formatDm(48.6542, -4.4861)).toContain("48°39.25'N");
    expect(formatDms(48.6542, -4.4861)).toContain("48°39'15\"N");
  });
});

describe("beaufort / cardinal / haversine / seaState / wmo / stardate", () => {
  it("beaufort", () => {
    expect(beaufortFromMs(0.1)).toBe(0);
    expect(beaufortFromMs(6)).toBe(4);
    expect(beaufortFromMs(15)).toBe(7);
    expect(beaufortFromMs(40)).toBe(12);
    expect(beaufortLabel(8)).toContain("Coup de vent");
  });
  it("cardinal", () => {
    expect(cardinal(0)).toBe("N");
    expect(cardinal(90)).toBe("E");
    expect(cardinal(180)).toBe("S");
    expect(cardinal(270)).toBe("O");
    expect(cardinal(45)).toBe("NE");
    expect(cardinal(359)).toBe("N");
  });
  it("haversine Brest-Ouessant ≈ 24,5 M", () => {
    const d = haversineNm(48.3904, -4.4861, 48.4597, -5.0926);
    expect(Math.abs(d - 24.5) < 1.5).toBe(true);
  });
  it("seaState", () => {
    expect(seaState(0.05, null)).toBe("Calme (glace)");
    expect(seaState(2.6, null)).toBe("Forte");
    expect(seaState(null, 9)).toBe("Agitée");
    expect(seaState(null, null)).toBeNull();
  });
  it("wmo", () => {
    expect(wmoInfo(0).label).toBe("Ciel dégagé");
    expect(wmoInfo(95).icon).toBe("storm");
  });
  it("stardate", () => {
    // 01/01/2026 00:00 -> (2026-2323)*1000 = -297000.00
    expect(stardate(new Date(2026, 0, 1, 0, 0, 0))).toBe("-297000.00");
  });
});
