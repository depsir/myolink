// MyoWare -> USB seriale o BLE, con timestamp a cadenza esatta.
// Board: Arduino Nano ESP32 (ESP32-S3).
//
// Sketch unico al posto dei due separati: tiene su entrambi i trasporti e manda
// i dati a QUELLO CHE COLLEGHI, deciso a runtime. Niente jumper, niente
// riflash, niente riavvio per cambiare modalità.
//
// ------------------------------- come sceglie -------------------------------
//
// Un solo trasporto per volta possiede la "linea": il ring buffer ha un solo
// consumatore, e duplicare lo stream non serve a nessuno.
//
//   seriale attiva  = (bool)Serial, cioè un host ha APERTO la porta CDC.
//   BLE attivo      = c'è un central connesso.
//
// Regola: vince l'ULTIMO ARRIVATO. Sul fronte di salita di un trasporto la
// linea passa a lui; quando il proprietario cade, la linea torna all'altro se
// è ancora su, altrimenti a nessuno. È la regola che rende naturale il cambio
// a caldo: attacchi una cosa e quella parla, stacchi e l'altra riprende.
//
// Perché (bool)Serial è un buon segnale e non un trucco: su questa board Serial
// è USB CDC via TinyUSB, e il flag `connected` del core segue DTR+RTS, cioè si
// alza solo quando un programma apre la porta. Attaccare la board a un
// caricatore, a un hub o a un PC che non apre nulla NON la alza. Vedi il
// controllo di compilazione più sotto: su un Serial che è UART hardware
// `operator bool()` è sempre vero e tutto questo non funzionerebbe.
//
// Conseguenza comoda: quando la linea è BLE (o non c'è) la seriale è libera, e
// ci finiscono i messaggi di diagnostica. Aprire il monitor seriale mentre il
// BLE trasmette non gli ruba la linea — la ruberebbe solo se il BLE si
// disconnette. Quando invece la linea è seriale la diagnostica tace, perché lì
// passano byte binari.
//
// ------------------------------- comandi -------------------------------
//
// Testo, accettati solo dal trasporto che possiede la linea (dall'altro sono
// scartati, così nessuno disturba lo stream in corso):
//   R        riazzera la base dei tempi
//   P<us>    cambia periodo di campionamento, es. P10000 = 100 Hz
//
// Sulla seriale la riga finisce con \n; sul BLE si scrive sulla caratteristica
// RX del Nordic UART Service.

// ------------------------------- configurazione -------------------------------

#define MYO_PIN A0             // uscita ENV del MyoWare
// 100 Hz. Era 20, che bastava a vedere la linea muoversi ma non a leggere il
// livello: la misura della fatica lavora su una mediana a 300 ms, e a 20 Hz
// quella finestra contiene sei campioni. A 100 Hz ne contiene trenta, e la banda
// del fenomeno (sotto i 3 Hz) resta comodamente dentro Nyquist.
#define MYO_PERIOD_US 10000UL  // 100 Hz

// 1 = ignora l'ADC e genera una linea finta in 0..1000, per provare tutta la
// catena senza il sensore attaccato. Ricordati di rimetterlo a 0.
#define MYO_SIMULATE 0
#define MYO_SIM_MAX 1000

// Trasporti compilati. Metterne uno a 0 riproduce esattamente il vecchio
// sketch dedicato e libera flash/RAM (il BLE costa ~20% di flash e ~7% di RAM).
#define MYO_ENABLE_SERIAL 1
#define MYO_ENABLE_BLE 1

// Formato sulla seriale:
//   0 = binario, pacchetti MyoLink framati COBS (usato dall'app)
//   1 = testo CSV "t_us,valore" (leggibile a occhio, ok per debug)
// Sul BLE non si applica: lì i pacchetti sono sempre binari e nudi.
#define MYO_TEXT_MODE 0

// Su Nano ESP32 la seriale è USB CDC: il baud rate è ignorato, la banda reale
// è dell'ordine dei Mbit/s.
#define MYO_BAUD 115200

#define MYO_BLE_NAME "MyoLink"

// Campioni per notifica. Con 1 il pacchetto è 16 byte: entra anche nell'MTU
// minimo di default (23 -> 20 byte di payload), quindi funziona con QUALSIASI
// central senza negoziazione. A 20 Hz sono 20 notify/s, nulla per il BLE.
//
// Alzalo solo per frequenze alte (>200 Hz) E dopo aver verificato che il
// central negozi un MTU decente: payload = MTU - 3, e servono 14 + 2*N byte.
// L'app mostra la dimensione del pacchetto ricevuto e verifica il CRC, quindi
// un troncamento si vede subito.
//   MTU 185 (Apple)   -> N fino a 84
//   MTU 517 (Android) -> N fino a 96 (limite MYO_MAX_SAMPLES)
#define MYO_BLE_BATCH 1

// Payload massimo per notifica: il minimo garantito è 20 byte.
#define MYO_BLE_MAX_PAYLOAD 20

// Flush forzato se il campione più vecchio in coda supera questa età: con
// batch > 1 evita che l'ultimo pacchetto resti bloccato in attesa di riempirsi.
#define MYO_BLE_MAX_LATENCY_US 20000UL

// ------------------------------- include -------------------------------

#if MYO_ENABLE_BLE
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#endif

#include "myolink.h"

#if !MYO_ENABLE_SERIAL && !MYO_ENABLE_BLE
#error "Nessun trasporto abilitato: metti a 1 MYO_ENABLE_SERIAL o MYO_ENABLE_BLE."
#endif

// L'autodetect della seriale si regge su (bool)Serial == "porta aperta", che
// vale solo se Serial è la USB CDC di TinyUSB. Con USB CDC disattivato o in
// modalità JTAG-serial, oppure su un Serial che è UART hardware,
// operator bool() è sempre vero: la seriale si prenderebbe la linea per sempre
// e il BLE non partirebbe mai. Meglio non compilare che fallire in silenzio.
#if MYO_ENABLE_SERIAL && MYO_ENABLE_BLE
#if !(defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT && !ARDUINO_USB_MODE)
#error \
    "Serial non è la USB CDC di TinyUSB: (bool)Serial è sempre vero e l'autodetect non funziona. Board sbagliata, oppure 'USB CDC On Boot' / 'USB Mode' da sistemare nel menu Strumenti. In alternativa metti MYO_ENABLE_SERIAL o MYO_ENABLE_BLE a 0."
#endif
#endif

// Il percorso binario (costruzione pacchetti, seq, CRC) serve al BLE e alla
// seriale non-testo. Con la sola seriale in CSV non se ne compila niente.
#define MYO_BINARY (MYO_ENABLE_BLE || (MYO_ENABLE_SERIAL && !MYO_TEXT_MODE))

// UUID del Nordic UART Service.
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // central -> device
#define NUS_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // device -> central

// ------------------------------- stato -------------------------------

enum MyoLinkKind : uint8_t { LINK_NONE, LINK_SERIAL, LINK_BLE };

static MyoSampler g_sampler;
static MyoLinkKind g_link = LINK_NONE;

#if MYO_BINARY
static uint16_t g_seq = 0;
static uint32_t g_dropped_seen = 0;
static uint8_t g_pkt[MYO_MAX_PACKET];
#endif

#if MYO_ENABLE_SERIAL
#if !MYO_TEXT_MODE
static uint8_t g_frame[MYO_MAX_PACKET + MYO_MAX_PACKET / 254 + 2];
#endif
static char g_cmd[32];
static uint8_t g_cmd_len = 0;
#endif

#if MYO_ENABLE_BLE
static BLEServer *g_server = nullptr;
static BLECharacteristic *g_tx = nullptr;
static BLECharacteristic *g_rx = nullptr;
static char g_last_cmd[32] = {0};
#endif

// Diagnostica: solo quando la seriale non è il canale dati, altrimenti finirebbe
// in mezzo ai byte binari. Se la porta non è aperta la write viene scartata dal
// core senza bloccare, quindi non serve controllarlo qui. Con
// MYO_ENABLE_SERIAL a 0 la condizione è sempre vera e il monitor seriale
// diventa una console di debug a tempo pieno.
static void myoLog(const char *msg) {
  if (g_link != LINK_SERIAL) Serial.println(msg);
}

static void flushRing() {
  MyoSample s;
  while (g_sampler.ring.pop(s)) {
  }
}

// ------------------------------- trasporto: seriale -------------------------------

#if MYO_ENABLE_SERIAL

static void serialPollCommands() {
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

// Svuota l'RX quando la seriale non ha la linea: chi digita nel monitor mentre
// trasmette il BLE non deve poter riazzerare la base dei tempi sotto ai piedi
// di qualcun altro, e il buffer non deve riempirsi.
static void serialDrainInput() {
  while (Serial.available()) Serial.read();
  g_cmd_len = 0;
}

static void serialPump() {
  serialPollCommands();

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
    const size_t n = myo_build_packet(g_sampler, g_seq, g_dropped_seen, g_pkt, sizeof(g_pkt),
                                      MYO_MAX_SAMPLES);
    if (!n) break;
    const size_t fn = myo_cobs_encode(g_pkt, n, g_frame);
    Serial.write(g_frame, fn);
    Serial.write((uint8_t)0x00);  // delimitatore di frame
  }
#endif
}

#endif  // MYO_ENABLE_SERIAL

// ------------------------------- trasporto: BLE -------------------------------
//
// NOTA SULLE VERSIONI DEL CORE: questo sketch evita di proposito
// BLEServerCallbacks e BLECharacteristicCallbacks, perché le loro firme sono
// cambiate in arduino-esp32 3.1 (esp_ble_gatts_cb_param_t* -> BLEConnInfo&) e
// getValue() è passato da std::string a String. Stato connessione e comandi
// sono quindi in polling con API stabili su tutte le versioni. Costa qualche
// riga e ci si risparmia un fallimento silenzioso al cambio di core.

#if MYO_ENABLE_BLE

static void bleBegin() {
  BLEDevice::init(MYO_BLE_NAME);
  BLEDevice::setMTU(247);  // solo una preferenza locale: decide il central

  g_server = BLEDevice::createServer();
  BLEService *svc = g_server->createService(NUS_SERVICE_UUID);

  g_tx = svc->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);

  // Il CCCD (0x2902) va aggiunto a mano: su arduino-esp32 2.x PROPERTY_NOTIFY
  // NON lo crea (in tutta la libreria BLE l'unico 0x2902 è in BLE2902.cpp).
  // Senza CCCD il central non ha dove scrivere l'iscrizione: Web Bluetooth
  // fallisce startNotifications() con "GATT Error: Not supported" e non arriva
  // nulla, pur restando connesso. Su core 3.x / NimBLE è ridondante ma innocuo.
  g_tx->addDescriptor(new BLE2902());

  g_rx = svc->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);

  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

// getData()/getLength() sono stabili su core 2.x e 3.x, a differenza di
// getValue(). Confrontiamo col comando precedente: se il central riscrive due
// volte lo stesso comando identico la seconda non viene notata, cosa
// irrilevante per R e P.
static void blePollCommands() {
  if (!g_rx) return;
  const uint8_t *data = g_rx->getData();
  size_t n = g_rx->getLength();
  if (!data || n == 0 || n >= sizeof(g_last_cmd)) return;

  char line[sizeof(g_last_cmd)];
  memcpy(line, data, n);
  line[n] = '\0';
  for (size_t i = 0; i < n; i++) {
    if (line[i] == '\r' || line[i] == '\n') {
      line[i] = '\0';
      break;
    }
  }
  if (!line[0] || strcmp(line, g_last_cmd) == 0) return;

  strcpy(g_last_cmd, line);
  if (myo_handle_command(line, g_sampler)) {
    myoLog(line);
  }
}

static void blePump() {
  blePollCommands();

  const uint16_t queued = g_sampler.ring.size();
  if (queued == 0) {
    delay(1);
    return;
  }

  // Manda quando il batch è pieno, oppure quando il campione più vecchio
  // rischia di invecchiare troppo.
  bool flush = queued >= MYO_BLE_BATCH;
  if (!flush) {
    MyoSample oldest;
    if (g_sampler.ring.peek(oldest)) {
      flush = (esp_timer_get_time() - (int64_t)oldest.t_us) >= (int64_t)MYO_BLE_MAX_LATENCY_US;
    }
  }
  if (!flush) {
    delay(1);
    return;
  }

  const size_t n = myo_build_packet(g_sampler, g_seq, g_dropped_seen, g_pkt, MYO_BLE_MAX_PAYLOAD,
                                    MYO_BLE_BATCH);
  if (n) {
    g_tx->setValue(g_pkt, n);
    g_tx->notify();  // può essere scartata se la coda TX è piena: il ricevente
                     // lo vede dal salto nel campo seq
  }
}

#endif  // MYO_ENABLE_BLE

// ------------------------------- scelta del trasporto -------------------------------

static bool serialIsUp() {
#if MYO_ENABLE_SERIAL
  return (bool)Serial;  // vero solo se un host ha aperto la porta CDC
#else
  return false;
#endif
}

static bool bleIsUp() {
#if MYO_ENABLE_BLE
  return g_server && g_server->getConnectedCount() > 0;
#else
  return false;
#endif
}

static void updateLink() {
  static bool prev_serial = false, prev_ble = false;

  const bool s = serialIsUp();
  const bool b = bleIsUp();
  MyoLinkKind next = g_link;

  // Fronte di salita: vince l'ultimo arrivato. Se per assurdo salgono entrambi
  // nello stesso giro, l'ordine qui sotto fa vincere il BLE, che è la
  // connessione più deliberata delle due.
  if (s && !prev_serial) next = LINK_SERIAL;
  if (b && !prev_ble) next = LINK_BLE;

#if MYO_ENABLE_BLE
  if (!b && prev_ble) BLEDevice::startAdvertising();  // torna visibile subito
#endif

  prev_serial = s;
  prev_ble = b;

  // Il proprietario è caduto: la linea passa all'altro se è ancora su.
  if (next == LINK_SERIAL && !s) next = b ? LINK_BLE : LINK_NONE;
  if (next == LINK_BLE && !b) next = s ? LINK_SERIAL : LINK_NONE;

  if (next == g_link) return;

  // Base dei tempi pulita a ogni cambio di linea: il ricevente riparte da zero
  // e non si ritrova in coda i campioni raccolti per qualcun altro.
  g_link = next;
  g_sampler.restart();
#if MYO_BINARY
  g_seq = 0;
#endif
  flushRing();
#if MYO_ENABLE_BLE
  g_last_cmd[0] = '\0';
#endif

  myoLog(next == LINK_BLE      ? "linea: BLE"
         : next == LINK_SERIAL ? "linea: seriale"
                               : "linea: nessuna");
}

// ------------------------------- setup / loop -------------------------------

void setup() {
  Serial.begin(MYO_BAUD);
#if MYO_ENABLE_BLE
  bleBegin();
#endif
  g_sampler.begin(MYO_PERIOD_US);

  // La linea è ancora LINK_NONE, quindi questo si vede nel monitor seriale.
  myoLog("MyoLink pronto"
#if MYO_ENABLE_BLE
         ", advertising come \"" MYO_BLE_NAME "\""
#endif
  );
}

void loop() {
  updateLink();

  switch (g_link) {
#if MYO_ENABLE_SERIAL
    case LINK_SERIAL:
      serialPump();
      break;
#endif
#if MYO_ENABLE_BLE
    case LINK_BLE:
#if MYO_ENABLE_SERIAL
      serialDrainInput();
#endif
      blePump();
      break;
#endif
    default:
      // Nessuno ascolta: butta i campioni, altrimenti alla connessione
      // manderemmo di colpo un blocco di dati vecchi.
#if MYO_ENABLE_SERIAL
      serialDrainInput();
#endif
      flushRing();
      delay(10);
      break;
  }
}
