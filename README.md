# MyoLink

MyoWare → Arduino Nano ESP32 → grafico live, via **seriale** o **BLE**, con
timestamp a cadenza esatta per poter ricostruire il segnale anche in presenza
di ritardi o pacchetti perduti. Sotto al grafico, la **nota cantata** e lo
**spettrogramma del microfono**, sullo stesso asse dei tempi.

**App online: <https://myolink.vercel.app>** — Chrome o Edge. Senza hardware si
vede comunque tutto: il pulsante *Simulatore* genera i pacchetti dentro il
browser, e il *Microfono* con pitch e spettrogramma è un flusso indipendente che
funziona da solo.

```
firmware/myoware/myoware.ino   sketch unico: seriale + BLE, sceglie da solo (vedi sotto)
firmware/myoware/myolink.h     campionamento + formato pacchetto
app/index.html                 ricevitore web: grafico live, pitch, spettrogramma, statistiche del link
```

## Avvio rapido

**Firmware.** Apri `firmware/myoware` nell'IDE Arduino, board *Arduino Nano
ESP32*, carica. Non devi scegliere il trasporto: lo sketch parla con quello che
colleghi. Tutto ciò che si tocca sta in cima al `.ino`:

| define | default | cosa fa |
|---|---|---|
| `MYO_PIN` | `A0` | ingresso analogico (uscita ENV del MyoWare) |
| `MYO_PERIOD_US` | `50000` | periodo di campionamento, 50 ms = 20 Hz |
| `MYO_SIMULATE` | `0` | `1` = linea finta invece dell'ADC, `0` = sensore reale |
| `MYO_SIM_MAX` | `1000` | fondo scala del segnale simulato |
| `MYO_ENABLE_SERIAL` | `1` | compila il trasporto seriale |
| `MYO_ENABLE_BLE` | `1` | compila il trasporto BLE (costa 20% di flash e 8% di RAM) |
| `MYO_TEXT_MODE` | `0` | solo seriale: `1` = CSV `t_us,valore` invece del binario |

`MYO_SIMULATE` è a **0**: legge il MyoWare vero. **Mettilo a 1 per provare tutta
la catena senza sensore attaccato** — genera un random walk con inerzia in
0..1000, cioè una linea continua che vaga (~2.7 count per campione, non rumore),
che rimbalza sui bordi invece di saturare, così un clipping vero non si confonde
col simulatore.

**App.** Pronta all'uso su <https://myolink.vercel.app>, in Chrome o Edge:
*Collega seriale* (desktop) oppure *Collega BLE* (desktop e Android).

Per modificarla serve un server locale, perché Web Serial, Web Bluetooth e il
microfono richiedono un contesto sicuro — `https` oppure `localhost`, e **non
`file://`**:

```sh
python3 -m http.server -d app 8000    # poi apri http://localhost:8000
```

Il campo **Y** va messo `0`–`1000` col simulatore del firmware e `0`–`4095` col
sensore reale (ADC a 12 bit); il pulsante *Auto Y* lo calcola sui dati visibili.

Il pulsante **Simulatore** è una cosa diversa da `MYO_SIMULATE`: genera i
pacchetti *dentro il browser*, con perdite e stalli radio artificiali, e serve
a provare la UI senza nemmeno la board.

Il campo `Hz` + *Applica* cambia la frequenza di campionamento a caldo, senza
riflashare — comodo per cercare il punto di rottura del BLE.

**Microfono.** Il pulsante *Microfono* apre i due pannelli audio, pitch e
spettrogramma. È un flusso indipendente: funziona anche senza board collegata, e
viceversa.

**Se qualcosa non parte.** La prima riga del log dice quali API ci sono e in che
stato è il permesso del microfono; quando una richiesta fallisce, sotto
l'errore compare dove guardare. I fallimenti di `getUserMedia` e
`requestDevice` si distinguono dal `name` della `DOMException`, non dal
`message` — che in Chromium è spesso vuoto.

Quasi sempre la causa sta fuori dall'app, ed è una di queste tre: il browser non
ha il microfono (o il Bluetooth) fra le **autorizzazioni di sistema** — su
Android è il caso più comune del prompt che non compare, ed è tipico di un
browser installato da poco; il **sito** è bloccato nelle sue impostazioni;
oppure Web Bluetooth è **disabilitato di default dal browser**, come su Brave,
e va attivato a mano. Nessuna delle tre è aggirabile da JavaScript.

Ancora su Brave: applica *farbling* antifingerprint alle API Web Audio, cioè
perturba leggermente l'output dell'`AnalyserNode`. Visivamente irrilevante sullo
spettrogramma, ma vale la pena saperlo prima di fidarsi di una misura fine.

**I pannelli.** Ognuno ha una barra con il nome, i suoi controlli e una freccia
che lo **comprime**; il bordo inferiore si trascina per **ridimensionarlo**. La
larghezza no: è quella che tiene allineati gli assi dei tempi.

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

## Il pitch

Sta fra il grafico del sensore e lo spettrogramma, perché è quello che si
confronta a occhio col sensore. Risponde alla domanda "quel disturbo è successo
su una nota particolare?".

L'asse Y è in **semitoni**, non in Hz: un semitono è un rapporto costante, quindi
in questa scala un vibrato di mezzo tono è alto uguale a C3 e a C5. Lo sfondo è
una tastiera — tasti neri come bande scure, i DO con la linea marcata — e i nomi
delle note stanno su **entrambi** i margini, più una targhetta all'altezza della
linea sul margine destro: dal vivo si guarda il bordo destro, perché è lì l'ora
attuale. Il range si autoadatta ai dati visibili, oppure si fissa a mano con due
nomi di nota (`C2`, `F#3`, `Bb4`).

La stima è **YIN**: funzione differenza sul segnale nel tempo, normalizzazione
cumulativa, prima discesa sotto soglia, interpolazione parabolica del minimo. Il
picco dello spettro *non* andrebbe bene: sulla voce la fondamentale è spesso più
debole della seconda o terza armonica, e si sbaglierebbe l'ottava di continuo.

| controllo | cosa fa |
|---|---|
| `clarity ≥` | sotto questa soglia la linea si interrompe invece di inventare una nota |
| `auto Y` | range verticale che insegue le note in vista; togliendolo si fissa con `da`/`a` |
| `anche sullo spettrogramma` | ridisegna la stessa linea sopra lo spettrogramma |

**La clarity è la cosa importante.** È `1 − CMND` al minimo scelto, cioè quanto
il segnale è davvero periodico: la striscia colorata sotto la linea la mostra
istante per istante. Su voce pulita sta sopra 0.95; sul silenzio, sulle
consonanti e sul rumore crolla, e la linea si spezza — che è la risposta onesta.

Due limiti da conoscere:

- **YIN è monofonico.** Con una base musicale in cassa il microfono sente due
  sorgenti armoniche e la stima si aggancia alla più forte, spesso il basso. Non
  è aggirabile: **con le cuffie** il microfono prende solo la voce e torna
  pulita. La clarity segnala il caso, non lo risolve.
- **Ai cambi di nota la finestra da ~90 ms resta contaminata per qualche hop** e
  può uscirne uno spurio d'ottava. Non c'è nessun filtro sul valore: una mediana
  corta non toglierebbe una raffica di 4 campioni e rischierebbe di propagarne
  uno sbagliato. Gli spuri restano quindi **visibili**; è l'auto-range a essere
  robusto, perché usa i percentili al 2% invece di minimo e massimo, così un
  singolo salto non schiaccia la scala. Chi esce dal quadro va a sbattere sul
  bordo, e lo si vede.

Sotto il cofano: `AnalyserNode` dedicato con finestra **fissa** a 4096 campioni
(~85 ms, cinque periodi anche a 65 Hz), indipendente dalla `FFT` dello
spettrogramma — con `FFT 512` la finestra sarebbe 10 ms e non ci starebbe nemmeno
un periodo. Il segnale viene decimato a ~12 kHz con una media mobile, i cui zeri
cadono esattamente sulle frequenze che il sottocampionamento ripiegherebbe verso
il basso: fa da antialias senza filtro dedicato, e il costo scende col quadrato
del fattore. Range coperto **B1–E6** (60–1300 Hz), una stima ogni 20 ms.

## Lo spettrogramma

Sta sotto al grafico e **condivide l'asse dei tempi** con gli altri due pannelli:
stessi margini sinistro e destro, stessa finestra, stesso cursore. Un artefatto
EMG e il suono che lo accompagna stanno sulla stessa verticale.

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

`offset`, in cima alla pagina accanto a *Microfono*, vale per **entrambi** i
pannelli audio: sono timbrati dallo stesso orologio e non possono scollarsi fra
loro. Serve perché la **latenza di acquisizione** (driver + buffer) non è
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
- **nota / clarity** — l'ultima stima di pitch e quanto vale. `nota` resta `—`
  finché la clarity non supera la soglia del pannello.

Il grafico disegna ogni campione al **suo** timestamp, non a intervalli
regolari, e spezza la linea sui buchi. Con dati in ritardo il tracciato resta
corretto e il buco si vede come tale: è tutto il motivo per cui vale la pena
mandare il timestamp.

## Stato

Fatto: firmware unico seriale + BLE con scelta automatica del trasporto,
protocollo, grafico live, pitch, spettrogramma e strumentazione.

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
- Pitch, stessa impalcatura. Su un timbro fatto apposta per far sbagliare
  l'ottava (fondamentale a 0.15, seconda e terza armonica a 0.55 e 0.45):
  - C2, C3, A3, C4, A4, C5, A5 riconosciute tutte, **nessun errore di ottava**,
    scarto entro **2 cent**, clarity 0.91–0.999;
  - rumore bianco → clarity **0.085**, cioè respinto dalla soglia di default;
    silenzio digitale → nessuna stima, nessun punto nello store;
  - **0.153 ms** per stima, cioè 0.8% di un core al passo di 20 ms;
  - catena completa (oscillatore → analyser → YIN → store → grafico) con una
    melodia C3 G3 C4 E4 A4 C5: 414 stime su 419 sopra soglia, ~62 per nota come
    atteso, e i 10 spuri sono tutti sui gradini istantanei fra una nota e
    l'altra — un salto che la voce non fa.
- Diagnostica dei permessi, in Chrome headless: riga d'ambiente all'avvio, un
  messaggio con istruzione per ogni `name` mappato, degradazione pulita su un
  `name` sconosciuto, e — col permesso a `denied` — `getUserMedia` che **non
  viene nemmeno chiamata**, con il motivo scritto nel log.
- Pannelli: piega, ripiega e ridimensionamento (190 → 300 px → compresso a 0)
  senza errori JS e senza toccare la larghezza, quindi gli assi restano allineati.

Nota sul banco di prova: il dispositivo audio finto di Chrome emette silenzio più
**click a fondo scala**, che sono impulsi a banda larga e da soli fanno sbagliare
l'ottava a YIN. Vanno scollegati (`A.src.disconnect()`) prima di iniettare il
tono, altrimenti si misura il rumore del banco. `--use-file-for-fake-audio-capture`
non inietta nulla in headless: la traccia resta a −120 dBFS.

Non ancora provato su hardware, e il pitch non ancora provato su voce vera.

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

Il piano di lavoro sta in **[docs/PIANO.md](docs/PIANO.md)**, in quattro fasi
indipendenti e ripartibili a freddo:

1. **Diagnostica dei permessi** — fatta, vedi sopra.
2. **Build** — sorgenti a moduli ES e test unitari con Vite, bundle in uscita.
   Non per velocità (66 KB in un file sono già l'ottimo), ma per i test sulle
   parti numeriche e per poter usare dipendenze npm.
3. **UI mobile** — stessa pagina con un breakpoint, non una versione separata.
4. **Registrazione video + audio** — canvas di composizione e `MediaRecorder`,
   con la sincronia A/V garantita dal recorder. Solo esportazione: niente
   riapertura di sessione.

Fuori piano per ora: timeline scrubbabile e render offline in WebCodecs;
**seriale su Android** via WebUSB (Web Serial su Android non esiste, e il parser
è già indipendente dal trasporto: basterebbe una `connectUsb()`); **port nativo**
in Flutter, solo se servono iOS o installer distribuibili.

## Deploy

`app/index.html` è un file statico unico, senza dipendenze e senza build: va su
qualsiasi hosting statico copiandolo. L'unico requisito è **https**, che i
permessi di Web Serial, Web Bluetooth e microfono pretendono.

Su Vercel il progetto ha **Root Directory = `app`**, così `index.html` finisce
sulla radice del sito e il resto del repo (firmware, README) non viene
pubblicato. Non c'è `vercel.json` perché non serve nulla da configurare — e con
la Root Directory impostata un `vercel.json` nella radice del repo verrebbe
comunque ignorato: Vercel lo cerca dentro la root directory, cioè in `app/`.

## Licenza

MIT — vedi [LICENSE](LICENSE).
