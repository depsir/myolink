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
app/                           ricevitore web (Vite): grafico live, pitch, spettrogramma, statistiche
app/src/core/                  protocollo, clock, store, ingestione, calibrazione, fatica, momenti — senza DOM, quindi testabili
app/src/audio/                 acquisizione microfono, YIN, e il nastro per riascoltare
app/src/draw/                  i tre canvas, che condividono l'asse dei tempi
app/src/record/                registrazione video+audio ed export CSV
app/tools/                     i moduli veri su un CSV già registrato, e il banco di prova in Chrome headless
app/test/                      test unitari (vitest)
docs/PIANO.md                  piano di lavoro per fasi, con le misure da cui vengono le costanti
```

## Avvio rapido

**Firmware.** Apri `firmware/myoware` nell'IDE Arduino, board *Arduino Nano
ESP32*, carica. Non devi scegliere il trasporto: lo sketch parla con quello che
colleghi. Tutto ciò che si tocca sta in cima al `.ino`:

| define | default | cosa fa |
|---|---|---|
| `MYO_PIN` | `A0` | ingresso analogico (uscita ENV del MyoWare) |
| `MYO_PERIOD_US` | `10000` | periodo di campionamento, 10 ms = 100 Hz |
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

**App.** Pronta all'uso su <https://myolink.vercel.app>, in Chrome o Edge.

Si apre in **modo semplice**, che è quello con cui si canta: due interruttori —
*Sensore* e *Microfono* — un riquadro che dice quanto stai spingendo, e i
grafici. Gli ingressi sono uno stato permanente e la registrazione è un'azione
sopra di essi: se registri, registri tutto quello che è acceso, e ogni ingresso
incluso porta il suo pallino rosso. Ci sono **due fasi e non cinque stati**: *dal
vivo* (o *registrando*, che è la stessa vista più il tempo) e *la presa*, dove
tutto è fermo sulla registrazione appena fatta e la striscia dei momenti è la
navigazione. *Registra* non esiste mentre guardi una presa, *Salva* ed *Elimina*
non esistono dal vivo — per rifare si torna al vivo, ed è lì che l'app chiede se
salvare quella che stai per perdere. Il perché di ognuna di queste scelte sta in
[docs/PIANO-fase7.md](docs/PIANO-fase7.md).

L'interruttore in alto passa al **modo avanzato**, che è quello descritto nel
resto di questo file: tutti i comandi, le misure in tre famiglie, il registro.
La scelta si ricorda. Lì i collegamenti sono espliciti — *Collega seriale*
(desktop) oppure *Collega BLE* (desktop e Android) — e ci sono il *Simulatore* e
la *Calibrazione*, che nel semplice non compaiono.

Collegato, la lettura è continua e non si mette in pausa: *Disconnetti* chiude il
link — i dati già letti restano in memoria, e i grafici si fermano sull'ultimo
campione. Registrare è una cosa a parte, e si può accendere e spegnere quante
volte si vuole mentre il link resta aperto.

Per modificarla:

```sh
cd app
npm install
npm run dev      # http://localhost:5173, con ricarica a caldo
npm test         # protocollo, COBS, clock, store, YIN, impaginazione del video, CSV
npm run build    # bundle in app/dist
```

Il server di sviluppo serve su `localhost`, che è quello che serve: Web Serial,
Web Bluetooth e il microfono pretendono un contesto sicuro — `https` oppure
`localhost`, e **non `file://`**.

Il taglio in moduli segue una regola sola: **`core/` e `audio/pitch.js` non
toccano il DOM**, e sono infatti i moduli coperti dai test — CRC, COBS,
srotolamento del timestamp, regressione del clock, ring buffer, YIN. Il resto
(disegno, pannelli, statistiche) è UI e si verifica in browser. Per quella parte
c'è `window.MyoLink`, che espone gli oggetti di stato: con i moduli ES le
variabili di primo livello non sono più globali, e il banco di prova in Chrome
headless via CDP legge lo stato da lì.

Il campo **Y** va messo `0`–`1000` col simulatore del firmware e `0`–`4095` col
sensore reale (ADC a 12 bit); il pulsante *Auto Y* lo calcola sui dati visibili.

La **legenda sotto il grafico** è anche il suo comando: le tre voci sono le tre
letture sovrapposte del segnale — `grezza` i campioni, `mediana` la mediana a
300 ms, `sforzo` la linea colorata per zona con le sue due righe a +30 e +55 — e
si cliccano per spegnerle. La nuvola dei grezzi nasconde le altre due proprio
quando servono, e la linea dello sforzo — 2 px e opaca — copre la mediana ogni
volta che il segnale è fermo. Il numero in alto a sinistra resta anche a tracce
tutte spente: è la lettura, non una traccia. **Il video segue la legenda**,
perché il registratore copia questo canvas.

Le scelte si ricordano, e sono **due memorie separate per modo**: in avanzato
partono tutte e tre accese, nel semplice solo lo sforzo. Quello che si vuole
vedere mentre si canta non è quello che si vuole vedere mentre si cerca un
artefatto, e il modo è già la parola che distingue i due casi.

Il pulsante **Simulatore** è una cosa diversa da `MYO_SIMULATE`: genera i
pacchetti *dentro il browser*, con perdite e stalli radio artificiali, e serve
a provare la UI senza nemmeno la board.

Il campo `Hz` + *Applica* cambia la frequenza di campionamento a caldo, senza
riflashare — comodo per cercare il punto di rottura del BLE.

**Microfono.** Il pulsante *Microfono* apre i due pannelli audio, pitch e
spettrogramma. È un flusso indipendente: funziona anche senza board collegata, e
viceversa.

**Registrare.** *Registra* salva un `.mp4` unico con i pannelli spuntati sotto
⚙ (`video: sensore / pitch / spettro`) e l'audio del microfono. Un canvas fuori
schermo riceve a ogni fotogramma i tre canvas impilati, `captureStream` lo
trasforma in traccia video, e nello **stesso** `MediaStream` entra la traccia
audio: la sincronia audio/video la garantisce il registratore, che timbra le due
tracce con lo stesso orologio, e non c'è niente da allineare a mano. L'`offset`
audio agisce sul disegno, quindi finisce dentro il video da sé — il file mostra
esattamente quello che si vedeva a schermo.

**L'ordine dei due pulsanti non conta.** La traccia audio del file non è quella
del microfono: è quella di un *bus* (`src/audio/bus.js`) che vive per tutta la
registrazione, e a cui il microfono si aggancia quando lo apri. Serve perché un
`MediaRecorder` fotografa le tracce all'avvio e una traccia aggiunta dopo non
entra nel file: prendendo il microfono direttamente, *Registra* e poi *Microfono*
dava un mp4 muto per sempre. Col bus, aprire il microfono a metà registrazione
mette silenzio prima e audio dopo, e chiuderlo torna al silenzio invece di
troncare la traccia.

Il silenzio va **prodotto**, non sottinteso: una destinazione Web Audio senza
niente collegato non emette campioni, e la traccia esce senza dati — l'mp4
registrato senza mai aprire il microfono non aveva nemmeno la traccia audio, e
quello col microfono aperto a metà aveva 2,5 s di audio su 5 di video, ribasati a
zero, cioè sfasati. Quindi un `ConstantSourceNode` a offset 0 resta collegato per
tutta la registrazione, e per la stessa ragione l'avvio **aspetta** che il
contesto audio stia davvero macinando prima di far partire il registratore: sono
le due cose che tengono l'audio allineato al video.

Tre cose da sapere prima di premerlo:

- **Non cambiare scheda mentre registri.** In background `requestAnimationFrame`
  si ferma, il canvas non cambia più e il video prende un fotogramma lunghissimo.
  Il log lo dice quando succede, ma il file è già rovinato.
- **H.264 + AAC in mp4**, chiesti per nome e negoziati con
  `MediaRecorder.isTypeSupported`; WebM VP9 resta come ripiego dove l'mp4 non si
  può registrare. I codec vanno chiesti **espliciti**: con `video/mp4` liscio
  Chrome sceglie da sé e nelle prove ha messo dentro ora H.264+Opus ora VP9, che
  in un mp4 sono le combinazioni che QuickTime non apre.
- **La risoluzione del file è quella a cui l'app disegna**, cioè pixel CSS per
  `devicePixelRatio` (limitato a 2). Su un monitor non-Retina si registra a metà
  per lato — un quarto dei pixel — e nessun bitrate lo recupera: il log lo dice
  all'avvio quando `dpr < 2`. Se il video esce sgranato, la prima leva è la
  finestra più grande, non l'encoder.
- I chunk stanno in RAM, quindi per sessioni oltre i ~10 minuti conviene
  spezzare.

**Quanto bitrate, e perché il primo numero era sbagliato.** La prima stesura
chiedeva 0.12 bit per pixel per fotogramma, ragionando sulle tracce: grafica
vettoriale su fondo scuro, dove i bitrate da fotocamera sono soldi buttati. Il
ragionamento vale però per due strati su tre — lo **spettrogramma è rumore a
tutti gli effetti**, e con lui nel fotogramma l'encoder ruba bit alle linee
sottili, che è da dove viene l'alone granuloso attorno ai tratti. Ora sono
**0.28 bpp**, con pavimento a 4 e tetto a 32 Mb/s.

È un *permesso* di spendere, non un costo: in una prova col simulatore a
1240×380 il registratore ha chiesto 4 Mb/s e il file è uscito a **1.06**
(`ffprobe`), perché con pannelli quasi fermi non c'era altro da codificare. Il
conto pieno si paga quando lo spettro si muove davvero, che è quando serve —
caso peggiore nell'ordine dei 100 MB al minuto a piena risoluzione Retina. Il
log di salvataggio stampa il bitrate medio effettivo, così il conto si vede
senza `ffprobe`.

Il profilo H.264 chiesto è **High** (`avc1.640028`), poi Main, poi baseline.
Baseline — che era la prima e unica scelta — è l'unico dei tre senza CABAC né
trasformata 8×8, cioè privo di ciò che serve sui bordi netti. Misurato però a
pari bitrate (x264 `veryfast`/`zerolatency`, che imita il vincolo realtime del
browser, contro una sorgente lossless) il salto sulla luma è **modesto: +0.08 dB
di PSNR**. La nitidezza la compra il bitrate, non il profilo. Dove High vince è
la **crominanza, +1.17 dB**, ed è il difetto giusto: per il sottocampionamento
4:2:0 una traccia colorata da un pixel su fondo scuro sbava per costruzione.
Vale la pena chiederlo perché è gratis — il file esce anche un po' più piccolo —
non perché risolva.

I tre profili restano tutti in lista perché `isTypeSupported` risponde sul MIME
e **non** sull'encoder che c'è davvero: dove H.264 è software (OpenH264 fa solo
baseline) il sì diventa un'eccezione al `new MediaRecorder`, e si scende lungo la
lista invece di rinunciare a registrare. Verificato con `ffprobe` che Chrome
onora il profilo chiesto: nel file finisce `profile=High`, col livello
rinegoziato secondo la risoluzione (`640028` → `640020`). Quel livello lo si sa
solo a encoder partito — appena costruito, `rec.mimeType` rieccheggia la
richiesta — quindi il blob prende il MIME **alla chiusura**, o dichiarerebbe
l'intenzione invece del contenuto.

**Perché mp4 e non WebM**, che pure sarebbe il formato di casa di Chrome. Due
ragioni misurate, e nessuna delle due è la qualità:

1. **macOS non legge il WebM.** Niente anteprima nel Finder, niente miniatura,
   niente QuickTime: serve per forza Chrome o VLC. Con l'mp4 QuickLook genera la
   miniatura e il doppio clic funziona — è la differenza fra un file che si
   condivide e uno che si spiega.
2. **Il WebM di `MediaRecorder` non dichiara la durata.** È un flusso *live*:
   `Duration`, `SeekHead` e `Cues` (l'indice dei cluster) non ci sono, perché a
   inizio file non si sa ancora dove finiranno. Qualche player non mostra la
   barra e non fa seek. L'mp4 dello stesso registratore la durata ce l'ha.

Se ti capita fra le mani un `.webm` di una versione precedente, `ffmpeg -i
vecchio.webm -c copy sistemato.webm` gli ricostruisce durata e indice.

**Il messaggio di macOS «Apple could not verify…»** quando apri il file scaricato
**non c'entra col formato**: è la quarantena (`com.apple.quarantine`) che il
browser mette su *qualsiasi* download. Verificato che il verdetto di Gatekeeper è
identico su mp4 e su webm con la stessa quarantena. Si toglie con
`xattr -d com.apple.quarantine file`, oppure una volta sola da Impostazioni →
Privacy e sicurezza → *Apri comunque*.

Quello che si vede a schermo si registra com'è: geometria e strati si fissano
alla partenza, perché un `MediaRecorder` non cambia risoluzione a metà stream.
Se durante la registrazione ridimensioni un pannello, il video lo scala dentro lo
spazio che aveva; se lo comprimi, la sua banda resta fondo.

**I dati escono in CSV, e sono due casi diversi.** `t_s,valore` con il tempo a
microsecondi, che è la risoluzione a cui timbra il firmware; è l'unico output con
cui una prova si **rianalizza**, perché un video non lo è.

- **I dati della registrazione** stanno dentro la registrazione: allo stop l'app
  congela i campioni dell'intervallo registrato, e *Salva video + CSV* scarica
  tutto insieme — `myolink-<data>.mp4`, `myolink-<data>.csv` e, se il microfono
  era aperto, `myolink-<data>.pitch.csv`. Stesso timbro nel nome, così i tre file
  si riconoscono come lo stesso pezzo di prova stando uno accanto all'altro.
  Si congelano allo **stop** e non al salvataggio: lo store è un anello, e a 1 kHz
  tiene ~7 minuti — riascoltarsi, guardare i *Momenti* e poi salvare troverebbe
  l'inizio della prova già mangiato da quello che è arrivato dopo.
- **Tutta la memoria** è l'altro pulsante, *CSV live*: quello che c'è negli store
  in questo momento, registrazione o no, calibrazione compresa. Serve a
  rianalizzare una sessione intera; per i dati *di quella prova* c'è il primo.

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

**Su un telefono.** Stessa pagina e stesso codice di disegno: cambia
l'impaginazione, con due media query e nessuna versione mobile separata.

- I controlli si spostano in **cassetti**: il ⚙ dell'header apre offset,
  finestra e Hz; il ⚙ di ogni pannello apre i suoi. In barra restano il nome, la
  freccia di piega e lo stato della connessione, cioè quello che si guarda
  mentre si registra.
- Le **altezze** passano da px a frazioni di `svh` — la misura del viewport col
  browser a barre visibili, che non cambia mentre si scrolla e quindi non fa
  ricalcolare i canvas a ogni pixel. In portrait si vedono due pannelli interi.
- Il **grip** di ridimensionamento passa da 7 a 22 px di area utile (la riga
  disegnata resta sottile) e ha `touch-action: none`, che è ciò che impedisce al
  browser di leggere il trascinamento come uno scroll della pagina.
- I **margini degli assi** si stringono da 52/40 a 34/30 px sotto i 520 px di
  larghezza: su 390 px erano un quarto dello schermo. Dipendono solo dalla
  larghezza, che i tre canvas hanno identica, quindi l'allineamento dei tempi
  resta garantito per costruzione.
- Il **telefono coricato** è il caso meno ovvio: 844×390 è largo abbastanza per
  l'impaginazione desktop ma alto la metà di un pannello, e con i bersagli da 40
  px l'header andava a tre righe. I cassetti valgono quindi anche a `max-height`,
  le righe dell'header solo a `max-width`.

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
istante per istante — verde sopra soglia, gialla appena sotto, rosso scuro dove
la stima non è credibile. Su voce pulita sta sopra 0.95; sul silenzio, sulle
consonanti e sul rumore crolla, e la linea si spezza — che è la risposta onesta.
La striscia c'è **solo in avanzato**: è il modo in cui si tara la soglia, che è
un comando di lì. Nel semplice non c'è, perché lì non è spiegata da niente e una
fila di puntini colorati sotto un grafico viene letta come un secondo grafico —
mentre quello che dice si vede già nei buchi della linea.

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

**Limite noto**, emerso scrivendo i test: lo srotolamento non può distinguere
"il device è ripartito da zero" da "sono passati ~71.6 minuti", quindi un reset
del device **senza** riconnessione viene letto come un salto in avanti di ~4294
secondi invece che come un ritorno indietro, e il controllo di monotonia non
scatta. Succede solo sulla seriale, dove la porta resta aperta attraverso il
reset della board; su BLE il link cade e `startSession` azzera lo srotolamento.
Il caso è fissato in un test, che documenta il comportamento attuale invece di
pretendere quello desiderato.

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
senza negoziazione. A 100 Hz sono 100 notify/s, nulla per il BLE. Alzalo solo
sopra i ~200 Hz **e** dopo aver verificato l'MTU negoziato — payload = MTU−3,
e servono 14 + 2·N byte. L'app mostra la dimensione del pacchetto ricevuto, e
il controllo CRC becca l'eventuale troncamento.

Il device chiede un connection interval di 7.5–15 ms, ma il central può
rifiutare: macOS e iOS tendono a stare su 15 ms, Android scende più in basso.

## Calibrazione

Il count del MyoWare **non ha unità**: dipende da impedenza cutanea, posizione
degli elettrodi, guadagno e tessuto, quindi `800` significa cose diverse su due
persone e su due sessioni della stessa persona. Il pulsante *Calibra* (sotto ⚙)
misura gli estremi una volta, e da lì il segnale si legge normalizzato.

Il sensore va sull'**addome laterale**, allineato alle fibre dell'obliquo
esterno — diagonali, verso il basso e l'avanti. È un muscolo del *sostegno del
fiato*, non della tensione laringea: "troppo" vuol dire spinta o appoggio
premuto, "troppo poco" vuol dire fiato non sostenuto.

Quattro blocchi cronometrati, ognuno con due secondi di *preparati* davanti:

| blocco | cosa si fa | cosa se ne ricava |
|---|---|---|
| riposo, 10 s | fermo, respiro tranquillo | la **base** (mediana) e il **rumore** |
| massimo **tenuto**, 3 × 4 s | `"sssh"` continua per tutti i 4 s, espirando fino a svuotarsi | il **plateau sostenibile**: mediana delle tre prove |
| accenti **secchi**, 10 s | cinque `"SH!"` (o `"HA!"`) staccati | la **forma** di un'attivazione pulita — picco, salita, durata — e il tetto **istantaneo** |
| riferimento, 8 s | una frase comoda a mezzo volume | l'**appoggio normale** |

Il massimo non è un MVC anatomico (una flessione del tronco contro resistenza è
scomoda e poco ripetibile) ma un massimo **funzionale**, che sta già nel gesto
del cantante. Le tre prove non si concatenano da sole: dopo un'espirazione
forzata serve respirare, e quanto non lo può indovinare un timer.

**I due tetti differiscono di molto, e non è un difetto.** Su una registrazione
vera il tenuto arrivava a +42 count (l'1% della scala dell'ADC) e l'accento a
+808 (il 20%): **17 volte**. Un colpo balistico raggiunge un'ampiezza che non si
riesce a tenere. Quindi i due servono a due cose: l'**accento** risponde a "il
sensore vede questo muscolo?" ed è lui il riferimento dell'SNR; il **tenuto**
resta il denominatore di `%max`, perché è il massimo *sostenibile* ed è quello
confrontabile con una frase cantata, che è sostenuta. Quando il tenuto è molto
più debole dell'accento il verdetto lo dice, e dice la conseguenza: `%max` è una
scala debole, si usa `×rif`.

**Tenuto e colpo non si possono scambiare fra i blocchi due e tre.** Un colpo balistico raggiunge un'ampiezza istantanea più alta di
quanta se ne riesca a tenere, e il blocco del massimo misura il plateau con una
media mobile a **1 secondo**: uno `"SH!"` da 200 ms messo lì viene diluito cinque
volte, il "massimo" scende vicino al rumore e non si costruisce nessuna scala.
Per questo la stessa registrazione si legge con due finestre, 1 s e 0.2 s: il
rapporto fra le due distingue un tenuto da un colpo, e il verdetto dice quale dei
due hai fatto invece di limitarsi a rifiutare.

Tre letture, e non tutte esistono sempre:

- **×rif** — multipli dell'appoggio normale (`1.80` è "il 180% del tuo normale").
- **%max** — frazione del tenuto massimale.
- **σ** — quante deviazioni standard del riposo sopra il riposo. Non chiede nessun
  gesto oltre ai dieci secondi di fermo, quindi **c'è sempre**.

Le prime due possono restare **spente**, e non è un guasto: sull'obliquo esterno
l'appoggio di una frase cantata comoda sta a pochi count dal riposo, e una
contrazione volontaria tenuta può essere piccola. Il verdetto dice quale delle due
è spenta e perché, la lettura continua nell'unità che resta, e la calibrazione
resta valida — basta che il **riposo** sia misurato. Sul grafico compare la riga
del riposo, e quella del riferimento solo quando quella scala esiste: la distanza
fra la traccia e la riga verde *è* l'attivazione.

Alla fine compare un **referto**, che è il prodotto vero della procedura — dice
come sta reagendo il sensore su questa persona. Sta **nel dialog**, sotto i
blocchi, e in copia nel log; e ogni blocco mostra i propri numeri accanto a sé,
così quello venuto male si vede subito senza aspettare la fine:

```
calibrazione fatta: riposo 1200 ±20.0 · massimo 2100 · riferimento 1500 count · accento tipo: picco 1900, salita 90 ms, durata 280 ms
   ✓ SNR 45: il sensore distingue bene la contrazione dal rumore.
```

Controlla SNR fra riposo e massimo (sotto 10 gli elettrodi sono mal posizionati o
storti rispetto alle fibre), **escursione troppo piccola** (sotto il 12% della
scala dell'ADC è il guadagno da alzare, non gli elettrodi da spostare: il segnale
cresce e il rumore del convertitore no), **rumore che non si media** come rumore
bianco, tenuto scambiato per colpo, campioni a fondo scala (guadagno troppo alto:
i picchi sono tagliati e il tetto è sottostimato), deriva della linea di riposo
(il gel non ha fatto contatto), accordo fra le tre prove, riferimento sopra il
massimo, accenti riconosciuti, e cambio di cadenza dopo la calibrazione.

Una calibrazione **rifiutata** non diventa attiva, ma i suoi numeri restano
leggibili nel dialog e nel log — e da `MyoLink.calBuilt`, per il banco di prova.

Per rileggere a freddo una sessione già registrata c'è
**`node app/tools/verify-csv.mjs sessione.csv`**: senza argomenti stampa il
profilo al secondo (da cui si leggono gli intervalli), e con
`--rest a:b --max a:b,c:d --ha a:b [--rif a:b]` fa girare il modulo vero — stesse
funzioni, stesse costanti, stesso verdetto dell'app — su quel file. È il modo di
capire un rifiuto senza rimettere il sensore addosso a nessuno.

La calibrazione si salva in `localStorage` e si riprende al caricamento con
l'**età** scritta nel log: muore quando si spostano gli elettrodi, cioè a ogni
sessione, e sopra le 4 ore l'app lo dice invece di lasciarlo scoprire. *Azzera*
la cancella, salvataggio compreso.

**Il rumore è due numeri, non uno**, e confonderli è l'errore che questa parte ha
fatto per primo:

- `±X per campione` — σ robusta delle **differenze fra campioni consecutivi**.
  Sulle differenze e non sui valori perché sull'addome il respiro è segnale, non
  rumore; e perché una deriva del contatto gonfierebbe una σ sui valori abbastanza
  da nascondere se stessa. Regola le soglie con cui si riconoscono gli accenti,
  che lavorano sui campioni grezzi.
- `±Y sulla lettura a 300 ms` — σ della **mediana mobile** campionata su finestre
  disgiunte, cioè il rumore di una *lettura*. È questo il denominatore dell'SNR e
  dei margini, perché una soglia non si mette mai su un campione.

**Mediana e non media**, ed è una differenza misurata su 30 s di riposo vero a
200 Hz: la σ della lettura passa da 4.73 a **1.92 count**, 2.5 volte, perché il
disturbo del riposo non è rumore bianco ma bozzi stretti — una decina di ms l'uno
— che una media spalma e una mediana butta. Con la media, allargare la finestra
non serviva a niente. Il livello di un tenuto invece passa intatto: la mediana
toglie i bozzi, non il piano.

Gli accenti, al contrario, si cercano sempre sui **campioni grezzi**: un colpo
dura 130-240 ms, cioè quanto la finestra, e filtrarlo lo dimezzerebbe. La
separazione fra livelli e forme non la fa il filtro, la fa l'analisi.

Il **rapporto** fra i due rumori è a sua volta una diagnosi: vicino a 1 vuol dire
che il disturbo è troppo lento perché la mediana lo tolga — contatto che vaga,
riferimento incerto — e quello non lo aggiusta né il guadagno né la finestra.

Il campo **EMG** accanto a `offset audio` compensa il ritardo dell'inviluppo del
sensore, che è filtrato in hardware e in modo causale, quindi *segue* il muscolo.
Sposta il disegno, non i dati: lo store e il CSV restano timbrati dal firmware.

Il *Simulatore* è, dal punto di vista della calibrazione, un sensore montato
male, ed è comodo così: farci girare la procedura fa scattare cinque diagnostiche
su sei, ognuna per la ragione giusta.

## La fatica: il semaforo, e i momenti

Il sensore sta sull'**addome laterale** (obliquo esterno), che è un muscolo del
*sostegno del fiato*: quanto sta sopra il riposo dice quanto ti sta costando
quello che stai cantando. È l'unica misura dello strumento, e si vede in due
posti — un colore mentre canti, una lista dopo.

### La misura, per intero

Mediana mobile a **300 ms** → letta con una seconda mediana su **2 s** → **meno
il riposo**, in count. Due mediane e una sottrazione: niente percentili, niente
rapporti fra grandezze.

- la prima mediana toglie il dentellìo per campione, che sull'obliquo esterno è
  quattro volte più grosso del fenomeno da vedere;
- la seconda risponde alla domanda giusta, che non è *"quanto stai spingendo
  adesso"* ma *"quanto ti è costato questo passaggio"*: un attacco di frase non è
  fatica, due secondi tenuti su sì;
- la sottrazione rende il numero leggibile: `+24` non è un punteggio, è la
  distanza dal tuo zero.

**Lo zero non lo chiede a nessuno**: è il 5° percentile del livello sugli ultimi
due minuti. Funziona perché dentro una canzone il riposo esiste comunque — è la
pausa fra due frasi, che sull'addome è il rilascio inspiratorio. Sulle quattro
registrazioni di prova dà **251,0 su tutte e quattro**, cioè esattamente la
mediana di 34 s di silenzio registrati apposta: **scarto 0,0 count** anche su tre
minuti di canto quasi continuo. Quindi **calibrare non serve** per questo, e
nemmeno registrare un blocco di silenzio.

### Le tre zone

| zona | quando | cosa vuol dire |
|---|---|---|
| **verde** | fino a **+30** | dentro quello che sostieni bene |
| **giallo** | **+30 … +55** | è costato più del tuo normale, e *può darsi vada bene così perché il passaggio è difficile* |
| **rosso** | oltre **+55** | la fascia in cui sta l'unico errore vocale confermato che abbiamo registrato |

I due confini non sono scelti: sono **ancorati a due passaggi etichettati** da chi
cantava. `+30` è il tetto di ciò che sostiene bene (un passaggio che spinge ma va
bene sta a +24 di mediana e non supera mai +32); `+55` è la soglia sotto cui non
scende la strofa in cui è mancato il fiato (mediana +68). Fra i due c'è il
giallo, che dice l'unica cosa onesta su un passaggio che **nemmeno chi l'ha
cantato sa giudicare**.

Sono tarati su **quel** montaggio: sposta gli elettrodi e non valgono più. In σ
del riposo (0,89 count) stanno a 34σ e 62σ; in multipli del passaggio tenuto bene
(+24), a 1,25× e 2,3×. Quale delle due unità trasferisca si decide misurando, con
una seconda sessione — finché non c'è, restano in count e si dice.

**Non misura l'altezza della nota**, che era la prima obiezione ragionevole: sullo
stesso Sol#4, stessa canzone, minuti di distanza, la presa buona sta a **+24** e
quella con l'errore a **+68**. La nota spiega il 16–24% della varianza del
livello; il resto è come viene tenuta.

### Dal vivo: il semaforo

Nella barra del pannello *sensore* c'è una pastiglia grande — `verde +3`,
`giallo +41`, `rosso +68` — abbastanza da prendersi con la coda dell'occhio
mentre canti. Il colore **non è mai solo**: dentro c'è sempre la parola e il
numero, perché un semaforo verde/giallo/rosso è la combinazione peggiore per chi
non distingue i rossi dai verdi.

Sul grafico la stessa cosa, continua: due fasce orizzontali appena accennate a
`+30` e `+55`, e **la linea della fatica colorata per zona** sopra la nuvola dei
campioni grezzi e la mediana a 300 ms. La distanza fra la linea e il riposo *è* la
fatica, senza convertire a mente.

**Due secondi di ritardo, e si dicono.** Il numero a `t` descrive `[t-2s, t]`:
dal vivo il colore arriva circa un secondo dopo il centro di ciò che descrive, e
la linea sul grafico si ferma un secondo prima del cursore (disegnata al centro
della sua finestra, come i momenti). Non è aggiustabile senza cambiare la misura,
e una misura più corta seguirebbe ogni attacco di frase invece della fatica di un
passaggio: meglio un semaforo lento e vero che uno pronto e nervoso.

### Dopo: i momenti

Il pulsante *Momenti* analizza la registrazione e ne tira fuori una striscia
panoramica col **nastro delle zone** — la stessa cosa del semaforo, srotolata su
tutta la presa — più la lista cliccabile.

**Non ci sono manopole.** Un momento è un tratto che **esce dal verde** e ci resta
almeno un secondo: una soglia sola, che è anche il confine del verde. Quindi la
lista **può essere vuota**, e su una presa pulita è il risultato giusto.

**Il numero si mostra**, accanto a ogni momento, insieme alla zona e alla durata:

> `0:46  +82  rosso · 6.5 s  Sol#4`

I **falsi positivi restano voluti**: chi ascolta la voce filtra meglio di
qualunque soglia — un punto di troppo costa dieci secondi, uno mancato non si
recupera. Per questo la soglia sta al confine del verde e non più in alto.

**Cosa serve premere, e cosa no.** *Registra* è **facoltativo**: serve solo se
vuoi il file. Quello che *Momenti* analizza è, in ordine:

1. la **registrazione**, se ne hai fatta una (e allora i tempi dei punti sono già
   quelli del video);
2. altrimenti quello che c'è **dopo la calibrazione** — perché i cinque `"SH!"`
   massimali stanno 13-17 volte sopra un tenuto, e con quelli dentro la lista si
   riempirebbe di calibrazione invece che di canto;
3. altrimenti tutto quello che c'è in memoria.

Quale dei tre sia c'è scritto nella barra del pannello e nel log: un intervallo
sbagliato non dà un errore, dà punti plausibili nel posto sbagliato.

**Il referto nel log** dice anche il **tempo in ciascuna zona**, che è più
eloquente di qualunque elenco. Sulle registrazioni di prova: la presa buona 0 s di
rosso, *Call Me a Dog* 2,1 s (1,1%), la presa con l'errore 5,4 s (7,7%) — sette
volte tanto, in un file lungo un terzo.

**Riascoltare: `▶ ascolta`, o la barra spaziatrice.** Finché il microfono è
aperto, l'audio finisce in un anello di PCM (24 kHz, otto minuti, 23 MB di RAM):
clicchi un momento e lo risenti, **senza aver registrato niente**. E mentre suona
il cursore si muove da sé, quindi EMG, pitch e spettrogramma scorrono con
l'audio. Durante il riascolto la cattura si ferma — il microfono sentirebbe le
casse e lo spettrogramma registrerebbe il riascolto come se fosse adesso — quindi
il nastro ha un buco nel presente, che è il momento in cui stai guardando il
passato. Con le casse invece delle cuffie ti risentirai in sottofondo: è fisica,
non un difetto.

**Ferma non scarica niente.** Il file resta in memoria, insieme ai CSV
dell'intervallo registrato, e li porta via *Salva video + CSV (2:24 · 18.6 MB)*,
che dice **quanto dura** e quanto pesa — la durata per riconoscere quale delle tre
prove è, il peso per sapere cosa costa portarsela via. Fra "ho finito di cantare"
e "questo me lo tengo" in mezzo c'è il riascolto. Restano lì fino alla
registrazione successiva o al ricaricamento della pagina, e il log lo dice.

Mentre si registra, accanto a *Registra* c'è `● 0:37 · 4.2 MB`. Il cronometro lo
muove il **ciclo di disegno**, non l'arrivo dei chunk: appeso a `ondataavailable`
avanzava a scatti di due o tre secondi — l'encoder consegna quando gli conviene,
non a cadenza fissa — e un cronometro che salta si legge come un'app piantata. Il
peso invece **arriva quando arriva**, ed è per questo che compare solo quando c'è
(in kB finché è piccolo): `0.0 MB` fermo accanto a un cronometro che corre è il
numero che fa dubitare che stia registrando.

**Come si legge la striscia.** È tutta la registrazione, larga quanto la
finestra: l'inviluppo del segnale con la riga tratteggiata del riposo, sotto il
**nastro delle zone** (verde scuro di fondo, e le tacche gialle e rosse che
saltano fuori), il rettangolo di quello che i tre pannelli stanno mostrando, e i
minuti sotto. Cliccala — su un punto o su un posto qualunque — e i tre pannelli si
spostano lì, col momento **al centro**; `n` e `p` scorrono i punti, *dal vivo*
torna a seguire l'adesso.

**Tieni / scarta, e perché è la parte importante.** Chi canta sa dire «qui ho
sbagliato» quando l'errore è grosso, e *non* sa dire se un passaggio un po'
caricato fosse giusto: le etichette che esistono sono due, e queste sono l'unico
modo in cui se ne formeranno altre. Finiscono in `marks.json` col **numero e la
zona** di ogni punto, e con le costanti usate per produrli — perché i confini si
sposteranno, e un file esportato deve restare leggibile fra un anno.

Accanto al `.json` esce un **`.vtt`**: VLC lo mostra come sottotitoli, QuickTime e
YouTube come capitoli. Rende i punti navigabili in qualunque player senza
rimuxare niente.

**Rianalizzare a freddo.** Sia *Salva video + CSV* (la sola registrazione) sia
*CSV live* (tutta la memoria) scrivono due file — i campioni EMG e le stime di
pitch, che hanno due basi dei tempi diverse e fonderle vorrebbe dire interpolarne
una. Con quelli:

```bash
node app/tools/marks-csv.mjs canzone.csv --pitch canzone-pitch.csv --vtt canzone.vtt
```

gira il **modulo vero** — stesse funzioni, stesse costanti, stessi punti che
vedrebbe l'utente — e scrive i capitoli da mettere accanto all'mp4. È il modo di
cambiare una costante e riascoltare l'effetto, invece di indovinare.

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
- **attivazione / sopra il riposo** — la mediana degli ultimi 300 ms, nella
  migliore unità disponibile (`×rif`, altrimenti frazione del tetto balistico,
  altrimenti count) e in σ del riposo. Restano `—` finché non c'è una
  calibrazione: un count senza unità non è un'attivazione.
- **fatica (2 s)** — il numero esatto che sta dietro il semaforo. È l'unica riga
  di questo gruppo che **non** ha bisogno della calibrazione: lo zero se lo prende
  dalla sessione.
- **calibrazione** — il peggiore dei controlli del referto, con l'SNR accanto.
- **nota / clarity** — l'ultima stima di pitch e quanto vale. `nota` resta `—`
  finché la clarity non supera la soglia del pannello.

Il grafico disegna ogni campione al **suo** timestamp, non a intervalli
regolari, e spezza la linea sui buchi. Con dati in ritardo il tracciato resta
corretto e il buco si vede come tale: è tutto il motivo per cui vale la pena
mandare il timestamp.

## Stato

Fatto: firmware unico seriale + BLE con scelta automatica del trasporto,
protocollo, grafico live, pitch, spettrogramma, strumentazione, registrazione
video + audio, export CSV, calibrazione del sensore sulla persona e ricerca dei
momenti salienti nella registrazione.

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
- Il taglio in moduli non ha cambiato comportamento: **35 test unitari** verdi
  (i vettori di CRC e COBS di cui sopra ora sono automatici) e, sulla app
  buildata in Chrome headless, parità su tutto quello che si può osservare —
  simulatore, timestamp monotoni, colonne di spettro, un tono a 440 Hz
  riconosciuto come A4 a +1 cent, piega dei pannelli senza toccare la
  larghezza, stop pulito, zero eccezioni JS.
- Pannelli: piega, ripiega e ridimensionamento (190 → 300 px → compresso a 0)
  senza errori JS e senza toccare la larghezza, quindi gli assi restano allineati.
- UI mobile, misurata in Chrome headless con metriche e tocco emulati:
  - **390×844** (telefono in portrait): header **102 px**, il 12% del viewport
    contro il terzo di prima, con i cinque pulsanti su una riga sola; **due
    pannelli interi** in vista senza scrollare; nessun bersaglio tattile sotto i
    **40 px** (input compresi, che prima erano 4 px di padding); i cassetti si
    aprono e i controlli dentro sono raggiungibili;
  - **grip col dito**: `Input.dispatchTouchEvent` sul bordo inferiore
    ridimensiona il pannello di esattamente i pixel trascinati (253 → 343) e
    `window.scrollY` resta **0**, cioè la pagina non scrolla sotto il dito;
  - **844×390** (telefono coricato): header **55 px** su una riga, due pannelli
    interi in vista;
  - i tre canvas hanno la **stessa larghezza** in tutte le viewport provate, e il
    `PAD` stretto non rompe niente: 440 Hz resta A4 a +1 cent, zero eccezioni;
  - **1280×1000**: l'header ha gli stessi elementi nelle stesse posizioni di
    prima (lo stato in fondo a destra), altezze 380/190/320 px, `PAD` 52/40 —
    il desktop non si è accorto di niente.
- Registrazione, in Chrome headless con `ffprobe` e `ffmpeg` sul file davvero
  scaricato — non sullo stato interno dell'app:
  - `.mp4` **1240×906 H.264 + AAC**, una traccia video e una audio nello stesso
    file, **171 fotogrammi in 5.71 s = 29.9 fps** contro i 30 chiesti a
    `captureStream`, e durata **dichiarata nel contenitore** (5.74 s);
  - le due tracce partono entro **0 ms** e finiscono entro **2 ms** l'una
    dall'altra: è la sincronia che dà il recorder, senza allineare niente;
  - **QuickLook di macOS genera la miniatura** del file mp4; sullo stesso
    contenuto in WebM non la genera — `qlmanage` si pianta finché non lo si
    ammazza. È la ragione per cui il formato di uscita è mp4;
  - un fotogramma estratto a metà contiene davvero i tre pannelli impilati, con
    la tastiera del pitch, la targhetta della nota e le colonne di spettro;
  - comprimere un pannello **a registrazione avviata** non cambia la geometria
    del file e non solleva eccezioni; chiudere il **microfono** a registrazione
    avviata non ferma il video e non perde l'audio già raccolto;
  - nessuno strato spuntato → rifiuto pulito con il motivo nel log;
- Il **bus audio** (l'ordine dei pulsanti), sui quattro casi, sempre leggendo il
  file con `ffprobe`/`ffmpeg` e non lo stato dell'app:
  - *Registra* e **poi** microfono a 1,7 s: audio **5,11 s** su **5,14 s** di
    video, e il primo suono cade a **1,714 s**, cioè dove il microfono si è
    aperto per davvero. Prima della correzione lo stesso caso dava un mp4 **senza
    traccia audio**;
  - microfono e **poi** *Registra* (il caso che già funzionava): audio 4,46 s su
    4,51 s di video, nessuna regressione;
  - microfono **mai aperto**: traccia audio presente e piena, a **−91 dB**
    costanti per tutti i 4,9 s — silenzio digitale, non assenza di traccia;
  - microfono **chiuso a metà**: audio **4,97 s** su 5,01 s di video, con il
    silenzio che riparte a **2,41 s**. Prima l'audio si fermava a 2,46 s su 5 s,
    e veniva ribasato a zero — cioè il file usciva sfasato;
  - CSV: intestazione `t_s,valore`, una riga per campione, tempi strettamente
    crescenti; nomi `myolink-AAAAMMGG-hhmmss.ext` per entrambi i formati, e il
    timbro condiviso fra i file di una stessa registrazione;
  - con il sesto pulsante nell'header, a **390×844** l'header resta **102 px** e
    i pulsanti su una riga sola come alla fase 3, e le spunte del video sono
    raggiungibili nel cassetto ⚙;
  - **77 test unitari** verdi in tutto (17 su impaginazione del video,
    negoziazione del formato, nomi dei file e CSV; 19 sul bus audio, con Web Audio
    finto: silenzio prodotto, aggancio e sgancio del microfono, attesa dell'avvio
    del contesto; 6 sulla qualità del video: scala e limiti del bitrate, ordine
    dei profili H.264, e la lista dei formati che permette di ripiegare).
- La **qualità del video**, misurata e non guardata a occhio: `ffprobe` sul file
  registrato dall'app dice `profile=High`, `yuv420p`, durata dichiarata; SSIM e
  PSNR contro una sorgente lossless separano il contributo del bitrate (+1.03 dB)
  da quello del profilo (+0.08 dB di luma, +1.17 di crominanza).

- La **fatica e i momenti**, sulle quattro registrazioni cantate vere di
  `docs/samples/` (silenzio, *Man in the Box* con e senza un errore confermato,
  *Call Me a Dog*), su brani sintetici e sull'app vera in Chrome headless:
  - `node app/tools/analisi-samples.mjs` rifà con un comando **tutti** i numeri su
    cui si reggono le tre zone; `marks-csv.mjs` fa girare il **modulo vero**
    dell'app sugli stessi CSV e ritrova gli stessi tratti;
  - **la strofa in cui è mancato il fiato esce, e da sola**: `0:46–0:53 · +82 ·
    rosso`, che è esattamente il tratto indicato da chi cantava. La presa buona
    dello stesso brano dà **0 s di rosso**, *Call Me a Dog* ne dà 2,1 s (1,1%) e
    la presa con l'errore 5,4 s (7,7%) — **sette volte tanto, in un file lungo un
    terzo**;
  - **lo zero automatico è lo zero vero**: il 5° percentile del livello dà
    **251,0 su tutte e quattro** le registrazioni, cioè la mediana dei 34 s di
    silenzio registrati apposta, con **scarto 0,0 count** anche su tre minuti di
    canto quasi continuo. È quello che permette al semaforo di funzionare senza
    calibrazione e senza un blocco di silenzio;
  - **non è un misuratore di altezza**: sullo stesso Sol#4, stessa canzone,
    minuti di distanza, la presa buona sta a **+24** (25°–95° percentile: +24…+29)
    e quella con l'errore a **+68**. La nota spiega il 16–24% della varianza;
  - il riposo trovato nelle pause fra le frasi cade entro **6 count** da quello
    vero su brano sintetico, e una deriva di 60 count iniettata viene **misurata e
    detta**, non corretta;
  - `tools/bench-momenti.mjs` guida l'app vera — iniezione negli store, semaforo,
    *Momenti*, revisione, curatela, striscia, nastro delle zone, riascolto,
    registrazione tenuta in memoria — con **41 controlli** verdi e zero eccezioni:
    il semaforo dice la stessa cosa della misura e trova lo zero da solo entro
    1 count, i tre passaggi tirati iniettati danno **tre** momenti e non venti, il
    numero è in lista accanto a ognuno, la curatela sopravvive al ricalcolo, e con
    una registrazione in memoria si analizza **solo quella**;
  - **il nastro dell'audio**: il microfono finto apre, il nastro si riempie a 24
    kHz, `▶ ascolta` riparte dal cursore e il cursore **avanza di 0,90 s in 0,90 s**
    di orologio (cioè i tre pannelli scorrono con l'audio); durante il riascolto la
    cattura **non scrive** negli store, verificato contando le stime di pitch;
  - **Stop tiene il file** invece di scaricarlo, il pulsante *Salva video + CSV*
    compare con durata e peso scritti sopra, e il log spiega la differenza fra
    analizzare e salvare;
  - **i CSV sono quelli della registrazione**: con 180 s di brano in memoria e 3 s
    registrati, i due file escono col nome del video, con ~600 righe invece di
    36.000, e **nessuna riga fuori dall'intervallo** — leggendo il blob davvero,
    perché è quello che finisce sul disco;
  - **190 test unitari** verdi in tutto, di cui 33 + 19 + 12 sui tre moduli di
    questa parte: riposo e deriva, i confini delle zone, la lettura dal vivo che
    coincide con la serie, lo zero che il canto continuo non sposta, l'isteresi
    che non spezza un tratto in tre, il tratto attribuito al **centro** della sua
    finestra, la lista **vuota** su una presa pulita, `.vtt` e `.json` con dentro
    le costanti usate per produrli.

Sul WebM che l'app produceva prima: guardando i byte, mancavano `Duration`,
`SeekHead` e `Cues`, e dopo un `ffmpeg -c copy` ci sono tutti e tre. È il
comportamento del muxer *live* del browser, non un difetto dell'app — ma è anche
il motivo per cui il formato di uscita ora è mp4, dove lo stesso registratore la
durata la scrive.

Nota sul banco di prova: il dispositivo audio finto di Chrome emette silenzio più
**click a fondo scala**, che sono impulsi a banda larga e da soli fanno sbagliare
l'ottava a YIN. Vanno scollegati (`A.src.disconnect()`) prima di iniettare il
tono, altrimenti si misura il rumore del banco. `--use-file-for-fake-audio-capture`
non inietta nulla in headless: la traccia resta a −120 dBFS.

Non ancora provato su hardware, e il pitch non ancora provato su voce vera. I
**momenti salienti** sono misurati su brani sintetici, dove trovano tutto quello
che ci è stato messo dentro: è una condizione necessaria e non sufficiente, e la
prova che manca è una canzone vera (con `tools/marks-csv.mjs` e il `.vtt` in VLC). La UI
mobile è misurata su un telefono **emulato**: le metriche e gli eventi di tocco
sono quelli veri, la barra del browser che si ritrae e la latenza del dito no.
Delle registrazioni si è verificato il file, non la resa a occhio e orecchio: il
microfono finto emette silenzio più click, quindi il *contenuto* audio del video
non dice niente sulla voce.

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

Il piano di lavoro sta in **[docs/PIANO.md](docs/PIANO.md)**, in fasi
indipendenti e ripartibili a freddo:

1. **Diagnostica dei permessi** — fatta, vedi sopra.
2. **Build** — fatta: sorgenti a moduli ES e 35 test unitari, bundle con Vite.
   Non per velocità (66 KB in un file erano già l'ottimo), ma per i test sulle
   parti numeriche e per poter usare dipendenze npm.
3. **UI mobile** — fatta: controlli nei cassetti, altezze in `svh`, grip da
   prendere col dito, margini degli assi stretti. Stessa pagina, due media query,
   nessuna riga di codice di disegno cambiata.
4. **Registrazione video + audio** — fatta: canvas di composizione e
   `MediaRecorder`, con la sincronia A/V garantita dal recorder e non ricostruita
   a mano, più l'export CSV dei campioni. Solo esportazione: niente riapertura di
   sessione.

5. **Momenti salienti** — trovare nella performance i punti in cui il sostegno
   costa troppo, e poterli riguardare. La **5a** (calibrazione e attivazione
   normalizzata) è fatta. La **5b** — tre rilevatori, salienza relativa alla
   registrazione, due manopole — è stata **cancellata**: le prime registrazioni
   cantate vere hanno smentito l'ipotesi su cui era costruita, e l'indice di
   oscillazione su cui contava è risultato *invertito*. Il racconto sta in
   `docs/PIANO.md`, il seguito in `docs/PIANO-fase6.md`.

   La **6** è fatta, vedi sopra: una misura sola, tre zone ancorate a due
   passaggi etichettati, il semaforo dal vivo, i momenti col numero accanto.
   Resta la **5c**: il replay in app della sessione appena registrata, cioè
   agganciare il `<video>` al cursore di revisione che c'è già nell'asse dei
   tempi. E resta una domanda che si chiude solo misurando: **in che unità** i
   due confini trasferiscono a un altro montaggio (σ del riposo o multipli del
   canto normale), che ha bisogno di una seconda sessione con gli elettrodi
   rimessi da capo.

Fuori piano per ora: riapertura di sessioni salvate su disco (serve un formato)
e render offline in WebCodecs;
**seriale su Android** via WebUSB (Web Serial su Android non esiste, e il parser
è già indipendente dal trasporto: basterebbe una `connectUsb()`); **port nativo**
in Flutter, solo se servono iOS o installer distribuibili.

## Deploy

`npm run build` produce in `app/dist` dei file statici — un `index.html`, un JS e
un CSS, senza dipendenze a runtime — che vanno su qualsiasi hosting statico
copiandoli. L'unico requisito è **https**, che i permessi di Web Serial, Web
Bluetooth e microfono pretendono.

Su Vercel il progetto ha **Root Directory = `app`**, così il resto del repo
(firmware, README) non viene pubblicato. Da lì il framework Vite viene
riconosciuto da solo: build command `npm run build`, output directory `dist`.
Non c'è `vercel.json` perché non serve nulla da configurare — e con la Root
Directory impostata un `vercel.json` nella radice del repo verrebbe comunque
ignorato: Vercel lo cerca dentro la root directory, cioè in `app/`.

Il bundle minificato è **35 kB di JS e 5.7 kB di CSS** (14.3 + 1.9 kB gzip)
contro i 66 kB del file unico di prima — ed è cresciuto di 5 kB con la fase 4,
non di più, perché registrare è quasi tutto lavoro del browser. È un
miglioramento reale ma piccolo in assoluto: la build non è stata fatta per la
velocità della pagina.

## Licenza

MIT — vedi [LICENSE](LICENSE).
