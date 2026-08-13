import { describe, expect, it } from "vitest";
import { ClockFit } from "../src/core/clock.js";

describe("ClockFit", () => {
  it("ritrova skew e offset di un clock sintetico", () => {
    // Device 100 ppm più lento, 30 ms di latenza di trasporto costante.
    const skew = 100e-6, lat = 0.030;
    const c = new ClockFit();
    for (let i = 0; i < 500; i++) {
      const dev = i * 0.05;
      c.add(dev, dev * (1 + skew) + lat);
    }
    expect(c.skewPpm).toBeCloseTo(100, 0);
    expect(c.hostToDevice(10 * (1 + skew) + lat)).toBeCloseTo(10, 3);
    expect(c.jitterMs).toBeLessThan(0.1);       // niente rumore: niente jitter
  });

  it("misura il jitter senza farsi spostare la stima", () => {
    const c = new ClockFit();
    let s = 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
    for (let i = 0; i < 2000; i++) {
      const dev = i * 0.05;
      c.add(dev, dev + 0.030 + rnd() * 0.02);   // ±10 ms di jitter uniforme
    }
    expect(Math.abs(c.skewPpm)).toBeLessThan(200);
    expect(c.jitterMs).toBeGreaterThan(2);
    expect(c.jitterMs).toBeLessThan(10);
  });

  it("prima di avere punti non pretende di sapere niente", () => {
    const c = new ClockFit();
    expect(c.x0).toBeNull();
    expect(c.hostToDevice(123)).toBe(0);
  });

  it("reset riporta allo stato iniziale", () => {
    const c = new ClockFit();
    for (let i = 0; i < 50; i++) c.add(i * 0.05, i * 0.05 + 0.03);
    c.reset();
    expect(c.x0).toBeNull();
    expect(c.a).toBe(1);
  });
});
