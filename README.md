# MyoLink

MyoWare → Arduino Nano ESP32 → grafico live, via **seriale** o **BLE**, con
timestamp a cadenza esatta per poter ricostruire il segnale anche in presenza
di ritardi o pacchetti perduti. Sotto al grafico, lo **spettrogramma del
microfono** sullo stesso asse dei tempi.

```
firmware/myoware/myoware.ino   sketch unico: seriale + BLE, sceglie da solo (vedi sotto)
firmware/myoware/myolink.h     campionamento + formato pacchetto
app/index.html                 ricevitore web: grafico live, spettrogramma, statistiche del link
```

## Avvio rapido

**Firmware.** Apri `firmware/myoware` nell'IDE Arduino, board *Arduino Nano
ESP32*, carica. Non devi scegliere il trasporto: lo sketch parla con quello che
colleghi. Tutto ciò che si tocca sta in cima al `.ino`:

| define | default | cosa fa |
|---|---|---|
| `MYO_PIN` | `A0` | ingresso analogico (uscita ENV del MyoWare) |
| `MYO_PERIOD_US` | `50000` | periodo di campionamento, 50 ms = 20 Hz |
| `MYO_SIMULATE` | **`1`** | `1` = linea finta invece dell'ADC, `0` = sensore reale |
| `MYO_SIM_MAX` | `1000` | fondo scala del segnale simulato |
| `MYO_ENABLE_SERIAL` | `1` | compila il trasporto seriale |
| `MYO_ENABLE_BLE` | `1` | compila il trasporto BLE (costa 20% di flash e 8% di RAM) |
| `MYO_TEXT_MODE` | `0` | solo seriale: `1` = CSV `t_us,valore` invece del binario |

`MYO_SIMULATE` è a **1** di default, così puoi provare tutta la catena senza
avere il sensore attaccato: genera un random walk con inerzia in 0..1000, cioè
una linea continua che vaga (~2.7 count per campione, non rumore), che rimbalza
sui bordi invece di saturare — così un clipping vero non si confonde col
simulatore. **Mettilo a 0 quando colleghi il MyoWare.**

**App.** Web Serial e Web Bluetooth richiedono un contesto sicuro: **non
funzionano da `file://`**.

```sh
python3 -m http.server -d app 8000    # poi apri http://localhost:8000
```

Chrome o Edge. *Collega seriale* (desktop) oppure *Collega BLE* (desktop e
Android).

Il campo **Y** va messo `0`–`1000` col simulatore del firmware e `0`–`4095` col
sensore reale (ADC a 12 bit); il pulsante *Auto Y* lo calcola sui dati visibili.

Il pulsante **Simulatore** è una cosa diversa da `MYO_SIMULATE`: genera i
pacchetti *dentro il browser*, con perdite e stalli radio artificiali, e serve
a provare la UI senza nemmeno la board.

Il campo `Hz` + *Applica* cambia la frequenza di campionamento a caldo, senza
riflashare — comodo per cercare il punto di rottura del BLE.

**Microfono.** Il pulsante *Microfono* apre lo spettrogramma. È un flusso
indipendente: funziona anche senza board collegata, e viceversa.

## Seriale o BLE: lo decide lo sketch

Niente jumper e niente riflash: `firmware/myoware` tiene su entrambi i trasporti
e manda i dati a quello che colleghi, **cambiando anche a caldo**.

Un solo trasporto per volta possiede la "linea" — il ring buffer ha un solo
consumatore, e duplicare lo stream non serve a nessuno. La regola è **vince
l'ultimo arrivato**: sul fronte di salita di un trasporto la linea passa a lui;
quando il proprietario cade, torna all'altro se è ancora su. Attacchi una cosa e
quella parla, la stacchi e l'altra riprende. A ogni cambio la base dei tempi
riparte da zero e la coda viene buttata, così il ricevente non si trova campioni
raccolti per qualcun altro.

Il perno è che **`(bool)Serial` significa davvero "un programma ha aperto la
porta"**: su questa board `Serial` è la USB CDC di TinyUSB, e il flag `connected`
del core segue DTR+RTS (`USBCDC.cpp`, `if (dtr && rts && !connected)`).
Attaccare la board a un caricatore, a un hub o a un PC che non apre nulla non lo
alza. Su un `Serial` che è UART hardware `operator bool()` è invece sempre vero e
il meccanismo non reggerebbe: c'è un `#error` che ferma la compilazione se
`ARDUINO_USB_CDC_ON_BOOT`/`ARDUINO_USB_MODE` non sono quelli giusti, invece di
lasciarti un firmware che non trasmette mai in BLE.

Effetto collaterale comodo: quando la linea è BLE (o non c'è) la seriale è
libera e ci finisce la diagnostica — `linea: BLE`, `linea: seriale`, i comandi
riconosciuti. Aprire il monitor seriale mentre il BLE trasmette **non** gli ruba
la linea, perché ruba solo chi *arriva*, e il BLE era già lì. Quando invece la
linea è la seriale la diagnostica tace, perché lì passano byte binari.

I comandi (`R`, `P<us>`) sono accettati solo dal trasporto che possiede la linea;
dall'altro vengono scartati, così nessuno riazzera la base dei tempi sotto i
piedi di chi sta registrando.

Mettere `MYO_ENABLE_SERIAL` o `MYO_ENABLE_BLE` a `0` compila via l'altro
trasporto e riporta lo sketch alla dimensione di un firmware dedicato — è la
via se ti serve solo la seriale e vuoi indietro i 20% di flash del BLE.

## Lo spettrogramma

Sta sotto al grafico e **condivide l'asse dei tempi**: stessi margini sinistro e
destro, stessa finestra, stesso cursore. Un artefatto EMG e il suono che lo
accompagna stanno sulla stessa verticale.

L'asse X è il tempo del **device** quando c'è un link — i campioni restano dove
li ha timbrati il firmware, che è tutto il punto del protocollo — e il tempo
dell'host quando non c'è. Le colonne di FFT arrivano dall'host, quindi la
conversione passa dalla regressione `host = a·device + b` già presente: è
esattamente la primitiva per cui era stata scritta. Quando la base dei tempi
cambia (connessione, reset del device) la storia dello spettrogramma si azzera,
perché è timbrata sulla base vecchia.

| controllo | cosa fa |
|---|---|
| `fino a` | frequenza massima mostrata, in kHz (limitata a Nyquist) |
| `log` | asse delle frequenze logaritmico da 40 Hz — comodo per la voce |
| `dB` | finestra di ampiezza mappata sulla colormap: il primo valore è il fondo, il secondo la saturazione |
| `FFT` | dimensione della finestra: decide il compromesso Δf = fs/N contro durata N/fs |
| `offset` | anticipo applicato ai timestamp audio, in ms |

`offset` serve perché la **latenza di acquisizione** (driver + buffer) non è
esposta dal browser: si tara una volta battendo un colpo sul sensore, che produce
insieme un artefatto EMG e un transiente sonoro, e si allineano a occhio.

Da tenere presente: con un link attivo l'allineamento vale quanto la regressione
del clock, che nei primi secondi di sessione è ancora grezza (poche decine di
punti, e sul BLE con gli stalli in mezzo) e può sbagliare la scala dell'ordine
del percento. Si assesta da sola dopo qualche secondo — lo si legge in **skew
clock** e **jitter (σ)**. Per misure fini, aspetta che quei due numeri si
stabilizzino prima di fidarti della sovrapposizione.

Alcune scelte non sono negoziabili se si vuole che quello che si vede sia vero:

- `echoCancellation`, `noiseSuppression` e `autoGainControl` sono **spenti**.
  Sono filtri pensati per le chiamate vocali: la soppressione del rumore buca lo
  spettro, il guadagno automatico rende il livello non confrontabile nel tempo.
- `smoothingTimeConstant = 0`: la media temporale dell'`AnalyserNode`
  spalmerebbe le colonne l'una sull'altra, cioè proprio sull'asse che qui conta.
- La colonna è timbrata al **centro** della finestra di FFT, non "adesso":
  l'analyser descrive gli ultimi `fftSize` campioni, non l'istante della lettura.
- Le colonne si campionano con un timer a passo fisso (metà finestra, 50% di
  sovrapposizione), **non** dentro `requestAnimationFrame`: la cattura non deve
  dipendere dal frame rate. Se una colonna manca si vede il buco, come sul
  grafico.
- L'`AnalyserNode` **non** è collegato a `destination`: sarebbe un feedback
  acustico.
- L'acquisizione tiene una finestra larga (−110…0 dB) e la finestra `dB` si
  applica solo in fase di disegno, così cambiare contrasto non ricampiona nulla.

La colormap è di tipo *magma*, monotona in luminanza: l'ampiezza si legge come
chiarezza, quindi resta corretta in bianco e nero e con qualunque daltonismo — ed
è il motivo per cui è lo standard per gli spettrogrammi. Il nero coincide col
fondo del pannello; i buchi si distinguono perché grigio-azzurri, non neri.

## Il timestamp

L'obiettivo è non accumulare errore. Tre scelte:

1. **Timer hardware, non `delay()`.** Un `esp_timer` periodico non accumula per
   costruzione, mentre `delay(50)` somma il tempo di esecuzione del loop a ogni
   giro.
2. **Si timbra col tempo *nominale* di griglia**, `t = t0 + k·periodo`, dove `k`
   è ricavato dal clock hardware (`k = round((now - t0)/periodo)`), non
   incrementato a mano. Così il jitter software non entra nel timestamp, e se
   un tick viene perso `k` si autocorregge invece di sfasare tutto il resto.
3. **Campionamento disaccoppiato dalla trasmissione.** Il timer scrive in un
   ring buffer, `loop()` lo svuota. Se lo stack BLE blocca per 30 ms, i
   timestamp restano corretti.

Resta solo la deriva del cristallo, ~40 ppm = 144 ms/ora: irrilevante per il
grafico. Per allineare all'audio, l'app stima `host = a·device + b` con una
regressione a dimenticanza esponenziale — `a` dà lo skew in ppm, `b` l'offset.
È già la primitiva che servirà per sincronizzare lo spettrogramma.

## Formato dei pacchetti

Little-endian. Stesso formato su entrambi i trasporti, così il parser è uno solo.

| off | size | campo | note |
|----:|-----:|-------|------|
| 0 | 1 | `magic` | `0xA5` |
| 1 | 1 | `version` | `0x01` |
| 2 | 1 | `n` | campioni nel pacchetto, ≥ 1 |
| 3 | 1 | `flags` | bit0 = conteggi ADC grezzi, bit1 = campioni persi prima di questo pacchetto |
| 4 | 2 | `seq` | contatore pacchetti, wrappa a 65536 |
| 6 | 4 | `t0_us` | `micros()` del campione `[0]`, wrappa ogni ~71.6 min |
| 10 | 4 | `dt_us` | spaziatura nominale fra campioni |
| 14 | 2·n | `samples` | `int16` |
| — | 2 | `crc16` | CRC-16/CCITT-FALSE sui byte precedenti |

I campioni di un pacchetto sono **garantiti equispaziati**: il campione `i` sta a
`t0_us + i·dt_us`. Se nel ring buffer c'è un buco il pacchetto si chiude prima,
quindi non esiste il caso "campioni contigui con un salto in mezzo".

`seq` è la chiave della misura: un salto = pacchetti perduti. Sul BLE succede
quando la coda TX del device è piena e `notify()` viene scartata silenziosamente.

**Seriale:** i pacchetti sono framati **COBS** con delimitatore `0x00`, quindi il
ricevente si risincronizza da solo dopo qualsiasi disturbo. In alternativa
`MYO_TEXT_MODE 1` emette CSV `t_us,valore` leggibile a occhio.

**BLE:** nessun COBS (il link layer ha già framing e CRC), pacchetti nudi su
notify.

## BLE: cose da sapere

**L'ESP32-S3 non ha il Bluetooth Classic.** Niente SPP, niente
`BluetoothSerial.h`, niente "accoppia come porta seriale". Solo BLE. È il
singolo fatto che fa perdere più tempo su questa board.

Si usa il **Nordic UART Service** (`6E400001-…`), così nRF Connect, Web
Bluetooth e Bluefy funzionano senza scrivere codice — utile per controprove
indipendenti dall'app.

`MYO_BLE_BATCH 1` produce pacchetti da 16 byte, che entrano anche nell'MTU
minimo di default (23 → 20 byte di payload): funziona con qualsiasi central
senza negoziazione. A 20 Hz sono 20 notify/s, nulla per il BLE. Alzalo solo
sopra i ~200 Hz **e** dopo aver verificato l'MTU negoziato — payload = MTU−3,
e servono 14 + 2·N byte. L'app mostra la dimensione del pacchetto ricevuto, e
il controllo CRC becca l'eventuale troncamento.

Il device chiede un connection interval di 7.5–15 ms, ma il central può
rifiutare: macOS e iOS tendono a stare su 15 ms, Android scende più in basso.

## Le statistiche dell'app

Servono a rispondere a "il BLE regge?" con numeri invece che a occhio:

- **campioni/s** — confrontato con gli Hz nominali; diventa rosso se si discosta.
- **pacchetti persi** — dai salti di `seq`. Questa è *la* metrica del BLE.
- **buffer pieno** — flag dal device: il trasporto non tiene il passo del
  campionamento. Diverso da "persi in radio", e va risolto sul firmware.
- **ritardo / ritardo max** — distanza fra il cursore (che avanza col clock
  reale) e l'ultimo campione arrivato. Se la radio stalla, lo vedi crescere.
- **jitter (σ)** — deviazione standard del ritardo residuo rispetto alla
  regressione del clock.
- **skew clock** — ppm di differenza fra cristallo del device e clock dell'host.
- **livello / clip audio** — RMS in dBFS e numero di colonne a fondo scala. Se
  `clip` sale, il microfono sta saturando e lo spettro non è più affidabile.
- **colonne/s** — cadenza effettiva della FFT, da confrontare con `hop` scritto
  accanto ai controlli dello spettrogramma.

Il grafico disegna ogni campione al **suo** timestamp, non a intervalli
regolari, e spezza la linea sui buchi. Con dati in ritardo il tracciato resta
corretto e il buco si vede come tale: è tutto il motivo per cui vale la pena
mandare il timestamp.

## Stato

Fatto: firmware unico seriale + BLE con scelta automatica del trasporto,
protocollo, grafico live, spettrogramma e strumentazione.

Verificato:

- Lo sketch compila per `arduino:esp32:nano_nora` (core **2.0.18-arduino.5**)
  senza alcun warning, anche con `--warnings all`, in tutte e cinque le
  combinazioni di `MYO_ENABLE_SERIAL` / `MYO_ENABLE_BLE` / `MYO_TEXT_MODE` che
  hanno senso. Tenere su entrambi i trasporti non costa nulla rispetto ai due
  firmware dedicati di prima: 29% flash / 19% RAM con entrambi, 9% / 11% con il
  solo seriale.
- La guardia `#error` scatta davvero, provata forzando sia
  `ARDUINO_USB_CDC_ON_BOOT=0` sia `ARDUINO_USB_MODE=1`.
- CRC-16/CCITT-FALSE: `0x29B1` sul vettore di riferimento `"123456789"`, in C e in JS.
- COBS: 4000 vettori casuali prodotti dall'encoder C e riletti dal decoder JS
  dell'app, 0 fallimenti — inclusi run senza zeri più lunghi di 254 byte e
  payload tutti-zero. Verificata anche la risincronizzazione dopo spazzatura.
- Srotolamento del timestamp a 32 bit: corretto e monotono attraverso il wrap
  di 2³², anche con pacchetti perduti. Unico caso ambiguo, per costruzione: un
  buco di trasmissione più lungo di 71.6 minuti.
- Spettrogramma, in Chrome headless pilotato via CDP col microfono finto
  (`--use-fake-device-for-media-stream`) e un tono iniettato nell'analyser:
  - cadenza delle colonne 91/s contro 91 attese (FFT 1024 a 48 kHz, hop 11 ms),
    timestamp monotoni;
  - tono a 2000 Hz → bin 43 = 2016 Hz, con Δf = 46.9 Hz è il bin giusto; la riga
    di pixel più chiara cade dove la dice l'asse, in scala lineare e log, a meno
    della riga che il *max pooling* aggiunge quando ci sono più bin che pixel;
  - il confine fra buco e dati cade entro 8 pixel su 1177 (0.7%) da dove lo
    colloca l'asse dei tempi, cioè la mappatura tempo → pixel è quella dichiarata;
  - al cambio di base dei tempi (link che si connette a microfono già aperto) la
    storia si azzera e si ricostruisce, e i due flussi restano sullo stesso asse:
    ultimo campione EMG e ultima colonna entro qualche decina di ms dal cursore.

Non ancora provato su hardware.

Nota: il pulsante *Simulatore* genera valori 300–2100, fuori dalla Y di default
(0–1000), quindi la traccia esce dall'inquadratura. È così da prima; *Auto Y*
sistema la vista.

Per compilare senza aprire l'IDE (l'`arduino-cli` è dentro l'app):

```sh
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
"$CLI" compile -b arduino:esp32:nano_nora firmware/myoware
"$CLI" upload  -b arduino:esp32:nano_nora -p /dev/cu.usbmodemXXXX firmware/myoware
```

## Prossimi passi

In ordine di dipendenza:

1. **Registrazione e riascolto** — l'audio con `MediaRecorder` (o PCM grezzo da
   un `AudioWorklet`, che darebbe campioni esatti e permetterebbe di ricalcolare
   lo spettrogramma offline invece di conservare le colonne); i campioni EMG sono
   già in un array. Serve una timeline di riproduzione che piloti `tNow` invece
   del clock, cioè un cursore scrubbabile al posto di `T.now()`.
2. **Seriale su Android**, se servirà — via **WebUSB** (funziona su Chrome
   Android e parla direttamente col CDC-ACM della board). Il decoder e il
   parser sono già indipendenti dal trasporto: si aggiunge solo una
   `connectUsb()`. Web Serial invece su Android non esiste.
3. **Port nativo**, solo se servono iOS o installer distribuibili: Flutter con
   `flutter_blue_plus` + `flutter_libserialport` + `usb_serial`. Protocollo e
   logica di analisi si riusano; il grafico va riscritto con un `CustomPainter`
   perché `fl_chart` non regge lo streaming.
