import { describe, expect, it } from "vitest";
import { CobsDecoder, HDR, MAGIC, crc16, decodeCobs, parsePacket } from "../src/core/proto.js";

// Generatore deterministico: un fallimento del fuzz si riproduce sempre uguale.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// L'encoder COBS sta nel firmware, in C: qui ne serve uno per chiudere il giro
// e verificare che il decoder dell'app rilegga quello che il device manda.
function encodeCobs(data) {
  const out = [0];
  let codeIdx = 0, code = 1;
  for (const b of data) {
    if (b === 0) { out[codeIdx] = code; codeIdx = out.length; out.push(0); code = 1; }
    else {
      out.push(b); code++;
      if (code === 0xFF) { out[codeIdx] = code; codeIdx = out.length; out.push(0); code = 1; }
    }
  }
  out[codeIdx] = code;
  return new Uint8Array(out);
}

function buildPacket({ seq = 1, t0 = 0, dt = 50000, flags = 0, values = [100] }) {
  const n = values.length;
  const b = new Uint8Array(HDR + 2 * n + 2);
  const dv = new DataView(b.buffer);
  b[0] = MAGIC; b[1] = 1; b[2] = n; b[3] = flags;
  dv.setUint16(4, seq, true);
  dv.setUint32(6, t0, true);
  dv.setUint32(10, dt, true);
  values.forEach((v, i) => dv.setInt16(HDR + 2 * i, v, true));
  dv.setUint16(HDR + 2 * n, crc16(b, HDR + 2 * n), true);
  return b;
}

describe("crc16", () => {
  it("dà 0x29B1 sul vettore di riferimento CCITT-FALSE", () => {
    const v = new TextEncoder().encode("123456789");
    expect(crc16(v, v.length)).toBe(0x29B1);
  });
});

describe("parsePacket", () => {
  it("rilegge i campi e i campioni", () => {
    const p = parsePacket(buildPacket({ seq: 7, t0: 123456, dt: 25000, flags: 3, values: [1, -2, 300] }), true);
    expect(p.error).toBeUndefined();
    expect(p.seq).toBe(7);
    expect(p.t0_us).toBe(123456);
    expect(p.dt_us).toBe(25000);
    expect(p.flags).toBe(3);
    expect([...p.values]).toEqual([1, -2, 300]);
  });

  it("regge il t0_us appena sotto il wrap a 32 bit", () => {
    const p = parsePacket(buildPacket({ t0: 0xFFFFFFFF }), true);
    expect(p.t0_us).toBe(0xFFFFFFFF);      // niente segno, è unsigned
  });

  it("becca un byte cambiato col CRC", () => {
    const b = buildPacket({ values: [1, 2, 3] });
    b[HDR] ^= 0x01;
    expect(parsePacket(b, true).error).toBe("crc");
    expect(parsePacket(b, false).error).toBeUndefined();   // senza verifica passa
  });

  it("rifiuta magic, lunghezza e pacchetti corti", () => {
    const b = buildPacket({ values: [1, 2, 3] });
    expect(parsePacket(Uint8Array.of(1, 2, 3), true).error).toBe("corto");
    const bad = b.slice(); bad[0] = 0x00;
    expect(parsePacket(bad, true).error).toBe("magic");
    // Abbastanza lungo da superare il minimo, ma troncato rispetto a n: è il caso
    // della notify BLE tagliata dall'MTU negoziato.
    const trunc = b.slice(0, b.length - 3);
    expect(parsePacket(trunc, true).error).toBe("lunghezza");
    const zeroN = b.slice(); zeroN[2] = 0;
    expect(parsePacket(zeroN, true).error).toBe("lunghezza");
  });
});

describe("COBS", () => {
  it("chiude il giro su 4000 vettori casuali", () => {
    const rnd = lcg(12345);
    for (let i = 0; i < 4000; i++) {
      const len = Math.floor(rnd() * 600);
      const data = new Uint8Array(len);
      for (let j = 0; j < len; j++) data[j] = Math.floor(rnd() * 256);
      expect([...decodeCobs(encodeCobs(data))]).toEqual([...data]);
    }
  });

  it("regge le run senza zeri più lunghe di 254 byte e i payload tutti-zero", () => {
    for (const data of [
      new Uint8Array(300).fill(0x42),
      new Uint8Array(254).fill(0x42),
      new Uint8Array(255).fill(0x42),
      new Uint8Array(600).fill(0),
      new Uint8Array(0),
    ]) {
      expect([...decodeCobs(encodeCobs(data))]).toEqual([...data]);
    }
  });

  it("si risincronizza dopo spazzatura, e il pacchetto dopo arriva intero", () => {
    const frames = [];
    const dec = new CobsDecoder((f) => frames.push(f));
    const good = buildPacket({ seq: 9, values: [7] });

    dec.feed(Uint8Array.of(0x11, 0x22, 0x33));     // frammento senza delimitatore
    dec.feed(Uint8Array.of(0));                    // ...chiuso male: esce un frame spazzatura
    dec.feed(encodeCobs(good));
    dec.feed(Uint8Array.of(0));

    const parsed = frames.map((f) => parsePacket(f, true));
    expect(parsed.some((p) => p.error)).toBe(true);           // la spazzatura è respinta
    const ok = parsed.filter((p) => !p.error);
    expect(ok).toHaveLength(1);
    expect(ok[0].seq).toBe(9);
  });

  // Una run lunghissima senza delimitatore non deve incantare il decoder: quello
  // che c'è in mezzo è perso comunque (non era un frame), ma dal delimitatore
  // successivo in poi si torna a leggere.
  it("non si incanta su una run più lunga del limite di frame", () => {
    const frames = [];
    const dec = new CobsDecoder((f) => frames.push(f));
    dec.feed(new Uint8Array(5000).fill(0x41));     // mai un delimitatore: assurdo
    dec.feed(Uint8Array.of(0));                    // qui si chiude, e si riparte puliti

    const good = buildPacket({ seq: 3, values: [1] });
    dec.feed(encodeCobs(good));
    dec.feed(Uint8Array.of(0));

    const ok = frames.map((f) => parsePacket(f, true)).filter((p) => !p.error);
    expect(ok).toHaveLength(1);
    expect(ok[0].seq).toBe(3);
  });
});
