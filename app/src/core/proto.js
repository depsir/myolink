// ============================== protocollo ==============================

export const MAGIC = 0xA5, HDR = 14;

export function crc16(bytes, len) {           // CRC-16/CCITT-FALSE
  let crc = 0xFFFF;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// Ritorna {seq, t0_us, dt_us, flags, values} oppure {error}.
export function parsePacket(b, verifyCrc) {
  if (b.length < HDR + 2 + 2) return { error: "corto" };
  if (b[0] !== MAGIC) return { error: "magic" };
  const n = b[2];
  const need = HDR + 2 * n + 2;
  if (n === 0 || b.length < need) return { error: "lunghezza" };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (verifyCrc && crc16(b, HDR + 2 * n) !== dv.getUint16(HDR + 2 * n, true)) return { error: "crc" };
  const values = new Int16Array(n);
  for (let i = 0; i < n; i++) values[i] = dv.getInt16(HDR + 2 * i, true);
  return {
    flags: b[3],
    seq: dv.getUint16(4, true),
    t0_us: dv.getUint32(6, true),
    dt_us: dv.getUint32(10, true),
    values,
  };
}

// Decoder COBS a stream: accumula byte e chiama onFrame per ogni 0x00.
export class CobsDecoder {
  constructor(onFrame) { this.onFrame = onFrame; this.buf = []; }
  feed(chunk) {
    for (const byte of chunk) {
      if (byte === 0) {
        if (this.buf.length) this.onFrame(decodeCobs(this.buf));
        this.buf = [];
      } else if (this.buf.length < 4096) {
        this.buf.push(byte);
      } else {
        this.buf = [];   // frame assurdo: butta e risincronizza al prossimo 0x00
      }
    }
  }
}

export function decodeCobs(enc) {
  const out = [];
  let i = 0;
  while (i < enc.length) {
    const code = enc[i++];
    for (let j = 1; j < code && i < enc.length; j++) out.push(enc[i++]);
    if (code < 0xFF && i < enc.length) out.push(0);
  }
  return new Uint8Array(out);
}
