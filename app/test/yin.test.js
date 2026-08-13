import { beforeAll, describe, expect, it } from "vitest";
import { PITCH_FFT, hzOf, midiOf, noteName, parseNote, setupYin, yin } from "../src/audio/pitch.js";

const SR = 48000;

// Timbro fatto apposta per far sbagliare l'ottava: la fondamentale è la più
// DEBOLE delle tre. Un pitch tracker che prenda il picco dello spettro qui
// sbaglia sempre; è il caso della voce, ed è il motivo per cui si usa YIN.
function tone(f, sr = SR, h = [0.15, 0.55, 0.45]) {
  const buf = new Float32Array(PITCH_FFT);
  for (let i = 0; i < buf.length; i++) {
    let s = 0;
    h.forEach((amp, k) => { s += amp * Math.sin(2 * Math.PI * f * (k + 1) * i / sr); });
    buf[i] = s;
  }
  return buf;
}

const cents = (a, b) => Math.abs(a - b) * 100;

beforeAll(() => setupYin(SR));

describe("scala delle note", () => {
  it("midiOf e noteName concordano sui riferimenti", () => {
    expect(midiOf(440)).toBeCloseTo(69, 9);
    expect(noteName(69)).toBe("A4");
    expect(noteName(60)).toBe("C4");
    expect(noteName(midiOf(65.406))).toBe("C2");
  });

  it("parseNote legge diesis, bemolle e valori assurdi", () => {
    expect(parseNote("C4", 0)).toBe(60);
    expect(parseNote("A4", 0)).toBe(69);
    expect(parseNote("F#3", 0)).toBe(54);
    expect(parseNote("Bb4", 0)).toBe(70);
    expect(parseNote("", 42)).toBe(42);
    expect(parseNote("zzz", 42)).toBe(42);
  });
});

describe("yin", () => {
  it("riconosce le note senza sbagliare ottava, entro 2 cent", () => {
    for (const nome of ["C2", "C3", "A3", "C4", "A4", "C5", "A5"]) {
      const m = parseNote(nome, 0);
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const r = yin(tone(f));
      expect(cents(r.m, m), `${nome}: stimato ${r.m.toFixed(2)}`).toBeLessThan(2);
      expect(r.c).toBeGreaterThan(0.9);
    }
  });

  it("regge anche una fondamentale quasi assente", () => {
    const f = 220;                       // A3, fondamentale a 0.05
    const r = yin(tone(f, SR, [0.05, 0.6, 0.5, 0.4]));
    expect(cents(r.m, midiOf(f))).toBeLessThan(5);
  });

  it("respinge il rumore bianco con una clarity bassa", () => {
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
    const buf = new Float32Array(PITCH_FFT);
    for (let i = 0; i < buf.length; i++) buf[i] = rnd();
    const r = yin(buf);
    expect(r.c).toBeLessThan(0.5);       // sotto la soglia di default (0.80)
  });

  it("sul silenzio non inventa nessuna nota", () => {
    expect(yin(new Float32Array(PITCH_FFT)).m).toBeNaN();
  });

  // La garanzia del codice è sull'USCITA, non sull'ingresso: quando una stima
  // c'è, sta dentro il range dichiarato. Un 30 Hz con le sue armoniche cade
  // comunque dentro il range attraverso la seconda armonica — è corretto così,
  // e la nota che esce è quella che il tracker sente davvero.
  it("quando stima, resta dentro il range dichiarato", () => {
    for (const f of [30, 45, 2000, 4000]) {
      const r = yin(tone(f));
      if (!isNaN(r.m)) {
        expect(hzOf(r.m)).toBeGreaterThanOrEqual(60);
        expect(hzOf(r.m)).toBeLessThanOrEqual(1300);
      }
    }
  });

  it("funziona a 44.1 kHz come a 48", () => {
    setupYin(44100);
    const r = yin(tone(440, 44100));
    expect(cents(r.m, 69)).toBeLessThan(2);
    setupYin(SR);
  });
});
