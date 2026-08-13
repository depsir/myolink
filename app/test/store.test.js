import { describe, expect, it } from "vitest";
import { PitchStore, Ring, Store } from "../src/core/store.js";

describe("Ring", () => {
  it("indicizza in ordine anche dopo il giro del buffer", () => {
    const r = new Ring(4);
    for (let i = 0; i < 6; i++) r.advance(i);
    expect(r.n).toBe(4);
    expect([0, 1, 2, 3].map((k) => r.t[r.idx(k)])).toEqual([2, 3, 4, 5]);
    expect(r.tLast()).toBe(5);
  });

  it("firstAtOrAfter trova il primo elemento >= tMin", () => {
    const r = new Ring(16);
    for (let i = 0; i < 10; i++) r.advance(i);
    expect(r.firstAtOrAfter(-1)).toBe(0);
    expect(r.firstAtOrAfter(0)).toBe(0);
    expect(r.firstAtOrAfter(4.5)).toBe(5);
    expect(r.firstAtOrAfter(9)).toBe(9);
    expect(r.firstAtOrAfter(100)).toBe(10);      // niente: indice di fine
  });

  it("firstAtOrAfter resta valido dopo il giro del buffer", () => {
    const r = new Ring(4);
    for (let i = 0; i < 7; i++) r.advance(i);    // in memoria: 3,4,5,6
    expect(r.firstAtOrAfter(5)).toBe(2);
    expect(r.t[r.idx(r.firstAtOrAfter(5))]).toBe(5);
  });

  it("monotonic spinge avanti i ritorni piccoli e azzera sui salti grossi", () => {
    const r = new Ring(8);
    r.advance(10);
    // Rumore della regressione del clock: qualche ms indietro va corretto, non
    // accettato, altrimenti la ricerca binaria non varrebbe più.
    expect(r.monotonic(9.999)).toBeGreaterThan(10);
    expect(r.n).toBe(1);
    // Salto grosso all'indietro: è un cambio di base dei tempi, si riparte.
    expect(r.monotonic(2)).toBe(2);
    expect(r.n).toBe(0);
  });
});

describe("Store", () => {
  it("tiene insieme tempo e valore attraverso il giro", () => {
    const s = new Store(3);
    [[1, 10], [2, 20], [3, 30], [4, 40]].forEach(([t, v]) => s.push(t, v));
    expect(s.n).toBe(3);
    expect([0, 1, 2].map((k) => s.v[s.idx(k)])).toEqual([20, 30, 40]);
    expect(s.v[s.last()]).toBe(40);
  });
});

describe("PitchStore", () => {
  it("timbra in modo monotono anche con campioni fermi", () => {
    const p = new PitchStore(8);
    p.push(1, 60, 0.9);
    p.push(1, 61, 0.8);      // stesso istante: deve comunque avanzare
    expect(p.t[p.idx(1)]).toBeGreaterThan(p.t[p.idx(0)]);
    expect(p.m[p.idx(1)]).toBe(61);
  });
});
