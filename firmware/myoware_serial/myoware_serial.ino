// MyoWare -> USB seriale, con timestamp a cadenza esatta.
// Board: Arduino Nano ESP32 (ESP32-S3).
//
// Due formati di uscita, vedi MYO_TEXT_MODE:
//   0 = binario, pacchetti MyoLink framati COBS (usato dall'app)
//   1 = testo CSV "t_us,valore" (leggibile a occhio, ok per debug)
//
// Comandi in ingresso (una riga terminata da \n):
//   R        riazzera la base dei tempi
//   P<us>    cambia periodo di campionamento, es. P10000 = 100 Hz

// ------------------------------- configurazione -------------------------------

#define MYO_PIN A0            // uscita ENV del MyoWare
#define MYO_PERIOD_US 50000UL // 20 Hz
#define MYO_TEXT_MODE 0

// 1 = ignora l'ADC e genera una linea finta in 0..1000, per provare tutta la
// catena senza il sensore attaccato. Ricordati di rimetterlo a 0.
#define MYO_SIMULATE 1
#define MYO_SIM_MAX 1000

// Su Nano ESP32 la seriale è USB CDC: il baud rate è ignorato, la banda
// reale è dell'ordine dei Mbit/s.
#define MYO_BAUD 115200

#include "myolink.h"

static MyoSampler g_sampler;
static uint16_t g_seq = 0;
static uint32_t g_dropped_seen = 0;

static uint8_t g_pkt[MYO_MAX_PACKET];
static uint8_t g_frame[MYO_MAX_PACKET + MYO_MAX_PACKET / 254 + 2];

static char g_cmd[32];
static uint8_t g_cmd_len = 0;

// ------------------------------- comandi in ingresso -------------------------------

static void pollCommands() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (g_cmd_len) {
        g_cmd[g_cmd_len] = '\0';
        myo_handle_command(g_cmd, g_sampler);
        g_cmd_len = 0;
      }
    } else if (g_cmd_len < sizeof(g_cmd) - 1) {
      g_cmd[g_cmd_len++] = c;
    }
  }
}

// ------------------------------- setup / loop -------------------------------

void setup() {
  Serial.begin(MYO_BAUD);
  g_sampler.begin(MYO_PERIOD_US);
}

void loop() {
  pollCommands();

#if MYO_TEXT_MODE
  // Un campione per riga: "t_us,valore". Il timestamp è quello nominale di
  // griglia, quindi le differenze sono esattamente MYO_PERIOD_US.
  MyoSample s;
  while (g_sampler.ring.pop(s)) {
    Serial.print((uint32_t)s.t_us);
    Serial.print(',');
    Serial.println(s.v);
  }
#else
  // Il loop gira migliaia di volte al secondo, quindi in pratica c'è al più
  // un campione pronto per volta: latenza minima. Se il ring si è riempito
  // (USB occupato) si svuota in pacchetti pieni.
  for (;;) {
    const size_t n = myo_build_packet(g_sampler, g_seq, g_dropped_seen, g_pkt,
                                     sizeof(g_pkt), MYO_MAX_SAMPLES);
    if (!n) break;
    const size_t fn = myo_cobs_encode(g_pkt, n, g_frame);
    Serial.write(g_frame, fn);
    Serial.write((uint8_t)0x00);  // delimitatore di frame
  }
#endif
}
