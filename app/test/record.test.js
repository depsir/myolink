import { describe, expect, it } from "vitest";
import { composeLayout } from "../src/record/layout.js";
import {
  countInRange, emgCsv, extFor, inRange, MIME_CANDIDATES, pitchCsv, stamp, stampName,
  supportedMimes, videoBitrate,
} from "../src/record/export.js";
import { PitchStore, Store } from "../src/core/store.js";

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

describe("supportedMimes", () => {
  it("torna i supportati in ordine di preferenza", () => {
    // mp4 H.264+AAC per primo: è l'unico che macOS apre da solo e l'unico che
    // dichiara la durata. WebM è il ripiego, non la scelta.
    expect(supportedMimes(() => true)).toEqual(MIME_CANDIDATES);
    expect(supportedMimes((t) => !t.includes("mp4"))[0]).toBe("video/webm;codecs=vp9,opus");
    expect(supportedMimes((t) => t === "video/webm")).toEqual(["video/webm"]);
  });

  it("torna la LISTA e non il primo: è quella che permette di scendere di profilo", () => {
    // `isTypeSupported` risponde sul MIME, non sull'encoder disponibile: dove
    // H.264 è software il sì a High diventa un'eccezione al `new MediaRecorder`,
    // e chi costruisce deve avere i candidati successivi per ripiegare.
    expect(supportedMimes(() => true).length).toBe(MIME_CANDIDATES.length);
  });

  it("i profili H.264 scendono da High a baseline, non il contrario", () => {
    // Il contenuto è tutto bordi netti, e baseline è l'unico dei tre senza CABAC
    // né trasformata 8×8: prenderlo quando High è disponibile vorrebbe dire
    // buttare nitidezza a parità di bitrate. Le prime tre lettere del profilo
    // sono l'unica cosa che conta, il resto della stringa è livello e vincoli.
    const profili = MIME_CANDIDATES
      .filter((m) => m.includes("avc1."))
      .map((m) => m.match(/avc1\.(..)/)[1].toUpperCase());
    expect(profili).toEqual(["64", "4D", "42"]);
  });

  it("i codec si chiedono per nome: `video/mp4` liscio non è un candidato", () => {
    // Lasciando scegliere al browser escono H.264+Opus o VP9 dentro un mp4, che
    // sono le combinazioni che QuickTime non apre.
    expect(supportedMimes((t) => t === "video/mp4")).toEqual([]);
    for (const m of MIME_CANDIDATES) expect(m).toMatch(/codecs=|^video\/webm$/);
  });

  it("nessun formato supportato: lista vuota, non un MIME inventato", () => {
    expect(supportedMimes(() => false)).toEqual([]);
  });

  it("ogni candidato è un contenitore video con estensione utile", () => {
    for (const m of MIME_CANDIDATES) expect(["webm", "mp4"]).toContain(extFor(m));
  });
});

describe("videoBitrate", () => {
  it("scala col numero di pixel al secondo", () => {
    // Il doppio dei pixel chiede il doppio dei bit, nel campo dove non tocca né
    // pavimento né tetto.
    expect(videoBitrate(1280, 720, 30)).toBe(Math.round(1280 * 720 * 30 * 0.28));
    expect(videoBitrate(1280, 720, 60)).toBe(2 * videoBitrate(1280, 720, 30));
  });

  it("non scende sotto il pavimento né sale sopra il tetto", () => {
    // Sotto: a risoluzioni piccole la formula darebbe un bitrate a cui H.264 fa
    // blocchi anche su fondo piatto. Sopra: il prodotto cresce col quadrato della
    // finestra e oltre un certo punto non compra niente di visibile.
    expect(videoBitrate(320, 240, 30)).toBe(4e6);
    expect(videoBitrate(3840, 2160, 60)).toBe(32e6);
  });

  it("il bpp è un parametro, così una prova non deve cambiare la sorgente", () => {
    // 1920×1080 e non 1280×720: a 720p il valore dimezzato cadrebbe sotto il
    // pavimento e la prova misurerebbe il clamp invece del parametro.
    expect(videoBitrate(1920, 1080, 30, 0.14)).toBe(
      Math.round(videoBitrate(1920, 1080, 30, 0.28) / 2));
  });

  it("è un intero: MediaRecorder vuole un numero di bit, non una frazione", () => {
    expect(Number.isInteger(videoBitrate(1001, 667, 30))).toBe(true);
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

  it("il timbro è riusabile da solo: i file di UNA registrazione lo condividono", () => {
    // Video e CSV con due timbri diversi — anche solo un secondo — non si
    // riconoscono più come lo stesso pezzo di prova nella cartella dei download.
    const d = new Date(2026, 7, 13, 9, 4, 5);
    const base = "myolink-" + stamp(d);
    expect([base + ".mp4", base + ".csv", base + ".pitch.csv"]).toEqual([
      "myolink-20260813-090405.mp4",
      "myolink-20260813-090405.csv",
      "myolink-20260813-090405.pitch.csv",
    ]);
    expect(stampName("myolink", "mp4", d)).toBe(base + ".mp4");
  });
});

// L'intervallo è ciò che separa "i dati della registrazione" da "i dati della
// sessione": è la domanda a cui l'app rispondeva male, e questi sono i suoi bordi.
describe("inRange", () => {
  const ring = () => {
    const s = new Store(16);
    for (let k = 0; k <= 10; k++) s.push(k, k * 100);
    return s;
  };

  it("senza intervallo esce tutto: è l'export di tutta la memoria", () => {
    expect(inRange(ring(), null)).toEqual({ from: 0, to: 11 });
  });

  it("estremi COMPRESI: un campione timbrato esattamente allo stop è dentro", () => {
    // Mezzo campione fuori per parte sarebbe invisibile su un grafico e visibile
    // in un CSV, cioè il posto peggiore in cui scoprirlo.
    expect(inRange(ring(), { t0: 3, t1: 6 })).toEqual({ from: 3, to: 7 });
    expect(countInRange(ring(), { t0: 3, t1: 6 })).toBe(4);
  });

  it("tempi ripetuti al bordo: ci sono tutti, non solo il primo", () => {
    const s = new Store(16);
    for (const t of [1, 2, 2, 2, 3]) s.push(t, 0);
    expect(inRange(s, { t0: 2, t1: 2 })).toEqual({ from: 1, to: 4 });
  });

  it("intervallo che non tocca nessun campione: fetta vuota, non l'anello intero", () => {
    expect(countInRange(ring(), { t0: 20, t1: 30 })).toBe(0);
    expect(countInRange(ring(), { t0: -5, t1: -1 })).toBe(0);
    // t1 prima di t0 (clock che si è riassestato all'indietro): niente, non tutto.
    expect(countInRange(ring(), { t0: 8, t1: 2 })).toBe(0);
  });

  it("intervallo più largo dei dati: quello che c'è, senza inventare righe", () => {
    expect(countInRange(ring(), { t0: -100, t1: 100 })).toBe(11);
  });

  it("guarda la finestra viva, non gli slot buttati dal giro del buffer", () => {
    const s = new Store(3);
    [1, 2, 3, 4].forEach((t) => s.push(t, t * 10));
    expect(inRange(s, { t0: 0, t1: 10 })).toEqual({ from: 0, to: 3 });
  });
});

describe("emgCsv e pitchCsv sull'intervallo registrato", () => {
  it("esce la sola fetta del video, con la stessa intestazione", () => {
    const s = new Store(16);
    for (let k = 0; k <= 10; k++) s.push(k, k * 100);
    const rows = emgCsv(s, { t0: 3, t1: 5 }).trim().split("\n");
    expect(rows[0]).toBe("t_s,valore");
    expect(rows.slice(1)).toEqual(["3.000000,300", "4.000000,400", "5.000000,500"]);
  });

  it("intervallo senza campioni: solo l'intestazione — e chi salva la conta prima", () => {
    // Il file non va scritto affatto in quel caso (vedi snapshotData): un CSV di
    // sola intestazione sembra un dato perso.
    const s = new Store(8);
    s.push(1, 10);
    expect(emgCsv(s, { t0: 50, t1: 60 })).toBe("t_s,valore\n");
    expect(countInRange(s, { t0: 50, t1: 60 })).toBe(0);
  });

  it("il pitch si taglia sullo stesso intervallo, con clarity accanto", () => {
    const p = new PitchStore(16);
    p.push(1, 60, 0.9); p.push(2, 62, 0.8); p.push(3, 64, 0.7);
    const rows = pitchCsv(p, { t0: 2, t1: 3 }).trim().split("\n");
    expect(rows[0]).toBe("t_s,midi,clarity");
    expect(rows.length).toBe(3);
    expect(rows[1]).toBe("2.000000,62.0000,0.8000");
  });

  it("senza intervallo i due CSV restano quelli di prima: tutta la memoria", () => {
    const s = new Store(8);
    s.push(1, 10); s.push(2, 20);
    expect(emgCsv(s, null)).toBe(emgCsv(s));
    expect(emgCsv(s).trim().split("\n").length).toBe(3);
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
