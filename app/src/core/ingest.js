// ============================== ingestione ==============================

import { HDR, parsePacket } from "./proto.js";
import { S, store, clock } from "./state.js";
import { log } from "../ui/dom.js";

export function onPacketBytes(bytes) {
  S.bytes += bytes.length;
  // Il CRC lo verifichiamo sempre: sul BLE il link layer ha già il suo, ma qui
  // becca il caso in cui una notify venga troncata dall'MTU negoziato.
  const p = parsePacket(bytes, true);
  if (p.error) {
    if (p.error === "crc") S.crcErrors++;
    else log("pacchetto scartato: " + p.error);
    return;
  }
  ingest(p, performance.now());
}

export function ingest(p, hostMs) {
  // Srotolamento del timestamp a 32 bit: il delta unsigned è sempre corretto
  // finché fra due pacchetti passano meno di ~71.6 minuti.
  if (S.tUnwrap === null) { S.tAbsUs = p.t0_us; }
  else { S.tAbsUs += (p.t0_us - S.tUnwrap) >>> 0; }
  S.tUnwrap = p.t0_us;

  // Buchi nella sequenza = notify BLE scartate o frame seriali corrotti.
  if (S.lastSeq !== null) {
    const missing = (p.seq - S.lastSeq - 1) & 0xFFFF;
    if (missing > 0 && missing < 1000) {
      S.lostPackets += missing;
      S.lostSamples += missing * p.values.length;   // stima
    }
  }
  S.lastSeq = p.seq;
  if (p.flags & 0x02) S.gapFlags++;                 // buffer pieno sul device

  // Il renderer assume timestamp monotoni (ricerca binaria sullo store). BLE e
  // seriale consegnano in ordine, quindi un pacchetto indietro nel tempo
  // significa reset del device o base dei tempi cambiata: ripartiamo pulito.
  if (store.n && S.tAbsUs / 1e6 <= store.t[store.last()]) {
    log("timestamp non monotono: base dei tempi azzerata");
    store.clear(); clock.reset();
  }

  S.dtUs = p.dt_us;
  S.mtuHint = Math.max(S.mtuHint, HDR + 2 * p.values.length + 2);

  const t0s = S.tAbsUs / 1e6, dts = p.dt_us / 1e6;
  for (let i = 0; i < p.values.length; i++) store.push(t0s + i * dts, p.values[i]);

  clock.add(t0s, hostMs / 1000);

  S.packets++; S.samples += p.values.length;
  S.winPkts.push(hostMs);
  S.winSamples.push([hostMs, p.values.length]);
}
