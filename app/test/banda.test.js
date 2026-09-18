import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bandaMisure, FERMATE } from "../src/record/layout.js";
import { ROSSO, SCALA, VERDE } from "../src/core/fatica.js";

// La banda è l'unico strato del video che va DIPINTO invece che copiato, e una
// banda storta si vede solo riguardando il file: le sue misure sono una funzione
// pura apposta per poterle guardare qui.
describe("bandaMisure", () => {
  it("tutto sta dentro l'altezza, senza avanzi né sconfinamenti", () => {
    for (const W of [390, 620, 800, 1240, 1920, 2560]) {
      const M = bandaMisure(W);
      expect(M.padY + M.row + M.gap + M.mk + M.padY).toBe(M.h);
      expect(M.yMk + M.mk).toBe(M.h - M.padY);
      expect(M.row).toBeGreaterThan(0);
    }
  });

  it("cresce con la larghezza, fra un minimo leggibile e un tetto", () => {
    // Fissa sarebbe una fascia enorme su un video da telefono e un filo su uno
    // da desktop: è lo stesso riquadro in due finestre molto diverse.
    expect(bandaMisure(390).h).toBe(64);          // pavimento
    expect(bandaMisure(4000).h).toBe(104);        // tetto
    expect(bandaMisure(1240).h).toBeGreaterThan(bandaMisure(800).h);
  });

  it("la nota ha il posto di tre caratteri, e non lo perde mai", () => {
    // "A#4" è il caso peggiore, e il posto è fisso perché la nota manca a ogni
    // respiro: una banda che si allarga e si stringe a ogni frase è la cosa che
    // si guarda al posto della misura.
    for (const W of [390, 1240, 2560]) {
      const M = bandaMisure(W);
      expect(M.wNota).toBeGreaterThanOrEqual(M.fNota * 1.7);
      // La riga dei testi non si prende tutta la larghezza: dopo il numero ci
      // stanno il divisorio, la nota e il margine.
      expect(M.padX + M.wNota + M.sep).toBeLessThan(M.w / 2);
    }
  });

  it("il numero della misura è più grande di quello dell'attesa", () => {
    // In attesa il numero è un conto alla rovescia in secondi, cioè un testo:
    // grande come una cifra da leggere di sfuggita sarebbe una promessa falsa.
    const M = bandaMisure(1240);
    expect(M.fNum).toBeGreaterThan(M.fAttesa);
    expect(M.fNum).toBeGreaterThan(M.fSay);
  });

  it("misure intere: mezzo pixel su un bordo è una riga sfocata nel file", () => {
    const M = bandaMisure(1237);
    for (const k of ["h", "padX", "padY", "mk", "gap", "row", "fSay", "fNum", "fNota", "wNota", "ago"]) {
      expect(Number.isInteger(M[k])).toBe(true);
    }
  });
});

describe("le fermate della pista", () => {
  it("sono i confini delle zone sulla scala, non due numeri scritti a mano", () => {
    expect(FERMATE).toEqual([VERDE / SCALA, ROSSO / SCALA]);
  });

  it("valgono le stesse percentuali che il CSS disegna nel riquadro", () => {
    // Il gradiente della barra a schermo è scritto in percentuali fisse: se le
    // due divergessero, lo stesso valore cadrebbe in una fascia sullo schermo e
    // in un'altra nel video, ed è il genere di errore che non si nota finché non
    // li si mette accanto.
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    const g = css.match(/\.meter-t[^}]*linear-gradient\(90deg,([^)]*)\)/)[1];
    const pct = [...g.matchAll(/([\d.]+)%/g)].map((m) => +m[1]);
    expect(pct[0]).toBeCloseTo(FERMATE[0] * 100, 1);
    expect(pct[2]).toBeCloseTo(FERMATE[1] * 100, 1);
  });
});

// Le tinte delle zone stanno nel CSS e il canvas le legge da lì: questa è la
// prova che le variabili che cerca esistono davvero, perché una
// `getComputedStyle` su un nome sbagliato torna stringa vuota e il canvas
// tiene il colore di prima invece di lamentarsi.
describe("le tinte delle zone", () => {
  it("sono variabili in :root, una coppia per zona", () => {
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    const banda = readFileSync(new URL("../src/record/banda.js", import.meta.url), "utf8");
    for (const z of ["verde", "giallo", "rosso"]) {
      expect(css).toMatch(new RegExp(`--zbg-${z}:\\s*#[0-9a-f]{6}`));
      expect(css).toMatch(new RegExp(`--zln-${z}:\\s*#[0-9a-f]{6}`));
      // e il riquadro a schermo le usa, invece di ripetere gli stessi hex
      expect(css).toMatch(new RegExp(`\\.sem\\[data-z=${z}\\][^}]*var\\(--zbg-${z}\\)`));
    }
    expect(banda).toMatch(/--zbg-|--zln-/);
    // Nessun colore di zona copiato a mano dentro il canvas.
    expect(banda).not.toMatch(/#(12251a|215230|261f0e|5c4516|2a1413|66302b)/i);
  });
});
