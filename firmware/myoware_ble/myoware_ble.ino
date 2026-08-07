// MyoWare -> BLE, con timestamp a cadenza esatta.
// Board: Arduino Nano ESP32 (ESP32-S3).
//
// ATTENZIONE: l'ESP32-S3 NON ha il Bluetooth Classic, quindi niente SPP /
// "Serial Bluetooth" / accoppiamento come porta seriale. Solo BLE. Qui si usa
// il Nordic UART Service (NUS), supportato da nRF Connect, Web Bluetooth,
// Bluefy e quasi tutte le librerie: comodo per controprove senza scrivere
// codice.
//
// Su NUS trasmettiamo pacchetti MyoLink binari, senza COBS: il link layer BLE
// ha già framing e CRC, ogni notify arriva intera o non arriva.
//
// Comandi scritti sulla caratteristica RX (testo):
//   R        riazzera la base dei tempi
//   P<us>    cambia periodo di campionamento, es. P10000 = 100 Hz
//
// NOTA SULLE VERSIONI DEL CORE: questo sketch evita di proposito
// BLEServerCallbacks e BLECharacteristicCallbacks, perché le loro firme sono
// cambiate in arduino-esp32 3.1 (esp_ble_gatts_cb_param_t* -> BLEConnInfo&) e
// getValue() è passato da std::string a String. Stato connessione e comandi
// sono quindi in polling con API stabili su tutte le versioni. Costa qualche
// riga in loop() e ci si risparmia un fallimento silenzioso al cambio di core.

// ------------------------------- configurazione -------------------------------

#define MYO_PIN A0
#define MYO_PERIOD_US 50000UL  // 20 Hz

// 1 = ignora l'ADC e genera una linea finta in 0..1000, per provare tutta la
// catena senza il sensore attaccato. Ricordati di rimetterlo a 0.
#define MYO_SIMULATE 1
#define MYO_SIM_MAX 1000

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

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include "myolink.h"

// UUID del Nordic UART Service.
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // central -> device
#define NUS_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // device -> central

static MyoSampler g_sampler;
static uint16_t g_seq = 0;
static uint32_t g_dropped_seen = 0;
static uint8_t g_pkt[MYO_MAX_PACKET];

static BLEServer *g_server = nullptr;
static BLECharacteristic *g_tx = nullptr;
static BLECharacteristic *g_rx = nullptr;
static bool g_was_connected = false;

static char g_last_cmd[32] = {0};

// ------------------------------- comandi in polling -------------------------------
//
// getData()/getLength() sono stabili su core 2.x e 3.x, a differenza di
// getValue(). Confrontiamo col comando precedente: se il central riscrive due
// volte lo stesso comando identico la seconda non viene notata, cosa
// irrilevante per R e P.

static void pollCommands() {
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
    Serial.print("comando: ");
    Serial.println(line);
  }
}

// ------------------------------- setup / loop -------------------------------

void setup() {
  Serial.begin(115200);

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

  g_sampler.begin(MYO_PERIOD_US);
  Serial.println("MyoLink BLE: advertising come \"" MYO_BLE_NAME "\"");
}

void loop() {
  const bool connected = g_server->getConnectedCount() > 0;

  if (connected != g_was_connected) {
    g_was_connected = connected;
    if (connected) {
      // Base dei tempi pulita a ogni connessione: il ricevente riparte da zero.
      g_sampler.restart();
      g_seq = 0;
      Serial.println("connesso");
    } else {
      BLEDevice::startAdvertising();  // torna visibile subito
      Serial.println("disconnesso");
    }
  }

  if (!connected) {
    // Scarta i campioni raccolti mentre nessuno ascolta, altrimenti alla
    // connessione manderemmo di colpo un blocco di dati vecchi.
    MyoSample s;
    while (g_sampler.ring.pop(s)) {
    }
    delay(10);
    return;
  }

  pollCommands();

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

  const size_t n = myo_build_packet(g_sampler, g_seq, g_dropped_seen, g_pkt,
                                    MYO_BLE_MAX_PAYLOAD, MYO_BLE_BATCH);
  if (n) {
    g_tx->setValue(g_pkt, n);
    g_tx->notify();  // può essere scartata se la coda TX è piena: il ricevente
                     // lo vede dal salto nel campo seq
  }
}
