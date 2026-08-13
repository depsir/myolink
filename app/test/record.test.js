import { describe, expect, it } from "vitest";
import { composeLayout } from "../src/record/layout.js";
import { emgCsv, extFor, MIME_CANDIDATES, pickMime, stampName } from "../src/record/export.js";
import { Store } from "../src/core/store.js";

describe("composeLayout", () => {
  it("impila nell'ordine dato, senza toccare la larghezza", () => {
    const L = composeLayout([
      { key: "emg", w: 1200, h: 700 },
      { key: "pitch", w: 1200, h: 300 },
    ]);
    expect(L.w).toBe(1200);
    expect(L.h).toBe(1000);
    expect(L.rects).toEqual([
      { key: "emg", x: 0, y: 0, w: 1200, h: 700 },
      { key: "pitch", x: 0, y: 700, w: 1200, h: 300 },
    ]);
  });

  it("il gap sta FRA gli strati, non in fondo", () => {
    const L = composeLayout([
      { key: "a", w: 100, h: 40 },
      { key: "b", w: 100, h: 40 },
      { key: "c", w: 100, h: 40 },
    ], 8);
    expect(L.rects.map((r) => r.y)).toEqual([0, 48, 96]);
    expect(L.h).toBe(136);        // 3*40 + 2*8, non 3*8
  });

  it("scarta gli strati di misura 0: sono pannelli nascosti o compressi", () => {
    const L = composeLayout([
      { key: "emg", w: 800, h: 0 },     // compresso
      { key: "pitch", w: 0, h: 0 },     // hidden
      { key: "spec", w: 800, h: 200 },
    ], 8);
    expect(L.rects.map((r) => r.key)).toEqual(["spec"]);
    expect(L.rects[0].y).toBe(0);       // niente buco lasciato da chi non c'è
    expect(L.h).toBe(200);
  });

  it("niente strati: fotogramma nullo, e chi chiama lo vede", () => {
    expect(composeLayout([], 8)).toEqual({ w: 0, h: 0, rects: [] });
    expect(composeLayout([{ key: "a", w: 0, h: 0 }], 8).rects).toEqual([]);
  });

  it("dimensioni pari, perché i codec 4:2:0 non le vogliono dispari", () => {
    const L = composeLayout([{ key: "a", w: 801, h: 101 }, { key: "b", w: 801, h: 100 }], 1);
    expect(L.w % 2).toBe(0);
    expect(L.h % 2).toBe(0);
    expect(L.w).toBe(802);
    expect(L.h).toBe(202);        // 101 + 1 + 100 = 202
  });

  it("uno strato più stretto resta centrato, non appeso a sinistra", () => {
    const L = composeLayout([{ key: "a", w: 800, h: 10 }, { key: "b", w: 600, h: 10 }]);
    expect(L.rects[0].x).toBe(0);
    expect(L.rects[1].x).toBe(100);
  });
});

describe("pickMime", () => {
  it("prende il primo supportato, in ordine di preferenza", () => {
    // mp4 H.264+AAC per primo: è l'unico che macOS apre da solo e l'unico che
    // dichiara la durata. WebM è il ripiego, non la scelta.
    expect(pickMime(() => true)).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
    expect(pickMime((t) => !t.includes("mp4"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickMime((t) => t === "video/webm")).toBe("video/webm");
  });

  it("i codec si chiedono per nome: `video/mp4` liscio non è un candidato", () => {
    // Lasciando scegliere al browser escono H.264+Opus o VP9 dentro un mp4, che
    // sono le combinazioni che QuickTime non apre.
    expect(pickMime((t) => t === "video/mp4")).toBe(null);
    for (const m of MIME_CANDIDATES) expect(m).toMatch(/codecs=|^video\/webm$/);
  });

  it("nessun formato supportato: null, non un MIME inventato", () => {
    expect(pickMime(() => false)).toBe(null);
  });

  it("ogni candidato è un contenitore video con estensione utile", () => {
    for (const m of MIME_CANDIDATES) expect(["webm", "mp4"]).toContain(extFor(m));
  });
});

describe("extFor", () => {
  it("ricava l'estensione dal MIME negoziato, non da una costante", () => {
    expect(extFor("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(extFor("video/mp4")).toBe("mp4");
    expect(extFor("VIDEO/WEBM")).toBe("webm");
    expect(extFor("")).toBe("bin");
    expect(extFor(undefined)).toBe("bin");
  });
});

describe("stampName", () => {
  it("ora locale, cifre fisse, niente caratteri illegali su Windows", () => {
    const n = stampName("myolink", "webm", new Date(2026, 7, 13, 9, 4, 5));
    expect(n).toBe("myolink-20260813-090405.webm");
    expect(n).not.toMatch(/[:\\/*?"<>|]/);
  });

  it("ordina cronologicamente anche in ordine alfabetico", () => {
    const a = stampName("x", "csv", new Date(2026, 0, 9, 23, 59, 59));
    const b = stampName("x", "csv", new Date(2026, 0, 10, 0, 0, 0));
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe("emgCsv", () => {
  it("intestazione più una riga per campione, dal più vecchio", () => {
    const s = new Store(8);
    s.push(1.5, 512); s.push(1.55, 700);
    expect(emgCsv(s)).toBe("t_s,valore\n1.500000,512\n1.550000,700\n");
  });

  it("microsecondi sul tempo: è l'informazione per cui esiste il protocollo", () => {
    const s = new Store(8);
    s.push(12.345678, 1);
    expect(emgCsv(s).split("\n")[1]).toBe("12.345678,1");
  });

  it("esporta la finestra viva, non gli slot buttati dal giro del buffer", () => {
    const s = new Store(3);
    [[1, 10], [2, 20], [3, 30], [4, 40]].forEach(([t, v]) => s.push(t, v));
    const rows = emgCsv(s).trim().split("\n");
    expect(rows.length).toBe(4);                       // intestazione + 3
    expect(rows[1]).toBe("2.000000,20");
    expect(rows[3]).toBe("4.000000,40");
  });

  it("store vuoto: la sola intestazione, che è un CSV valido", () => {
    expect(emgCsv(new Store(4))).toBe("t_s,valore\n");
  });
});
