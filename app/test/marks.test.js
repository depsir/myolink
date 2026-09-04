import { describe, expect, it } from "vitest";
import { PitchStore } from "../src/core/store.js";
import { analyze, markKey, mmss, noteAt, pickRange, restFromRecording } from "../src/core/marks.js";
import { ROSSO, VERDE } from "../src/core/fatica.js";
import { marksJson, marksVtt, pitchCsv } from "../src/record/export.js";

// Lo stesso LCG dei test della calibrazione: un test su una soglia non può
// passare e fallire a caso.
function prng(seed = 1) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

const HZ = 200, BASE = 250;

// Un brano finto, e finto in modo utile: frasi da 4 s ogni 6 (fra una e l'altra
// c'è la pausa, che sull'addome è il rilascio inspiratorio e quindi il solo
// riposo che una canzone contenga), appoggio +12 — cioè dentro il verde, come il
// canto normale sui dati veri — e dentro i passaggi tirati, messi a mano.
//
// I `tirati` durano più della finestra di lettura (2 s) di proposito: un bozzo
// più corto NON deve fare un momento, ed è la ragione per cui la finestra è
// lunga. Cadono dentro una frase, non a cavallo di una pausa.
function song(opt = {}) {
  const {
    secs = 120, tirati = [36.8, 90.8], durT = 3.5, ampT = 5,
    amp = 12, drift = 0, seed = 5, hz = HZ,
  } = opt;
  const r = prng(seed);
  const ts = [], vs = [];
  const sung = (t) => { const ph = t % 6; return ph > 0.6 && ph < 4.6; };
  for (let i = 0; i < Math.round(secs * hz); i++) {
    const t = i / hz;
    let v = BASE + 4 * Math.sin(2 * Math.PI * t / 4) + 6 * (r() - 0.5) + drift * (t / secs);
    if (sung(t)) v += tirati.some((p) => t > p && t < p + durT) ? amp * ampT : amp;
    ts.push(t); vs.push(v);
  }
  // Il pitch come lo produce l'app: un hop da 20 ms, clarity alta dove si canta.
  const pts = [], pm = [], pc = [];
  for (let i = 0; i < Math.round(secs * 50); i++) {
    const t = i / 50;
    pts.push(t); pm.push(sung(t) ? 60 + 3 * Math.sin(t) : 0); pc.push(sung(t) ? 0.93 : 0.2);
  }
  return { ts, vs, pitch: { ts: pts, m: pm, c: pc }, thr: 0.8 };
}

describe("il riposo, preso dalla registrazione", () => {
  it("trova la base nelle pause fra le frasi, non nella frase più bassa", () => {
    const s = song();
    const r = restFromRecording(s.ts, s.vs);
    // Il riposo vero è 250 (più l'ondulazione respiratoria). Con finestre da 5 s
    // nessuna sarebbe quieta e la base finirebbe decine di count più su.
    expect(Math.abs(r.base - BASE)).toBeLessThan(6);
    expect(r.noise).toBeGreaterThan(0);
    expect(r.noiseLvl).toBeGreaterThan(0);
    expect(r.quiete).toBeGreaterThan(3);
    expect(r.da).toBe("registrazione");
  });

  it("il rumore del LIVELLO è più piccolo di quello per campione", () => {
    const s = song();
    const r = restFromRecording(s.ts, s.vs);
    expect(r.noiseLvl).toBeLessThan(r.noise);
  });

  it("misura la deriva invece di correggerla", () => {
    const s = song({ drift: 60 });
    const r = restFromRecording(s.ts, s.vs);
    expect(r.driftNoto).toBe(true);
    expect(r.drift).toBeGreaterThan(30);
    // E la base resta quella dei tratti quieti: nessun detrend silenzioso.
    const plain = restFromRecording(...Object.values(song()).slice(0, 2));
    expect(r.base).toBeGreaterThan(plain.base);
  });

  it("con la calibrazione tiene la σ più piccola ma la base della registrazione", () => {
    const s = song();
    const cal = { ready: true, base: 999, noise: 0.5, noiseLvl: 0.2 };
    const r = restFromRecording(s.ts, s.vs, cal);
    // Con una soglia ASSOLUTA questo conta più che nella 5b: prendere la base
    // della calibrazione vorrebbe dire spostare le tre zone di tutto l'offset
    // fra un montaggio e l'altro.
    expect(r.base).not.toBe(999);
    expect(r.noise).toBe(0.5);
    expect(r.noiseLvl).toBe(0.2);
    expect(r.calBase).toBe(999);
    expect(r.da).toMatch(/calibrazione/);
  });

  it("una calibrazione con σ più GRANDE non peggiora la stima", () => {
    const s = song();
    const plain = restFromRecording(s.ts, s.vs);
    const r = restFromRecording(s.ts, s.vs, { ready: true, base: 1, noise: 99, noiseLvl: 99 });
    expect(r.noiseLvl).toBeCloseTo(plain.noiseLvl, 10);
  });

  it("una registrazione di un secondo risponde comunque", () => {
    const s = song({ secs: 1 });
    const r = restFromRecording(s.ts, s.vs);
    expect(isFinite(r.base)).toBe(true);
    expect(isFinite(r.noise)).toBe(true);
    expect(r.driftNoto).toBe(false);      // una metà sola: "non si sa" non è "zero"
  });

  it("pochissimi campioni: nessuna finestra, e nemmeno un NaN", () => {
    const ts = [0, 0.005, 0.01, 0.015, 0.02];
    const r = restFromRecording(ts, [250, 251, 249, 250, 252]);
    expect(r.finestre).toBe(0);
    expect(isFinite(r.base)).toBe(true);
  });

  it("senza campioni non inventa numeri", () => {
    const r = restFromRecording([], []);
    expect(isFinite(r.base)).toBe(false);
  });
});

describe("la nota è un'etichetta", () => {
  const p = {
    ts: Array.from({ length: 200 }, (_, i) => i / 50),
    m: Array.from({ length: 200 }, (_, i) => (i < 100 ? 60 : 67)),
    c: Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 0.2 : 0.9)),
  };
  it("mediana delle stime credibili nella finestra", () => {
    expect(noteAt(p, 0.8, 0, 1.9)).toBe(60);
    expect(noteAt(p, 0.8, 2.1, 3.9)).toBe(67);
  });
  it("fuori dalla finestra, o senza pitch, non dice niente", () => {
    expect(isFinite(noteAt(p, 0.8, 100, 200))).toBe(false);
    expect(isFinite(noteAt(null, 0.8, 0, 1))).toBe(false);
  });
});

describe("l'analisi: un rilevatore solo", () => {
  it("trova i passaggi tirati e nient'altro", () => {
    const an = analyze(song());
    expect(an.momenti.length).toBe(2);
    for (const m of an.momenti) {
      expect(m.zona).toBe("rosso");
      expect(m.val).toBeGreaterThan(ROSSO);
    }
    // E stanno dove sono stati messi, non un secondo dopo (vedi l'attribuzione
    // al centro della finestra in fatica.js).
    expect(an.momenti[0].t).toBeGreaterThan(36);
    expect(an.momenti[0].t).toBeLessThan(41);
  });

  it("su una presa senza difetti la lista è VUOTA, e lo dice", () => {
    // Il difetto peggiore della 5b: consegnava venti punti comunque, e il coach
    // imparava a non fidarsi della lista.
    const an = analyze(song({ tirati: [] }));
    expect(an.momenti).toEqual([]);
    expect(an.off).toMatch(/vuota/);
    expect(an.tempi.rosso).toBe(0);
    expect(an.tempi.verde).toBeGreaterThan(100);
  });

  it("un passaggio a metà strada è GIALLO, non rosso e non verde", () => {
    // È la zona che chi canta ha chiesto: costato più del normale, e forse va
    // bene così perché il passaggio è difficile.
    const an = analyze(song({ ampT: 3.4 }));       // 12 × 3,4 ≈ +41
    expect(an.momenti.length).toBe(2);
    for (const m of an.momenti) expect(m.zona).toBe("giallo");
    expect(an.tempi.rosso).toBe(0);
    expect(an.tempi.giallo).toBeGreaterThan(2);
  });

  it("il tempo in zona torna con la durata della registrazione", () => {
    const an = analyze(song());
    const t = an.tempi;
    expect(t.verde + t.giallo + t.rosso + t.muto).toBeCloseTo(120, 0);
    expect(t.rosso).toBeGreaterThan(2);
    expect(t.rosso).toBeLessThan(8);
  });

  it("funziona a microfono chiuso: la nota è un'etichetta, non un ingrediente", () => {
    const s = song();
    const conVoce = analyze(s);
    const senza = analyze({ ts: s.ts, vs: s.vs });
    expect(senza.momenti.length).toBe(conVoce.momenti.length);
    expect(senza.momenti.every((m) => !isFinite(m.m))).toBe(true);
    expect(conVoce.momenti.some((m) => isFinite(m.m))).toBe(true);
  });

  it("i momenti escono in ORDINE DI TEMPO, non di gravità", () => {
    // Si legge una canzone dall'inizio alla fine; il "quanto" è il numero
    // accanto, non la posizione in lista.
    const an = analyze(song({ tirati: [24.8, 36.8, 90.8] }));
    for (let i = 1; i < an.momenti.length; i++) {
      expect(an.momenti[i].t).toBeGreaterThan(an.momenti[i - 1].t);
    }
  });

  it("ogni momento porta il suo numero, la sua zona e la sua durata", () => {
    for (const m of analyze(song()).momenti) {
      expect(isFinite(m.val)).toBe(true);
      expect([ "verde", "giallo", "rosso" ]).toContain(m.zona);
      expect(m.t1 - m.t0).toBeGreaterThan(1);
      expect(m.t).toBeGreaterThanOrEqual(m.t0);
      expect(m.t).toBeLessThanOrEqual(m.t1);
    }
  });

  it("due campioni non producono momenti, e non un errore", () => {
    const an = analyze({ ts: [0, 0.1], vs: [1, 2] });
    expect(an.momenti).toEqual([]);
    expect(an.off).toMatch(/pochi/);
  });

  it("una registrazione più corta della finestra di lettura lo dice", () => {
    const s = song({ secs: 2.5 });
    const an = analyze({ ts: s.ts, vs: s.vs });
    expect(an.momenti).toEqual([]);
    expect(an.off).toMatch(/tre secondi/);
  });

  it("le zone stanno dove le ha messe la registrazione del 4 settembre", () => {
    // Se qualcuno sposta i confini, questo test lo dice: sono tarati su due
    // eventi etichettati, e spostarli è una decisione, non una rifinitura.
    expect(VERDE).toBe(30);
    expect(ROSSO).toBe(55);
  });
});

describe("su che intervallo si guarda", () => {
  it("con una registrazione è quella, e nient'altro", () => {
    const r = pickRange({ first: 0, end: 500, rec: { t0: 120, t1: 400 }, calEnd: 60 });
    expect(r.t0).toBe(120);
    expect(r.t1).toBe(400);
    expect(r.rec).toBe(true);
    expect(r.da).toBe("registrazione");
  });

  it("senza registrazione ma con la calibrazione, si parte da dopo di lei", () => {
    const r = pickRange({ first: 0, end: 300, rec: null, calEnd: 90 });
    expect(r.t0).toBe(92);              // 90 + CAL_GAP
    expect(r.rec).toBe(false);
    expect(r.da).toBe("dopo la calibrazione");
  });

  it("una registrazione troppo corta non conta", () => {
    const r = pickRange({ first: 0, end: 300, rec: { t0: 100, t1: 102 }, calEnd: 90 });
    expect(r.da).toBe("dopo la calibrazione");
  });

  it("se dopo la calibrazione non c'è niente, si guarda tutto e si dice", () => {
    const r = pickRange({ first: 0, end: 95, rec: null, calEnd: 90 });
    expect(r.da).toBe("tutto quello in memoria");
    expect(r.t0).toBe(0);
  });

  it("niente registrazione e niente calibrazione: tutto quello in memoria", () => {
    const r = pickRange({ first: 10, end: 300 });
    expect(r.da).toBe("tutto quello in memoria");
    expect(r.t0).toBe(10);
    expect(pickRange({ first: 5, end: 300, calEnd: 0 }).t0).toBe(5);
  });

  it("senza campioni non c'è intervallo", () => {
    expect(pickRange({ first: 0, end: 0 })).toBe(null);
    expect(pickRange()).toBe(null);
  });
});

describe("mm:ss e le chiavi della curatela", () => {
  it("mm:ss", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(9.4)).toBe("0:09");
    expect(mmss(134)).toBe("2:14");
    expect(mmss(-5)).toBe("0:00");
  });
  it("la chiave sopravvive a un ricalcolo", () => {
    expect(markKey({ t: 134.0001 })).toBe(markKey({ t: 134.0002 }));
    expect(markKey({ t: 134 })).not.toBe(markKey({ t: 135 }));
  });
});

describe("quello che esce dall'app", () => {
  const marks = [
    { zona: "rosso", t: 134.2, t0: 134, t1: 136, val: 68.4, m: 64.2 },
    { zona: "giallo", t: 12.5, t0: 12.2, t1: 12.8, val: 34.1, m: NaN, scelta: "drop" },
  ];

  it("il .vtt esce in ordine, con i tempi del video", () => {
    const v = marksVtt(marks, { tFrom: 10, label: (m) => `${m.zona} +${m.val.toFixed(0)}` });
    const lines = v.split("\n");
    expect(lines[0]).toBe("WEBVTT");
    expect(v.indexOf("giallo")).toBeLessThan(v.indexOf("rosso"));
    expect(v).toContain("giallo +34");
    expect(v).toContain("00:00:02.200 --> 00:00:03.700");     // 12.2−10, allungato a 1.5 s
    expect(v).toContain("00:02:04.000 --> 00:02:06.000");
  });

  it("senza etichetta esplicita il .vtt scrive la zona", () => {
    expect(marksVtt(marks, { tFrom: 0 })).toContain("rosso");
  });

  it("chi è nato prima dell'inizio del video non c'è", () => {
    const v = marksVtt(marks, { tFrom: 100 });
    expect(v).not.toContain("giallo");
    expect(v).toContain("rosso");
  });

  it("il .json porta la curatela, il numero e la zona", () => {
    const o = JSON.parse(marksJson(marks, {
      riposo: { base: 250 }, misura: { finestra_s: 2, verde: VERDE, rosso: ROSSO },
    }));
    expect(o.versione).toBe(1);
    expect(o.riposo.base).toBe(250);
    // Le costanti con cui i numeri sono stati prodotti: senza, fra un anno un
    // file esportato non si saprebbe più leggere, perché i confini si sposteranno.
    expect(o.misura.verde).toBe(VERDE);
    expect(o.momenti[0].zona).toBe("giallo");
    expect(o.momenti[0].val).toBe(34.1);
    expect(o.momenti[0].scelta).toBe("drop");
    expect(o.momenti[0].nota).toBe(null);
    expect(o.momenti[1].nota).toBe(64.2);
    expect(o.momenti[1].val).toBe(68.4);
  });

  it("il CSV del pitch ha le tre colonne", () => {
    const p = new PitchStore(8);
    p.push(1, 60.5, 0.9);
    p.push(1.02, 61, 0.4);
    const rows = pitchCsv(p).trim().split("\n");
    expect(rows[0]).toBe("t_s,midi,clarity");
    expect(rows[1]).toBe("1.000000,60.5000,0.9000");
    expect(rows.length).toBe(3);
  });
});
