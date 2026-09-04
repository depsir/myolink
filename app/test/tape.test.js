import { describe, expect, it } from "vitest";
import { Tape } from "../src/audio/tape.js";

// Un blocco come lo consegna la scheda audio, con un valore riconoscibile per
// campione: così si può controllare *quale* pezzo di nastro esce da una lettura,
// non solo che ne esca qualcosa.
const block = (n, fn) => Float32Array.from({ length: n }, (_, i) => fn(i));

describe("il nastro dell'audio", () => {
  it("decima a un intero e tiene il rate giusto", () => {
    expect(new Tape(48000).rate).toBe(24000);
    expect(new Tape(48000).f).toBe(2);
    expect(new Tape(44100).f).toBe(2);
    expect(new Tape(16000).f).toBe(1);          // già sotto il bersaglio: non si decima
  });

  it("scrive la media dei campioni decimati", () => {
    const t = new Tape(48000, 10);
    t.push(block(8, (i) => (i % 2 ? 0.5 : 0)), 0);   // coppie (0, 0.5) → 0.25
    expect(t.k).toBe(4);
    const out = new Float32Array(4);
    expect(t.read(0, out)).toBe(4);
    for (const v of out) expect(v).toBeCloseTo(0.25, 3);
  });

  it("i campioni che avanzano fra due blocchi non si perdono", () => {
    const t = new Tape(48000, 10);
    t.push(block(5, () => 1), 0);      // 5 campioni: 2 scritti, 1 in avanzo
    expect(t.k).toBe(2);
    t.push(block(5, () => 1), 5 / 48000);
    expect(t.k).toBe(5);               // 10 campioni in tutto / 2
  });

  it("il tempo di un campione si legge dentro il suo blocco", () => {
    const t = new Tape(48000, 10);
    for (let b = 0; b < 4; b++) t.push(block(4800, () => 0), 10 + b * 0.1);
    // 4800 campioni a 48 kHz = 100 ms per blocco, 2400 sul nastro
    expect(t.tAt(0)).toBeCloseTo(10, 6);
    expect(t.tAt(2400)).toBeCloseTo(10.1, 6);
    expect(t.tAt(3600)).toBeCloseTo(10.15, 6);
    expect(t.span().t0).toBeCloseTo(10, 6);
    expect(t.span().t1).toBeCloseTo(10.4, 6);
  });

  it("indexAt e tAt sono l'una l'inversa dell'altra", () => {
    const t = new Tape(48000, 10);
    for (let b = 0; b < 10; b++) t.push(block(4800, () => 0), 100 + b * 0.1);
    for (const x of [100, 100.35, 100.9, 100.999]) {
      expect(t.tAt(t.indexAt(x))).toBeCloseTo(x, 4);
    }
  });

  it("fuori dal nastro non c'è nulla da cercare", () => {
    const t = new Tape(48000, 10);
    t.push(block(4800, () => 0), 50);
    expect(t.indexAt(49)).toBe(null);
    expect(t.indexAt(60)).toBe(null);
    expect(new Tape(48000).indexAt(0)).toBe(null);
    expect(new Tape(48000).span()).toBe(null);
  });

  it("quando gira, il vecchio esce e lo span lo dice", () => {
    // Nastro da 1 s: dieci blocchi da 200 ms lo riempiono due volte.
    const t = new Tape(48000, 1);
    for (let b = 0; b < 10; b++) t.push(block(9600, () => 0), b * 0.2);
    expect(t.n).toBe(t.cap);
    const s = t.span();
    expect(s.t1).toBeCloseTo(2.0, 2);
    expect(s.t0).toBeCloseTo(1.0, 2);          // il primo secondo è stato coperto
    expect(t.indexAt(0.5)).toBe(null);         // e non si può più cercare
  });

  it("le ancore non crescono senza fine", () => {
    const t = new Tape(48000, 1);
    for (let b = 0; b < 200; b++) t.push(block(4800, () => 0), b * 0.1);
    expect(t.aT.length).toBeLessThan(15);      // ~1 s di blocchi da 100 ms
  });

  it("la lettura si ferma alla fine del nastro invece di inventare", () => {
    const t = new Tape(48000, 10);
    t.push(block(480, () => 1), 0);            // 240 campioni
    const out = new Float32Array(1000);
    expect(t.read(0, out)).toBe(240);
  });

  it("legge il pezzo giusto anche dopo il giro", () => {
    const t = new Tape(48000, 1);              // 24000 campioni
    // Primo giro a 0.25, secondo a 0.75: dopo il giro si deve leggere 0.75.
    for (let b = 0; b < 5; b++) t.push(block(9600, (i) => (i % 2 ? 0.5 : 0)), b * 0.2);
    for (let b = 5; b < 10; b++) t.push(block(9600, (i) => (i % 2 ? 1 : 0.5)), b * 0.2);
    const out = new Float32Array(100);
    t.read(t.k - 100, out);
    for (const v of out) expect(v).toBeCloseTo(0.75, 3);
  });

  it("un salto indietro nel tempo azzera il nastro", () => {
    // È il link che si connette: la base dei tempi cambia, e quello che c'era
    // prima è timbrato su un'altra scala. Stessa regola di Ring.monotonic.
    const t = new Tape(48000, 10);
    for (let b = 0; b < 5; b++) t.push(block(4800, () => 1), 100 + b * 0.1);
    expect(t.k).toBeGreaterThan(0);
    t.push(block(4800, () => 1), 3);
    expect(t.span().t0).toBeCloseTo(3, 6);
    expect(t.k).toBe(2400);
  });

  it("un buco nel timbro non sposta i campioni che ci sono", () => {
    // Durante il riascolto la cattura si ferma: il nastro ha un buco, e i tempi
    // dopo il buco devono restare quelli veri.
    const t = new Tape(48000, 30);
    t.push(block(4800, () => 0.5), 10);
    t.push(block(4800, () => 0.25), 20);       // dieci secondi dopo
    expect(t.tAt(2400)).toBeCloseTo(20, 6);
    expect(t.indexAt(20.05)).toBe(3600);
    // Il tempo dentro il buco cade sull'ultimo campione del blocco precedente.
    expect(t.indexAt(15)).toBe(2400);
  });
});
