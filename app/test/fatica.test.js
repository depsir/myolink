import { describe, expect, it } from "vitest";
import { Store } from "../src/core/store.js";
import {
  MIN_S, ROSSO, VERDE, WIN, ZERO_MIN, faticaOra, faticaSerie, tempiInZona,
  tratti, zeroVivo, zona,
} from "../src/core/fatica.js";

// Lo stesso LCG dei test della calibrazione: un test su una soglia non può
// passare e fallire a caso.
function prng(seed = 1) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

const HZ = 100, BASE = 251;

// Una traccia con un livello a gradini, sopra un riposo rumoroso come quello
// vero: 6 count picco-picco di dentellìo e l'ondulazione respiratoria, che è la
// ragione per cui il livello si legge con una mediana e non con una media.
function traccia(gradini, { secs = 60, hz = HZ, seed = 3 } = {}) {
  const r = prng(seed);
  const ts = [], vs = [];
  for (let i = 0; i < Math.round(secs * hz); i++) {
    const t = i / hz;
    let v = BASE + 4 * Math.sin(2 * Math.PI * t / 4) + 6 * (r() - 0.5);
    for (const [a, b, amp] of gradini) if (t >= a && t < b) v += amp;
    ts.push(t); vs.push(Math.round(v));
  }
  return { ts, vs };
}

describe("le tre zone", () => {
  it("i confini stanno dove li ha messi la registrazione, e sono inclusivi in basso", () => {
    expect(zona(0)).toBe("verde");
    expect(zona(VERDE - 0.01)).toBe("verde");
    expect(zona(VERDE)).toBe("giallo");
    expect(zona(ROSSO - 0.01)).toBe("giallo");
    expect(zona(ROSSO)).toBe("rosso");
  });
  it("i due passaggi etichettati del 4 settembre cadono dove devono", () => {
    expect(zona(24)).toBe("verde");      // "spinge ma va bene", mediana +24
    expect(zona(32)).toBe("giallo");     // il suo picco
    expect(zona(47)).toBe("giallo");     // il peggior passaggio di "call me a dog"
    expect(zona(68)).toBe("rosso");      // la strofa sbagliata
  });
  it("senza misura la zona è NULL e non verde", () => {
    // Distinzione che sul grafico si vede: i primi due secondi non sono buoni,
    // sono senza lettura, e dipingerli di verde sarebbe una bugia.
    expect(zona(NaN)).toBe(null);
    expect(zona(undefined)).toBe(null);
  });
});

describe("la misura: due mediane e una sottrazione", () => {
  it("legge il gradino che c'è, in count sopra il riposo", () => {
    const { ts, vs } = traccia([[20, 30, 40]]);
    const f = faticaSerie(ts, vs, BASE);
    // A 29 s la finestra da 2 s è tutta dentro il gradino.
    const i = ts.findIndex((t) => t >= 29);
    expect(f[i]).toBeGreaterThan(37);
    expect(f[i]).toBeLessThan(43);
    // E fuori dal gradino torna a zero.
    expect(Math.abs(f[ts.findIndex((t) => t >= 15)])).toBeLessThan(3);
  });

  it("i primi due secondi non hanno una lettura, e non un valore basso", () => {
    const { ts, vs } = traccia([]);
    const f = faticaSerie(ts, vs, BASE);
    expect(f.slice(0, WIN * HZ - 2).every((x) => !isFinite(x))).toBe(true);
    expect(isFinite(f[WIN * HZ + 5])).toBe(true);
  });

  it("un bozzo da mezzo secondo non fa fatica: la finestra è di due", () => {
    // È la ragione per cui la finestra è lunga: un attacco di frase non è fatica.
    const corto = faticaSerie(...Object.values(traccia([[20, 20.5, 60]])), BASE);
    const lungo = faticaSerie(...Object.values(traccia([[20, 24, 60]])), BASE);
    const at = (f, t) => f[Math.round(t * HZ)];
    expect(at(corto, 20.6)).toBeLessThan(VERDE);
    expect(at(lungo, 23.5)).toBeGreaterThan(ROSSO);
  });

  it("senza uno zero non inventa un numero", () => {
    const { ts, vs } = traccia([]);
    expect(faticaSerie(ts, vs, NaN).every((x) => !isFinite(x))).toBe(true);
  });
});

describe("dal vivo, sulla coda del ring", () => {
  const ring = (ts, vs) => { const s = new Store(); for (let i = 0; i < ts.length; i++) s.push(ts[i], vs[i]); return s; };

  it("dà lo stesso numero che darebbe la serie sull'ultimo campione", () => {
    const { ts, vs } = traccia([[20, 40, 35]], { secs: 40 });
    const s = ring(ts, vs);
    const f = faticaSerie(ts, vs, BASE);
    expect(faticaOra(s, BASE)).toBeCloseTo(f[f.length - 1], 6);
  });

  it("con meno di due secondi in memoria tace", () => {
    const { ts, vs } = traccia([], { secs: 1.5 });
    expect(isFinite(faticaOra(ring(ts, vs), BASE))).toBe(false);
    expect(isFinite(faticaOra(new Store(), BASE))).toBe(false);
  });
});

describe("lo zero, senza chiedere niente a nessuno", () => {
  it("trova il riposo anche sotto un canto quasi continuo", () => {
    // Frasi da 4 s ogni 5: un secondo di pausa, che è quello che una canzone
    // concede davvero. Il 5° percentile ci arriva; una media no.
    //
    // Il confronto è con lo zero trovato sul SILENZIO della stessa traccia, non
    // con `BASE`: un percentile basso su un riposo che respira sta un paio di
    // count sotto la mediana, e la promessa è che il canto sopra non lo sposti —
    // che è esattamente ciò che si misura sui samples (251,0 su tutte e quattro
    // le registrazioni, silenzio compreso).
    const gradini = [];
    for (let t = 0; t < 120; t += 5) gradini.push([t + 0.5, t + 4.5, 28]);
    const cantato = traccia(gradini, { secs: 120 });
    const muto = traccia([], { secs: 120 });
    const scarto = zeroVivo(ring(cantato.ts, cantato.vs)) - zeroVivo(ring(muto.ts, muto.vs));
    // Qualche count, non qualche decina: col 20% di pause il 5° percentile cade
    // più in alto dentro la distribuzione del riposo, e questo è tutto lo scarto
    // che produce. Sui samples veri, dove le pause sono di più, è zero.
    expect(Math.abs(scarto)).toBeLessThan(3);
    // E soprattutto non è il livello del canto, che è quello che sbaglierebbe
    // una media o una mediana della registrazione intera.
    expect(zeroVivo(ring(cantato.ts, cantato.vs))).toBeLessThan(BASE + 10);
  });

  it("con poca storia non risponde: sarebbe la frase più piana", () => {
    const { ts, vs } = traccia([], { secs: ZERO_MIN - 2 });
    expect(isFinite(zeroVivo(ring(ts, vs)))).toBe(false);
  });

  const ring = (ts, vs) => { const s = new Store(); for (let i = 0; i < ts.length; i++) s.push(ts[i], vs[i]); return s; };
});

describe("i tratti fuori dal verde", () => {
  it("su una presa tenuta nel verde la lista è VUOTA", () => {
    // Era il difetto peggiore della 5b: venti punti comunque, anche su una
    // performance senza un difetto.
    const { ts, vs } = traccia([[20, 40, 18]]);
    expect(tratti(ts, faticaSerie(ts, vs, BASE))).toEqual([]);
  });

  it("trova il tratto, col suo picco e la sua zona", () => {
    const { ts, vs } = traccia([[20, 32, 70]]);
    const t = tratti(ts, faticaSerie(ts, vs, BASE));
    expect(t.length).toBe(1);
    expect(t[0].zona).toBe("rosso");
    expect(t[0].val).toBeGreaterThan(60);
  });

  it("il tratto è attribuito al CENTRO della finestra, non alla sua fine", () => {
    // Il valore a t descrive [t-2s, t]: senza questa correzione il punto
    // comparirebbe un secondo dopo la battuta che descrive, e su un video si
    // andrebbe a riguardare il posto sbagliato.
    const { ts, vs } = traccia([[20, 32, 70]]);
    const t = tratti(ts, faticaSerie(ts, vs, BASE))[0];
    expect(t.t0).toBeGreaterThan(19.5);
    expect(t.t0).toBeLessThan(22);
    expect(t.t1).toBeGreaterThan(30);
    expect(t.t1).toBeLessThan(32.5);
  });

  it("l'isteresi non spezza un tratto in tre", () => {
    // Una tacca in mezzo che scende sotto la soglia di scatto ma non sotto
    // quella di uscita: un tratto solo, non tre.
    const { ts, vs } = traccia([[20, 26, 45], [26, 27, 24], [27, 34, 45]]);
    expect(tratti(ts, faticaSerie(ts, vs, BASE)).length).toBe(1);
  });

  it("sotto la durata minima non è un momento", () => {
    const ts = Array.from({ length: 400 }, (_, i) => i / HZ);
    const f = ts.map((t) => (t > 1 && t < 1 + MIN_S * 0.5 ? 80 : 5));
    expect(tratti(ts, f)).toEqual([]);
  });

  it("un NaN chiude il tratto invece di prolungarlo", () => {
    // Un buco nei dati non è un livello basso e non è nemmeno una continuazione:
    // di là dal buco comincia un altro tratto.
    const ts = Array.from({ length: 900 }, (_, i) => i / HZ);
    const f = ts.map((t) => (t < 1 ? 5 : t > 4 && t < 4.5 ? NaN : 80));
    expect(tratti(ts, f).length).toBe(2);
  });
});

describe("il tempo in ciascuna zona", () => {
  it("somma i secondi, non i campioni", () => {
    const { ts, vs } = traccia([[20, 40, 70]], { secs: 60 });
    const z = tempiInZona(ts, faticaSerie(ts, vs, BASE));
    expect(z.rosso).toBeGreaterThan(16);
    expect(z.rosso).toBeLessThan(21);
    expect(z.verde).toBeGreaterThan(30);
    // I primi due secondi non stanno in nessuna zona: non c'è misura.
    expect(z.muto).toBeGreaterThan(1.5);
    expect(z.verde + z.giallo + z.rosso + z.muto).toBeCloseTo(ts[ts.length - 1] - ts[0], 1);
  });

  it("un buco di pacchetti non conta come tempo cantato", () => {
    const ts = [0, 0.01, 0.02, 30, 30.01], f = [1, 1, 1, 1, 1];
    expect(tempiInZona(ts, f).verde).toBeLessThan(0.1);
  });
});
