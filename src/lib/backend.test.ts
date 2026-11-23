import { describe, expect, it } from "vitest";
import { buildWeather, summarizeNavigations } from "./backend";
import { Log, Navigation } from "./types";

const forecast = {
  current: { temperature_2m: 13.9, weather_code: 2, cloud_cover: 40, precipitation: 0, pressure_msl: 1013.2, wind_speed_10m: 5.2, wind_direction_10m: 286, wind_gusts_10m: 8.1 },
  hourly: {
    time: ["2026-11-23T13:00", "2026-11-23T14:00", "2026-11-23T15:00"],
    temperature_2m: [13.1, 13.9, 14.2],
    weather_code: [2, 3, 1],
    cloud_cover: [30, 40, 20],
    precipitation: [0, 0.2, 0],
    pressure_msl: [1012.9, 1013.2, 1013.5],
    wind_speed_10m: [4.8, 5.2, 5.6],
    wind_direction_10m: [280, 286, 290],
    wind_gusts_10m: [7.5, 8.1, 8.8],
    visibility: [24000, 20000, 30000],
  },
};
const marine = {
  hourly: {
    time: ["2026-11-23T13:00", "2026-11-23T14:00", "2026-11-23T15:00"],
    wave_height: [2.4, 2.6, 2.8],
    wave_direction: [286, 287, 288],
    wave_period: [9.0, 9.2, 9.4],
    sea_surface_temperature: [13.0, 13.2, 13.3],
  },
};

describe("buildWeather", () => {
  it("prend l'heure la plus proche et calcule beaufort/état de mer", () => {
    const w = buildWeather(forecast, marine, "2026-11-23T14:10:00");
    expect(w.temp_air_c).toBe(13.9);
    expect(w.wmo_code).toBe(3);
    expect(w.wind_speed_ms).toBe(5.2);
    expect(w.beaufort).toBe(3);
    expect(w.wind_dir_deg).toBe(286);
    expect(w.wave_height_m).toBe(2.6);
    expect(w.sea_temp_c).toBe(13.2);
    expect(w.sea_state).toBe("Forte");
  });
  it("dérive l'état de la mer du vent sans données marine", () => {
    const w = buildWeather(forecast, null, "2026-11-23T13:30:00");
    expect(w.wave_height_m).toBeNull();
    expect(w.sea_state).toBe("Peu agitée");
  });
});

function mkLog(id: string, dt: string, nav: string | null, lat: number | null, lon: number | null, wind: number | null, wave: number | null): Log {
  return {
    id, log_datetime: dt, stardate: null, vessel: "Kraken", departure: "A", destination: "B",
    heading_deg: null, speed_kn: null, sails: "", crew: "", lat, lon,
    position_source: "manual", observations: "", weather: wind != null || wave != null ? { wind_speed_ms: wind, wave_height_m: wave, temp_air_c: 12 } : null,
    weather_captured_at: dt, weather_source: "open_meteo", overrides: [], offline: false,
    navigation_id: nav, created_at: dt, updated_at: dt,
  };
}

describe("summarizeNavigations", () => {
  it("durée, distance, météo moyenne, statut", () => {
    const nav: Navigation = { id: "n1", name: "A → B", vessel: "Kraken", created_at: "" };
    const logs = [
      mkLog("1", "2026-06-01T10:00:00", "n1", 48.39, -4.48, 5, 1),
      mkLog("2", "2026-06-01T12:00:00", "n1", 48.46, -5.09, 7, 3),
    ];
    const [s] = summarizeNavigations(logs, [nav]);
    expect(s.duration_hours).toBe(2);
    expect(s.distance_nm).toBeGreaterThan(22);
    expect(s.distance_nm).toBeLessThan(27);
    expect(s.avg_wind_ms).toBe(6);
    expect(s.max_wave_m).toBe(3);
    expect(s.log_ids).toEqual(["1", "2"]);
  });
  it("pas de distance si moins de 2 positions", () => {
    const nav: Navigation = { id: "n1", name: "x", vessel: "K", created_at: "" };
    const logs = [mkLog("1", "2026-06-01T10:00:00", "n1", 48.39, -4.48, 5, null), mkLog("2", "2026-06-01T11:00:00", "n1", null, null, 6, null)];
    const [s] = summarizeNavigations(logs, [nav]);
    expect(s.distance_nm).toBeNull();
  });
});
