import { beforeEach, describe, expect, it } from "vitest";
import { ingest } from "../src/core/ingest.js";
import { S, resetStats, store } from "../src/core/state.js";

const DT = 50000;   // 20 Hz, come il default del firmware

// Un pacchetto come lo manda il firmware: n campioni equispaziati da t0.
function pkt(seq, t0, values = [0], flags = 0) {
  return { seq: seq & 0xFFFF, t0_us: t0 >>> 0, dt_us: DT, flags, values: Int16Array.from(values) };
}

beforeEach(() => resetStats());

describe("srotolamento del timestamp a 32 bit", () => {
  it("resta monotono attraverso il wrap di 2³²", () => {
    // Si parte 5 pacchetti prima del wrap e si continua per 5 dopo.
    const start = 0x100000000 - 5 * DT;
    for (let i = 0; i < 10; i++) ingest(pkt(i, (start + i * DT) >>> 0), i * 50);

    expect(store.n).toBe(10);
    const ts = Array.from({ length: store.n }, (_, k) => store.t[store.idx(k)]);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    // Fra il primo e l'ultimo devono esserci esattamente 9 periodi.
    expect(ts.at(-1) - ts[0]).toBeCloseTo(9 * DT / 1e6, 9);
  });

  it("si autocorregge sul wrap anche con pacchetti persi in mezzo", () => {
    const start = 0x100000000 - 2 * DT;
    ingest(pkt(0, start >>> 0), 0);
    // Buco: saltiamo 3 pacchetti, il quarto cade oltre il wrap.
    ingest(pkt(4, (start + 4 * DT) >>> 0), 200);
    const ts = [store.t[store.idx(0)], store.t[store.idx(1)]];
    expect(ts[1] - ts[0]).toBeCloseTo(4 * DT / 1e6, 9);
    expect(S.lostPackets).toBe(3);
  });
});

describe("contabilità del link", () => {
  it("conta i pacchetti persi dai salti di seq, anche sul wrap a 16 bit", () => {
    ingest(pkt(65534, 0), 0);
    ingest(pkt(65535, DT), 50);
    ingest(pkt(1, 3 * DT), 150);        // 0 e 1 → wrap: manca il pacchetto 0
    expect(S.lostPackets).toBe(1);
    expect(S.packets).toBe(3);
  });

  it("non conta perdite assurde come perdite", () => {
    ingest(pkt(0, 0), 0);
    ingest(pkt(5000, DT), 50);          // salto di 5000: fuori dalla finestra plausibile
    expect(S.lostPackets).toBe(0);
  });

  it("conta il flag di buffer pieno del device", () => {
    ingest(pkt(0, 0, [1], 0x02), 0);
    ingest(pkt(1, DT, [1], 0x00), 50);
    expect(S.gapFlags).toBe(1);
  });

  it("espande i campioni di un pacchetto a passo dt", () => {
    ingest(pkt(0, 1000, [10, 20, 30]), 0);
    expect(store.n).toBe(3);
    const ts = [0, 1, 2].map((k) => store.t[store.idx(k)]);
    expect(ts[1] - ts[0]).toBeCloseTo(DT / 1e6, 9);
    expect(ts[2] - ts[1]).toBeCloseTo(DT / 1e6, 9);
    expect([0, 1, 2].map((k) => store.v[store.idx(k)])).toEqual([10, 20, 30]);
    expect(S.samples).toBe(3);
  });
});

describe("timestamp non monotono", () => {
  it("azzera la storia se il tempo srotolato non avanza", () => {
    for (let i = 0; i < 5; i++) ingest(pkt(i, 1000000 + i * DT), i * 50);
    expect(store.n).toBe(5);
    ingest(pkt(5, 1000000 + 4 * DT), 250);   // stesso t0 del precedente
    expect(store.n).toBe(1);
  });

  // Limite noto, e va conosciuto: lo srotolamento non può distinguere "il device
  // è ripartito da zero" da "sono passati ~71 minuti", quindi un reset del device
  // SENZA riconnessione (possibile solo sulla seriale, dove la porta resta aperta)
  // viene letto come un salto in avanti, non come un ritorno indietro. Con una
  // riconnessione il caso non si pone: startSession azzera lo srotolamento.
  it("legge un reset del device come un salto in avanti, non come un ritorno", () => {
    for (let i = 0; i < 5; i++) ingest(pkt(i, 1000000 + i * DT), i * 50);
    ingest(pkt(5, 0), 250);                  // micros() ripartito da zero
    expect(store.n).toBe(6);                 // la storia NON si azzera
    expect(store.t[store.last()]).toBeGreaterThan(4000);   // ~4294 s più avanti
  });
});
