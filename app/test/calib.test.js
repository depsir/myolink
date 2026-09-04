import { describe, expect, it } from "vitest";
import { Store } from "../src/core/store.js";
import {
  ADC_FULL, blockMeans, blockSummary, buildCal, bursts, level, levelSigma,
  median, medianSince, movMedian, movingMean, noiseSigma, norm, parseCal, quantile,
  restStats, sliceRing, slowness, snr, verdict, worst,
} from "../src/core/calib.js";

// LCG: il rumore nei blocchi finti deve essere lo stesso a ogni corsa, o un test
// sulle soglie passa e fallisce a caso.
function prng(seed = 1) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

// Un blocco come lo raccoglie la procedura: ts a passo costante, vs dalla forma.
function block(secs, hz, fn) {
  const ts = [], vs = [];
  for (let i = 0; i < Math.round(secs * hz); i++) { ts.push(i / hz); vs.push(fn(i / hz, i)); }
  return { ts, vs };
}

const HZ = 100, BASE = 300;

// Riposo: base, rumore, e l'ondulazione respiratoria — che sull'addome c'è
// sempre e non è un difetto del finto.
function restBlock(secs = 10, drift = 0, seed = 7) {
  const r = prng(seed);
  return block(secs, HZ, (t) =>
    BASE + 5 * Math.sin(2 * Math.PI * t / 4) + 10 * (r() - 0.5) + drift * (t / secs));
}

// Massimo funzionale: salita, plateau, discesa.
function maxBlock(peak, secs = 4, seed = 11) {
  const r = prng(seed);
  return block(secs, HZ, (t) => {
    const k = t < 0.6 ? t / 0.6 : t > secs - 0.6 ? (secs - t) / 0.6 : 1;
    return BASE + peak * Math.max(0, Math.min(1, k)) + 12 * (r() - 0.5);
  });
}

// Cinque "HA!": triangoli, 0.1 s di salita e 0.25 s di discesa, uno ogni 1.5 s.
function haBlock(n = 5, peak = 900, seed = 3) {
  const r = prng(seed);
  return block(10, HZ, (t) => {
    let v = BASE + 10 * (r() - 0.5);
    for (let k = 0; k < n; k++) {
      const d = t - (0.7 + 1.5 * k);
      if (d >= 0 && d < 0.1) v += peak * (d / 0.1);
      else if (d >= 0.1 && d < 0.35) v += peak * (1 - (d - 0.1) / 0.25);
    }
    return v;
  });
}

// Il montaggio cattivo VERO: la linea di base vaga, e vagare non si media via.
// Abbastanza veloce da non essere deriva (le due metà hanno la stessa mediana),
// abbastanza lento da sopravvivere a una media su 200 ms.
function wanderRestBlock(amp = 45, hz = 0.8, seed = 31) {
  const r = prng(seed);
  return block(10, HZ, (t) => BASE + amp * Math.sin(2 * Math.PI * hz * t) + 10 * (r() - 0.5));
}

// Dentellìo per campione, che invece si media via: è il caso che l'SNR vecchio
// bocciava a torto.
function jagged(blocks, amp = 120, seed = 41) {
  const r = prng(seed);
  const add = (b) => ({ ts: b.ts, vs: Array.from(b.vs, (v) => v + amp * (r() - 0.5)) });
  return Object.fromEntries(Object.entries(blocks).map(([k, segs]) => [k, segs.map(add)]));
}

// L'errore da diagnosticare: nel blocco del massimo si dà un COLPO invece di un
// tenuto. Un triangolo da 200 ms in quattro secondi di riposo.
function spikeMaxBlock(peak = 1500, seed = 21) {
  const r = prng(seed);
  return block(4, HZ, (t) => {
    const d = t - 1.5;
    const k = d >= 0 && d < 0.1 ? d / 0.1 : d >= 0.1 && d < 0.2 ? 1 - (d - 0.1) / 0.1 : 0;
    return BASE + peak * k + 10 * (r() - 0.5);
  });
}

// Frase cantata: silenzio, poi appoggio che sale piano, poi silenzio.
function rifBlock(lev = 400, seed = 5) {
  const r = prng(seed);
  return block(8, HZ, (t) => {
    const on = t > 1.2 && t < 6.8;
    return BASE + (on ? lev * (0.85 + 0.3 * (t - 1.2) / 5.6) : 0) + 10 * (r() - 0.5);
  });
}

const fullBlocks = () => ({
  rest: [restBlock()],
  max: [maxBlock(1500), maxBlock(1450, 4, 12), maxBlock(1550, 4, 13)],
  ha: [haBlock()],
  rif: [rifBlock()],
});

describe("statistiche robuste", () => {
  it("median e quantile interpolano fra i campioni adiacenti", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 1, 2, 3, 4], 0.9)).toBeCloseTo(3.6, 6);
    expect(median([])).toBeNaN();
  });

  it("noiseSigma non si muove per un artefatto isolato", () => {
    const a = [10, 10, 11, 10, 9, 10, 11, 9, 10, 10];
    expect(noiseSigma([...a, 4000, 10])).toBeCloseTo(noiseSigma(a), 6);
    expect(noiseSigma([1])).toBeNaN();
  });

  // Il difetto che i test hanno trovato: misurato sui valori, il rumore si
  // gonfia con la deriva quanto basta a nascondere la deriva stessa.
  it("noiseSigma è cieco alla deriva lenta, che è il punto", () => {
    const piatto = restBlock(10, 0), scivolato = restBlock(10, 80);
    expect(noiseSigma(scivolato.vs)).toBeCloseTo(noiseSigma(piatto.vs), 0);
  });
});

// La distinzione che una sessione vera ha imposto: "quanto è dentellata la
// traccia" e "riesco a distinguere due livelli" sono due numeri diversi, e le
// soglie vivono sul secondo.
describe("levelSigma", () => {
  it("le finestre sono disgiunte, non sovrapposte", () => {
    const { ts, vs } = block(1, 100, (t) => (t < 0.5 ? 0 : 10));
    const b = blockMeans(ts, vs, 0.2);
    expect(b.length).toBe(5);
    expect(b[0]).toBe(0);
    expect(b[4]).toBe(10);
  });

  it("il dentellìo si media via, il vagare no", () => {
    const jag = jagged({ rest: [restBlock()] }).rest[0];
    const wan = wanderRestBlock();
    // Per campione il dentellato è molto più rumoroso del vagante...
    expect(noiseSigma(jag.vs)).toBeGreaterThan(3 * noiseSigma(wan.vs));
    // ...ma sulla lettura a 200 ms si ribalta, ed è quello che conta.
    expect(levelSigma(jag.ts, jag.vs)).toBeLessThan(levelSigma(wan.ts, wan.vs));
  });

  it("su un blocco troppo corto ripiega sul rumore per campione", () => {
    const { ts, vs } = block(0.3, HZ, () => 42);
    expect(levelSigma(ts, vs)).toBe(noiseSigma(vs));
  });
});

describe("movingMean", () => {
  it("scarta le finestre non ancora piene", () => {
    const { ts, vs } = block(1, 10, () => 5);
    // 1 s a 10 Hz con finestra 0.5 s: le prime 5 finestre sono parziali.
    expect(movingMean(ts, vs, 0.5).length).toBe(5);
    expect(movingMean(ts, vs, 0.5).every((x) => x === 5)).toBe(true);
  });

  it("la finestra è di TEMPO, quindi un buco non conta come campioni", () => {
    // Un pacchetto perso: cinque secondi senza niente in mezzo.
    const ts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 5.0, 5.1];
    const vs = [1, 1, 1, 1, 1, 1, 100, 100];
    const m = movingMean(ts, vs, 0.5);
    // Dopo il buco la finestra contiene solo i campioni nuovi: 100, non la media
    // fra 100 e gli 1 di cinque secondi prima.
    expect(m[m.length - 1]).toBe(100);
  });
});

describe("level", () => {
  it("il plateau è il plateau, non il picco né la media", () => {
    const { ts, vs } = maxBlock(1500);
    const p = level(ts, vs, { winS: 1, q: 0.9 });
    expect(p).toBeGreaterThan(BASE + 1400);
    expect(p).toBeLessThan(BASE + 1520);
    // La media secca sta sotto: dentro ci sono la salita e la discesa.
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    expect(mean).toBeLessThan(p);
  });

  it("il pavimento tiene fuori il silenzio prima dell'attacco", () => {
    const { ts, vs } = rifBlock(400);
    const senza = level(ts, vs, { winS: 0.5, q: 0.5 });
    const con = level(ts, vs, { winS: 0.5, q: 0.5, floor: BASE + 30 });
    expect(con).toBeGreaterThan(senza);
    expect(con).toBeGreaterThan(BASE + 380);
  });

  it("su un blocco più corto della finestra ripiega sui campioni grezzi", () => {
    const { ts, vs } = block(0.3, HZ, () => 42);
    expect(level(ts, vs, { winS: 1 })).toBe(42);
  });
});

describe("restStats", () => {
  it("la base è robusta a una contrazione dentro il riposo", () => {
    const b = restBlock();
    const pulito = restStats(b.ts, b.vs).base;
    for (let i = 200; i < 260; i++) b.vs[i] += 1200;      // 0.6 s di artefatto
    // 1200 count su un campione ogni sedici muovono lo zero di meno di uno.
    expect(Math.abs(restStats(b.ts, b.vs).base - pulito)).toBeLessThan(1);
  });

  it("vede la deriva del contatto e non la confonde col rumore", () => {
    const fermo = restBlock(10, 0);
    const scivolato = restBlock(10, 60);
    expect(Math.abs(restStats(fermo.ts, fermo.vs).drift)).toBeLessThan(3);
    expect(restStats(scivolato.ts, scivolato.vs).drift).toBeGreaterThan(20);
  });
});

describe("bursts", () => {
  const r = restStats(restBlock().ts, restBlock().vs);

  it("trova i cinque accenti e ne misura la forma", () => {
    const b = haBlock(5, 900);
    const list = bursts(b.ts, b.vs, r);
    expect(list.length).toBe(5);
    // La salita è dalla soglia BASSA al picco, non dall'onset vero: su un
    // triangolo di 100 ms viene un po' più corta, ed è coerente fra accenti.
    for (const x of list) {
      expect(x.picco).toBeGreaterThan(BASE + 850);
      expect(x.salita).toBeGreaterThan(0.06);
      expect(x.salita).toBeLessThan(0.1);
      expect(x.durata).toBeGreaterThan(0.25);
      expect(x.durata).toBeLessThan(0.32);
    }
  });

  it("su un blocco in cui non si è fatto niente non inventa accenti", () => {
    const b = restBlock(10);
    expect(bursts(b.ts, b.vs, restStats(b.ts, b.vs)).length).toBe(0);
  });
});

describe("buildCal e norm", () => {
  it("mette insieme i quattro blocchi e dà una scala con uno zero e un uno", () => {
    const cal = buildCal(fullBlocks(), { hz: HZ, t: 1000 });
    expect(cal.ready).toBe(true);
    expect(Math.abs(cal.base - BASE)).toBeLessThan(2);
    // Mediana delle tre prove: quella di mezzo, non la più alta.
    expect(cal.max).toBeGreaterThan(BASE + 1450);
    expect(cal.max).toBeLessThan(BASE + 1560);
    expect(cal.rif).toBeGreaterThan(BASE + 380);
    expect(cal.burst.n).toBe(5);

    // È questo che rende configurabile una soglia: il riposo vale 0 e il
    // riferimento vale 1, su qualunque persona e qualunque guadagno.
    expect(norm(cal.base, cal, "rif")).toBe(0);
    expect(norm(cal.rif, cal, "rif")).toBeCloseTo(1, 6);
    expect(norm(cal.max, cal, "max")).toBeCloseTo(1, 6);
    // Sotto il riposo non c'è attivazione negativa: c'è rumore.
    expect(norm(cal.base - 500, cal, "rif")).toBe(0);
    expect(norm(1, { ready: false })).toBeNaN();
  });

  it("senza un blocco non è pronta, invece di produrre numeri finti", () => {
    const b = fullBlocks();
    delete b.rif;
    expect(buildCal(b).ready).toBe(false);
    expect(buildCal({}).ready).toBe(false);
  });

  // Un denominatore debole spegne SOLO la sua scala. È il caso vero: sull'obliquo
  // esterno il tenuto volontario può essere piccolo e l'appoggio del canto comodo
  // lo è quasi sempre, e prima questo spegneva ogni lettura.
  it("un tenuto debole spegne %max e lascia in piedi il resto", () => {
    const b = fullBlocks();
    b.max = [restBlock(4)];
    const cal = buildCal(b, { hz: HZ });
    expect(cal.measured).toBe(true);
    expect(cal.ready).toBe(true);         // il riposo è buono: si legge
    expect(cal.hasMax).toBe(false);
    expect(cal.hasRif).toBe(true);
    expect(norm(cal.rif, cal, "max")).toBeNaN();
    expect(norm(cal.rif, cal, "rif")).toBeCloseTo(1, 6);
    const v = verdict(cal);
    expect(v.some((x) => /%max resta spenta/.test(x.msg))).toBe(true);
    expect(worst(v)).toBe("warn");        // avviso, non errore
  });

  it("un appoggio debole spegne ×rif e lascia in piedi %max", () => {
    const b = fullBlocks();
    b.rif = [restBlock(8)];
    const cal = buildCal(b, { hz: HZ });
    expect(cal.hasRif).toBe(false);
    expect(cal.hasMax).toBe(true);
    expect(norm(cal.max, cal, "rif")).toBeNaN();
    expect(norm(cal.max, cal, "max")).toBeCloseTo(1, 6);
    expect(verdict(cal).some((x) => /×rif resta spenta/.test(x.msg))).toBe(true);
  });

  // La scala che non chiede nessun gesto: serve al caso in cui entrambi i tetti
  // sono deboli, che è dove ci si è trovati davvero.
  it("la scala in sigma del riposo c'è sempre", () => {
    const b = fullBlocks();
    b.max = [restBlock(4)]; b.rif = [restBlock(8)];
    const cal = buildCal(b, { hz: HZ });
    expect(cal.hasMax).toBe(false);
    expect(cal.hasRif).toBe(false);
    expect(norm(cal.base + 10 * cal.noiseLvl, cal, "sigma")).toBeCloseTo(10, 6);
    expect(norm(cal.base - 100, cal, "sigma")).toBe(0);
  });
});

// Il tenuto e il colpo sono due tetti diversi, e confonderli era il modo in cui
// questo blocco falliva senza spiegarsi: la finestra da 1 s diluisce un colpo di
// cinque volte, il "massimo" scende vicino al rumore e il sintomo che si vedeva
// era "il riferimento è più alto del massimo".
describe("tenuto contro colpo", () => {
  it("un colpo nel blocco del massimo viene riconosciuto come tale", () => {
    const b = fullBlocks();
    b.max = [spikeMaxBlock(), spikeMaxBlock(1450, 22), spikeMaxBlock(1550, 23)];
    const cal = buildCal(b, { hz: HZ });
    expect(cal.bursty).toBe(true);
    // A finestra corta il colpo si vede quasi tre volte più alto che a finestra
    // da 1 s. Non cinque, che sarebbe il rapporto delle durate: il percentile a
    // 0.95 cade sul bordo del gruppo di finestre che contengono il colpo, non sul
    // suo centro — è comunque un discriminante larghissimo.
    expect(cal.maxShort - cal.base).toBeGreaterThan(2.5 * (cal.max - cal.base));
    const v = verdict(cal);
    expect(worst(v)).toBe("bad");
    expect(v.some((x) => /COLPO, non un tenuto/.test(x.msg))).toBe(true);
  });

  it("un tenuto vero non viene preso per un colpo", () => {
    const cal = buildCal(fullBlocks(), { hz: HZ });
    expect(cal.bursty).toBe(false);
    // Su un plateau le due finestre dicono quasi lo stesso.
    expect(cal.maxShort / cal.max).toBeLessThan(1.1);
  });
});

describe("blockSummary", () => {
  const rest = restStats(restBlock().ts, restBlock().vs);

  it("dà una riga per blocco, con i numeri che servono a capire quale rifare", () => {
    const b = fullBlocks();
    expect(blockSummary("rest", b.rest)).toMatch(/^riposo 30\d ±\d/);
    expect(blockSummary("max", b.max)).toMatch(/^tenuto \d+ \/ \d+ \/ \d+$/);
    expect(blockSummary("ha", b.ha, rest)).toMatch(/^5 accenti · picco \d+ · salita \d+ ms$/);
    expect(blockSummary("rif", b.rif, rest)).toMatch(/^appoggio \d+$/);
  });

  it("tace su quello che non può ancora dire, invece di stampare numeri senza base", () => {
    expect(blockSummary("ha", fullBlocks().ha, null)).toBe("");
    expect(blockSummary("rest", [])).toBe("");
    expect(blockSummary("rest", undefined)).toBe("");
  });
});

describe("verdict", () => {
  it("su un montaggio buono dice ok e nient'altro", () => {
    const v = verdict(buildCal(fullBlocks(), { hz: HZ }), { hzNow: HZ });
    expect(worst(v)).toBe("ok");
    expect(v.length).toBe(1);
  });

  // Un montaggio cattivo lo è in TUTTO: se gli accenti vengono grossi, il sensore
  // il muscolo lo sente, e dirlo mal posizionato sarebbe falso.
  it("SNR basso: è il caso degli elettrodi mal posizionati, ed è bad", () => {
    const b = fullBlocks();
    b.rest = [wanderRestBlock()];
    b.max = [maxBlock(30), maxBlock(28, 4, 12), maxBlock(32, 4, 13)];
    b.ha = [haBlock(5, 40)];
    b.rif = [rifBlock(12)];
    const cal = buildCal(b, { hz: HZ });
    expect(snr(cal)).toBeLessThan(10);
    expect(worst(verdict(cal))).toBe("bad");
    expect(verdict(cal)[0].msg).toMatch(/obliquo/);
    // E dice anche perché non si salva filtrando: il disturbo è troppo lento.
    expect(slowness(cal)).toBeGreaterThan(0.8);
    expect(verdict(cal).some((x) => /troppo lento perché la mediana/.test(x.msg))).toBe(true);
  });

  // Il caso opposto, che è quello della prima registrazione vera: accenti grossi e
  // tenuto piccolo. Il sensore c'è, e il verdetto non deve dire il contrario.
  it("accenti grossi e tenuto piccolo: il sensore sente, e l'SNR lo dice", () => {
    const b = fullBlocks();
    b.max = [maxBlock(46), maxBlock(50, 4, 12), maxBlock(36, 4, 13)];
    b.ha = [haBlock(5, 808)];
    b.rif = [rifBlock(60)];
    const cal = buildCal(b, { hz: HZ });
    expect(cal.peak - cal.base).toBeGreaterThan(6 * (cal.max - cal.base));
    expect(snr(cal)).toBeGreaterThan(20);
    const v = verdict(cal, { hzNow: HZ });
    expect(v[0].level).toBe("ok");
    expect(v.some((x) => /volte più su del tenuto/.test(x.msg))).toBe(true);
    expect(v.some((x) => /il tenuto sta in/.test(x.msg))).toBe(true);
  });

  // Il difetto che la prima sessione vera ha fatto emergere: l'SNR misurato sul
  // rumore per campione bocciava un montaggio in cui le differenze si vedevano
  // benissimo a occhio, perché l'inviluppo era dentellato.
  it("un inviluppo dentellato ma mediabile NON è un montaggio cattivo", () => {
    const cal = buildCal(jagged(fullBlocks()), { hz: HZ });
    expect(cal.noise).toBeGreaterThan(3 * cal.noiseLvl);   // il filtro lo toglie
    expect(slowness(cal)).toBeLessThan(0.8);
    expect(cal.ready).toBe(true);
    expect(snr(cal)).toBeGreaterThan(20);
    expect(worst(verdict(cal, { hzNow: HZ }))).toBe("ok");
  });

  // La promessa "alza il guadagno e l'SNR sale" vale solo se il rumore misurato è
  // vicino al pavimento del convertitore. Sopra, il guadagno compra risoluzione e
  // non rapporto — e dirlo sbagliato manda a girare una vite per niente.
  it("un'escursione piccola è un problema di guadagno, con la condizione giusta", () => {
    const small = (peak, seed, noise) => {
      const r = prng(seed);
      return block(4, HZ, (t) => {
        const k = t < 0.6 ? t / 0.6 : t > 4 - 0.6 ? (4 - t) / 0.6 : 1;
        return BASE + peak * Math.max(0, Math.min(1, k)) + noise * (r() - 0.5);
      });
    };
    const mk = (noise) => {
      const r = prng(77);
      return buildCal({
        rest: [block(10, HZ, () => BASE + noise * (r() - 0.5))],
        max: [small(150, 11, noise), small(140, 12, noise), small(160, 13, noise)],
        ha: [haBlock(5, 700)],
        rif: [rifBlock(60)],
      }, { hz: HZ });
    };
    // Rumore per campione sotto il pavimento dell'ADC: il guadagno serve davvero.
    const vLow = verdict(mk(2));
    expect(vLow.some((x) => /l'SNR sale con lui/.test(x.msg))).toBe(true);
    // Rumore ben sopra: il guadagno recupera risoluzione, non rapporto.
    const vHigh = verdict(mk(60));
    expect(vHigh.some((x) => /non SNR/.test(x.msg))).toBe(true);
  });

  it("il fondo scala è bad, perché sottostima il tetto in silenzio", () => {
    const b = fullBlocks();
    b.max = b.max.map((m) => ({ ts: m.ts, vs: m.vs.map((v) => Math.min(v * 4, ADC_FULL)) }));
    const v = verdict(buildCal(b, { hz: HZ }));
    expect(worst(v)).toBe("bad");
    expect(v.some((x) => /fondo scala/.test(x.msg))).toBe(true);
  });

  it("la deriva del riposo e la cadenza cambiata sono avvisi, non errori", () => {
    const b = fullBlocks();
    b.rest = [restBlock(10, 80)];
    const v = verdict(buildCal(b, { hz: 20 }), { hzNow: 100 });
    expect(worst(v)).toBe("warn");
    expect(v.some((x) => /scivolata/.test(x.msg))).toBe(true);
    expect(v.some((x) => /Hz/.test(x.msg))).toBe(true);
  });

  it("un riferimento sopra il massimo invalida %max ma non ×rif", () => {
    const b = fullBlocks();
    b.rif = [rifBlock(2000)];
    const v = verdict(buildCal(b, { hz: HZ }));
    expect(v.some((x) => /massimale/.test(x.msg))).toBe(true);
    expect(worst(v)).toBe("warn");
  });

  it("una calibrazione incompleta non produce un verdetto ottimista", () => {
    expect(worst(verdict({ ready: false }))).toBe("bad");
    expect(worst(verdict(null))).toBe("bad");
  });
});

describe("lettura dallo store", () => {
  const s = new Store(64);
  for (let i = 0; i < 40; i++) s.push(i / 10, 100 + i);   // 4 s a 10 Hz

  it("sliceRing ritaglia gli estremi inclusi", () => {
    const { ts, vs } = sliceRing(s, 1.0, 1.3);
    expect(ts).toEqual([1, 1.1, 1.2, 1.3].map((x) => expect.closeTo(x, 6)));
    expect(vs).toEqual([110, 111, 112, 113]);
    expect(sliceRing(s, 100, 200).vs).toEqual([]);
  });

  it("medianSince legge la coda, e con una MEDIANA", () => {
    // Ultimi 0.3 s: 3.6..3.9 → 136, 137, 138, 139 → mediana 137.5.
    expect(medianSince(s, 0.3)).toBeCloseTo(137.5, 6);
    expect(medianSince(new Store(4), 1)).toBeNaN();
  });

  it("movMedian butta i bozzi stretti e lascia stare il piano", () => {
    // Un piano a 100 con tre bozzi da un campione: la mediana non li vede.
    const ts = [], vs = [];
    for (let i = 0; i < 100; i++) { ts.push(i / 100); vs.push(i % 30 === 0 ? 900 : 100); }
    const m = movMedian(ts, vs, 0.3);
    expect(Math.max(...m.slice(30))).toBe(100);
    // Ma un gradino sostenuto passa.
    const vs2 = vs.map((_, i) => (i < 50 ? 100 : 200));
    const m2 = movMedian(ts, vs2, 0.3);
    expect(m2[99]).toBe(200);
  });
});

describe("persistenza", () => {
  it("un giro completo per JSON non perde niente di quello che serve", () => {
    const cal = buildCal(fullBlocks(), { hz: HZ, t: 12345 });
    const back = parseCal(JSON.stringify(cal));
    expect(back.base).toBe(cal.base);
    expect(back.rif).toBe(cal.rif);
    expect(back.burst.n).toBe(cal.burst.n);
    expect(back.t).toBe(12345);
  });

  it("rifiuta quello che non è una calibrazione pronta", () => {
    expect(parseCal("non json")).toBe(null);
    expect(parseCal("null")).toBe(null);
    expect(parseCal(JSON.stringify({ ready: false, base: 1, rif: 2 }))).toBe(null);
    expect(parseCal(JSON.stringify({ ready: true, base: 1 }))).toBe(null);
  });
});
