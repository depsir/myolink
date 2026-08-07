// myolink.h — campionamento a cadenza fissa + formato pacchetto MyoLink.
//
// Sta nella cartella dello sketch perché è lì che l'IDE Arduino cerca gli
// header.
//
// Idea di fondo:
//   - un esp_timer periodico legge l'ADC e mette (timestamp, valore) in un
//     ring buffer;
//   - il timestamp è il tempo NOMINALE di griglia t0 + k*periodo, con k
//     ricavato dal clock hardware. Nessun errore accumulato, e un tick
//     perso non sfasa i successivi;
//   - loop() svuota il ring e trasmette. Se il trasporto blocca, i
//     timestamp restano corretti.

#pragma once

#include <Arduino.h>
#include <esp_timer.h>
#include <string.h>

// ============================== configurazione ==============================

#ifndef MYO_PIN
#define MYO_PIN A0  // uscita ENV del MyoWare
#endif

#ifndef MYO_PERIOD_US
#define MYO_PERIOD_US 50000UL  // 50 ms = 20 Hz (come delay(50) dell'esempio)
#endif

#ifndef MYO_RING_LOG2
#define MYO_RING_LOG2 9  // 512 campioni di buffer (~25 s a 20 Hz)
#endif

#ifndef MYO_MAX_SAMPLES
#define MYO_MAX_SAMPLES 96  // campioni massimi in un pacchetto
#endif

#ifndef MYO_SIMULATE
#define MYO_SIMULATE 0  // 1 = segnale finto invece dell'ADC (vedi myo_sim_next)
#endif

#ifndef MYO_SIM_MAX
#define MYO_SIM_MAX 1000  // fondo scala del segnale simulato
#endif

// ============================== formato sul filo ==============================
//
// Little-endian (l'ESP32 lo è nativamente).
//
//   off  sz   campo
//   0    1    magic     0xA5
//   1    1    version   0x01
//   2    1    n         numero di campioni nel pacchetto (>= 1)
//   3    1    flags     vedi MYO_FLAG_*
//   4    2    seq       contatore pacchetti, wrappa a 65536
//   6    4    t0_us     micros() del campione [0]  (wrappa ogni ~71.6 min)
//   10   4    dt_us     spaziatura nominale fra campioni consecutivi
//   14   2*n  samples   int16 LE
//   ..   2    crc16     CRC-16/CCITT-FALSE sui byte [0 .. 14+2n-1]
//
// I campioni di un pacchetto sono garantiti equispaziati: il campione i-esimo
// vale t0_us + i*dt_us. Se nel ring c'è un buco, il pacchetto si chiude prima.

static const uint8_t MYO_MAGIC = 0xA5;
static const uint8_t MYO_VERSION = 0x01;
static const size_t MYO_HDR_LEN = 14;
static const size_t MYO_MAX_PACKET = MYO_HDR_LEN + 2 * MYO_MAX_SAMPLES + 2;

enum : uint8_t {
  MYO_FLAG_RAW_ADC = 1 << 0,  // i campioni sono conteggi ADC grezzi
  MYO_FLAG_GAP = 1 << 1,      // campioni persi prima di questo pacchetto
};

// CRC-16/CCITT-FALSE (init 0xFFFF, poly 0x1021, no reflect, no xorout).
static inline uint16_t myo_crc16(const uint8_t *p, size_t n) {
  uint16_t crc = 0xFFFF;
  while (n--) {
    crc ^= (uint16_t)(*p++) << 8;
    for (int i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

// ============================== ring buffer ==============================
//
// Single producer (task di esp_timer) / single consumer (loop). head e tail
// sono volatile e la capacità è potenza di 2: nessun lock necessario.

struct MyoSample {
  uint64_t t_us;
  int16_t v;
};

class MyoRing {
 public:
  static const uint16_t CAP = 1u << MYO_RING_LOG2;

  bool push(uint64_t t, int16_t v) {  // solo dal producer
    const uint16_t h = head;
    const uint16_t next = (uint16_t)((h + 1) & (CAP - 1));
    if (next == tail) {
      dropped++;
      return false;
    }
    buf[h].t_us = t;
    buf[h].v = v;
    head = next;
    return true;
  }

  bool peek(MyoSample &out) const {  // solo dal consumer
    const uint16_t t = tail;
    if (t == head) return false;
    out = buf[t];
    return true;
  }

  void drop() {  // solo dal consumer, dopo un peek riuscito
    tail = (uint16_t)((tail + 1) & (CAP - 1));
  }

  bool pop(MyoSample &out) {
    if (!peek(out)) return false;
    drop();
    return true;
  }

  uint16_t size() const { return (uint16_t)((head - tail) & (CAP - 1)); }

  volatile uint16_t head = 0;
  volatile uint16_t tail = 0;
  volatile uint32_t dropped = 0;

 private:
  MyoSample buf[CAP];
};

// ============================== segnale simulato ==============================
//
// Random walk con inerzia in 0..MYO_SIM_MAX, per provare tutta la catena senza
// avere il sensore attaccato. Non è rumore campione-per-campione: c'è una
// "velocità" che varia lentamente, quindi il risultato è una linea continua
// che vaga, e un campione perso si vede come una discontinuità evidente.
//
// L'attrito serve a non incollarsi ai bordi; sui bordi rimbalza invece di
// saturare, così non si confonde un clipping vero con il simulatore.
//
// Nota: random() su ESP32 usa il generatore hardware, quindi la traccia è
// diversa a ogni avvio (randomSeed() non ha effetto).

static inline int16_t myo_sim_next() {
  static int32_t v16 = (MYO_SIM_MAX / 2) * 16;  // valore * 16: passi frazionari
  static int32_t d = 0;                         // velocità, in unità di v16

  d += (int32_t)random(-60, 61);  // accelerazione casuale
  d -= d / 6;                     // attrito
  if (d > 400) d = 400;
  if (d < -400) d = -400;
  v16 += d;

  const int32_t top = MYO_SIM_MAX * 16;
  if (v16 < 0) {
    v16 = -v16;
    d = -d;
  } else if (v16 > top) {
    v16 = 2 * top - v16;
    d = -d;
  }
  return (int16_t)(v16 / 16);
}

// ============================== sampler ==============================

class MyoSampler {
 public:
  MyoRing ring;

  void begin(uint32_t period_us = MYO_PERIOD_US) {
    analogReadResolution(12);  // 0..4095 sull'ESP32-S3
    _period = period_us;

    esp_timer_create_args_t args = {};
    args.callback = &MyoSampler::trampoline;
    args.arg = this;
    args.dispatch_method = ESP_TIMER_TASK;
    args.name = "myo_sample";
    args.skip_unhandled_events = true;  // meglio saltare che accodare tick
    esp_timer_create(&args, &_timer);

    restart();
  }

  // Riazzera la base dei tempi (t0 = adesso, k = 0).
  void restart() {
    if (!_timer) return;
    esp_timer_stop(_timer);
    _t0_us = esp_timer_get_time();
    _last_k = UINT32_MAX;
    esp_timer_start_periodic(_timer, _period);
  }

  void setPeriod(uint32_t period_us) {
    if (period_us < 200) period_us = 200;  // >5 kHz: non con analogRead()
    _period = period_us;
    restart();
  }

  uint32_t period() const { return _period; }

 private:
  static void trampoline(void *arg) { static_cast<MyoSampler *>(arg)->tick(); }

  void tick() {
    const uint64_t now = esp_timer_get_time();

    // Aggancia il campione al punto di griglia più vicino. È qui che si
    // evita la deriva: il timestamp non dipende da QUANDO la callback è
    // stata effettivamente eseguita, solo da quale slot occupa.
    const uint32_t k = (uint32_t)(((now - _t0_us) + _period / 2) / _period);
    if (k == _last_k) return;  // callback duplicata o coalescita
    _last_k = k;

    const uint64_t t = _t0_us + (uint64_t)k * _period;
#if MYO_SIMULATE
    ring.push(t, myo_sim_next());
#else
    ring.push(t, (int16_t)analogRead(MYO_PIN));
#endif
  }

  esp_timer_handle_t _timer = nullptr;
  uint32_t _period = MYO_PERIOD_US;
  uint64_t _t0_us = 0;
  uint32_t _last_k = UINT32_MAX;
};

// ============================== costruzione pacchetti ==============================

// Estrae dal ring fino a max_n campioni CONTIGUI e li impacchetta in out.
// Ritorna la lunghezza del pacchetto, 0 se non c'era nulla da mandare.
static inline size_t myo_build_packet(MyoSampler &s, uint16_t &seq, uint32_t &dropped_seen,
                                      uint8_t *out, size_t out_cap, uint8_t max_n) {
  MyoSample first;
  if (!s.ring.pop(first)) return 0;

  const uint32_t dt = s.period();
  int16_t vals[MYO_MAX_SAMPLES];
  vals[0] = first.v;
  uint8_t n = 1;
  uint64_t last_t = first.t_us;

  // Quanti campioni ci stanno davvero, fra limite richiesto e buffer.
  size_t room = (out_cap - MYO_HDR_LEN - 2) / 2;
  if (room > MYO_MAX_SAMPLES) room = MYO_MAX_SAMPLES;
  if (room > max_n) room = max_n;

  MyoSample next;
  while (n < room && s.ring.peek(next)) {
    if (next.t_us != last_t + dt) break;  // buco: chiudi qui il pacchetto
    s.ring.drop();
    vals[n++] = next.v;
    last_t = next.t_us;
  }

  uint8_t flags = MYO_FLAG_RAW_ADC;
  const uint32_t d = s.ring.dropped;
  if (d != dropped_seen) {
    flags |= MYO_FLAG_GAP;
    dropped_seen = d;
  }

  const uint32_t t0 = (uint32_t)first.t_us;  // µs troncati a 32 bit
  size_t o = 0;
  out[o++] = MYO_MAGIC;
  out[o++] = MYO_VERSION;
  out[o++] = n;
  out[o++] = flags;
  out[o++] = (uint8_t)(seq & 0xFF);
  out[o++] = (uint8_t)(seq >> 8);
  seq++;
  memcpy(out + o, &t0, 4);
  o += 4;
  memcpy(out + o, &dt, 4);
  o += 4;
  memcpy(out + o, vals, (size_t)n * 2);
  o += (size_t)n * 2;

  const uint16_t crc = myo_crc16(out, o);
  out[o++] = (uint8_t)(crc & 0xFF);
  out[o++] = (uint8_t)(crc >> 8);
  return o;
}

// ============================== framing COBS (seriale) ==============================
//
// COBS elimina ogni 0x00 dal payload, così 0x00 può delimitare i frame e il
// ricevente si risincronizza da solo dopo qualsiasi disturbo.
// out deve avere spazio per len + len/254 + 2 byte.

static inline size_t myo_cobs_encode(const uint8_t *in, size_t len, uint8_t *out) {
  size_t read = 0, write = 1, code_i = 0;
  uint8_t code = 1;
  while (read < len) {
    if (in[read] == 0) {
      out[code_i] = code;
      code_i = write++;
      code = 1;
      read++;
    } else {
      out[write++] = in[read++];
      if (++code == 0xFF) {
        out[code_i] = code;
        code_i = write++;
        code = 1;
      }
    }
  }
  out[code_i] = code;
  return write;
}

// ============================== comandi ==============================
//
// Comandi testuali terminati da \n, accettati sia da seriale sia da BLE:
//   R        riazzera la base dei tempi
//   P<us>    imposta il periodo di campionamento, es. "P10000" = 100 Hz
// Ritorna true se il comando è stato riconosciuto.

static inline bool myo_handle_command(const char *line, MyoSampler &s) {
  switch (line[0]) {
    case 'R':
    case 'r':
      s.restart();
      return true;
    case 'P':
    case 'p': {
      const long us = atol(line + 1);
      if (us <= 0) return false;
      s.setPeriod((uint32_t)us);
      return true;
    }
    default:
      return false;
  }
}
