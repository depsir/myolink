# Piano di lavoro — MyoLink

Quattro fasi indipendenti, in ordine di dipendenza. Ognuna è ripartibile a
freddo: qui c'è il perché, cosa si tocca e quando è finita.

| # | fase | stato |
|---|------|-------|
| 1 | Diagnostica dei permessi (bug Brave mobile) | **fatta** |
| 2 | Build: sorgenti a moduli, bundle in uscita | **fatta** |
| 3 | UI mobile | **fatta** |
| 4 | Registrazione video + audio | **fatta** |

L'ordine non è arbitrario: la 2 viene prima della 3 e della 4 perché entrambe
aggiungono parecchio codice a un file già a 1564 righe, e i test unitari della
fase 2 coprono le parti numeriche mentre ci si mette le mani.

---

## Fase 1 — Diagnostica dei permessi

**Obiettivo.** Trasformare "su Brave mobile non parte" in un messaggio che dice
cosa fare.

**Perché.** Il bug quasi certamente **non è fixabile lato app**: le cause
plausibili sono il permesso microfono negato al browser a livello Android, il
sito bloccato nelle site settings, o — per il BLE — Web Bluetooth che Brave
tiene disabilitato di default. Nessuna delle tre è aggirabile da JavaScript.
Quello che *era* un problema nostro è che il codice non permetteva nemmeno di
capire quale delle tre fosse: i fallimenti di `getUserMedia` e `requestDevice`
arrivano come `DOMException` il cui `message` in Chromium è spesso vuoto o
generico, e l'app logga solo `e.message`. L'informazione sta in **`e.name`**.

**Cosa è stato fatto** (`app/index.html`):

- `errText(e)` — logga `name` + `message`, non solo `message`.
- Mappe `MIC_HINT` / `BLE_HINT` / `SERIAL_HINT`: da `e.name` a un'istruzione
  concreta. `NotAllowedError` sul microfono spiega l'ordine in cui guardare
  (permesso di sistema del browser → permesso del sito), perché su Brave il
  permesso Android spesso non è mai stato chiesto ed è la causa più comune del
  prompt che non appare.
- Preflight prima di aprire il microfono: `isSecureContext` e
  `navigator.permissions.query({name:"microphone"})`. Se lo stato è già
  `denied`, si dice subito che il prompt non comparirà, invece di far premere
  un pulsante che non fa niente.
- `NotFoundError` su seriale/BLE non è un errore: è l'utente che ha chiuso il
  selettore. Ora lo dice così.
- Riga di diagnostica ambiente all'avvio (contesto sicuro, Web Serial, Web
  Bluetooth, microfono), così un report da telefono parte già con i fatti.
- Nota nel README su Brave.

**Fatto quando.** ✅ Il log distingue i casi e ogni caso ha un'istruzione.

**Aperto.** Verifica sul telefono: cosa esce davvero con Brave. Se esce
`NotAllowedError`, la palla è nelle impostazioni Android e l'app ha già dato la
risposta giusta. Da annotare qui il risultato.

**Nota laterale su Brave.** Anche quando funziona, Brave applica *farbling*
antifingerprint alle API Web Audio, cioè perturba leggermente l'output di
`AnalyserNode`. Visivamente irrilevante sullo spettrogramma, ma per un'app che
dichiara "quello che vedi è vero" vale la pena saperlo.

---

## Fase 2 — Build

**Obiettivo.** Sorgenti divisi in moduli ES + test unitari, bundle prodotto da
Vite, deploy su Vercel via build.

**Perché — e perché *non*.** Non per velocità: un file singolo da 66 KB è già
l'ottimo per il first paint (zero richieste extra, zero waterfall). La
minificazione toglie ~35-40% dei byte, cioè ~25 KB, impercettibili. I motivi
veri sono tre:

1. **Test.** Il README documenta verifiche fatte a mano su CRC, COBS (4000
   vettori), wrap del timestamp a 32 bit, YIN sulle ottave. Con un build
   diventano `vitest` che girano in due secondi a ogni modifica, invece di
   riverifiche via CDP. Per un progetto dove la correttezza numerica *è* il
   prodotto, questo da solo lo giustifica.
2. **Moduli.** 1564 righe in un file, e le fasi 3 e 4 ne aggiungono.
3. **Dipendenze npm**, che servirebbero se un giorno si va su WebCodecs.

**Niente React.** Questa è un'app canvas: il DOM sono ~50 elementi statici che
non cambiano mai, tutto il lavoro sta in `requestAnimationFrame` e `drawImage`.
React aggiungerebbe un runtime che non disegna niente.

**Struttura.** I confini esistono già nel codice, non vanno inventati:

```
app/
  package.json
  index.html          entry di Vite, <script type="module" src="/src/main.js">
  src/
    main.js           wiring degli event handler, avvio
    state.js          T, S, A, P, store
    proto/            crc16.js, cobs.js, packet.js (parse + srotolamento timestamp)
    transport/        serial.js, ble.js, sim.js
    dsp/              yin.js, spectrogram.js
    draw/             axes.js (PAD condiviso), chart.js, pitch.js, spec.js
    ui/               panels.js (fold/grip), stats.js, log.js
  test/               crc16, cobs, packet, yin, store
  dist/               output, gitignored
```

**Vercel.** Root Directory resta `app`; si aggiunge Framework Preset = Vite,
build command `npm run build`, output directory `dist`. Il README va corretto:
oggi dice "file statico unico, senza build".

**Fatto quando.** ✅
- `npm run dev` serve l'app con ricarica a caldo su localhost;
- `npm run build` produce `dist/` (28 kB JS + 3.4 kB CSS, contro 66 kB di prima)
  e l'app buildata si comporta come quella di prima;
- `npm test` verde: **35 test** su CRC, COBS, parsing, srotolamento del
  timestamp, contabilità delle perdite, clock, ring buffer e YIN;
- parità verificata in Chrome headless sulla build: simulatore, timestamp
  monotoni, colonne di spettro, 440 Hz → A4 a +1 cent, pannelli, stop, zero
  eccezioni.

**Com'è venuto.** La struttura è quella prevista, con quattro scelte che vale la
pena ricordare:

- **La regola del taglio**: `core/` e `audio/pitch.js` non toccano il DOM, ed è
  esattamente l'insieme coperto dai test. Tre piccoli disaccoppiamenti sono
  serviti per arrivarci: `log()` cerca il suo elemento alla prima chiamata (non
  al caricamento), `SpecStore.spanS` riceve l'hop come parametro invece di
  leggerlo dall'audio, e `setupYin` restituisce la riga di info invece di
  scriverla nel DOM.
- **Niente cicli di import**: il ciclo naturale sessione ↔ trasporti è rotto da
  un registro (`onStop` / `onSend`), e il ciclo canvas ↔ disegnatori spostando
  il ciclo di `requestAnimationFrame` in `main.js`.
- **`window.MyoLink`**: con i moduli ES le variabili di primo livello non sono
  più globali, e il banco di prova via CDP le leggeva. È l'unico punto
  d'accesso, dichiarato apposta.
- **Un limite trovato dai test**, non introdotto: lo srotolamento del timestamp
  non distingue un reset del device da un wrap dei 32 bit, quindi un reset della
  board *sulla seriale* (dove la porta resta aperta) viene letto come un salto
  in avanti di ~4294 s. Il test lo fissa come comportamento attuale e il README
  lo documenta; sistemarlo è una decisione a parte, non un pezzo di refactor.

---

## Fase 3 — UI mobile

**Obiettivo.** L'app usabile da telefono. Stessa pagina, breakpoint — **non**
una versione mobile separata.

**Problemi concreti a 390px** (rilevati sul codice attuale):

- L'header è un `flex-wrap` con 4 bottoni e 4 gruppi di label: va a 4-5 righe e,
  essendo `position: sticky`, si mangia stabilmente un terzo del viewport.
- Le barre dei pannelli hanno lo stesso problema; quella dello spettrogramma ha
  5 gruppi di controlli.
- Altezze fisse 380 + 190 + 320 px: in portrait si vede un pannello e mezzo.
- Il grip è alto **7px** e non ha `touch-action: none`: col dito è quasi
  impossibile da prendere, e mentre trascini la pagina scrolla sotto. Le pointer
  events ci sono già (`src/ui/panels.js`), quindi è area di tocco + una riga CSS.
- Gli input numerici sono 60-72px con 4px di padding: sotto la soglia dei 44px
  di target tattile.

**Approccio.** Header ridotto a un pulsante di connessione + pannello
impostazioni a scomparsa; i controlli di ogni pannello in un cassetto sotto la
barra (la macchina del fold esiste già, si riusa); altezze in `vh` invece che
px; grip con padding invisibile a ~24px; suggerimento a schermo di ruotare in
landscape, perché un grafico temporale su 390px di larghezza mostra 5 secondi in
390 pixel.

**Vincolo da non rompere.** I tre pannelli devono mantenere gli stessi margini
sinistro/destro (`PAD.l`/`PAD.r`) e la stessa larghezza, altrimenti gli assi dei
tempi non si allineano più e il senso dell'app sparisce. Uno stack verticale lo
rispetta; qualunque idea di affiancare pannelli su tablet va guardata con questo
in mente.

**Fatto quando.** ✅ Su un telefono in portrait si connette, si apre il microfono,
si vedono almeno due pannelli insieme, e si riesce a ridimensionarne uno col
dito senza che la pagina scrolli. Misurato a 390×844 con metriche e tocco emulati:
header 102 px (12% del viewport, contro un terzo), `pEmg` e `pPitch` interi in
vista, il grip che sposta il bordo di esattamente i pixel trascinati con
`scrollY` fermo a 0, nessun bersaglio sotto i 40 px. Su 1280×1000 l'header ha gli
stessi elementi nelle stesse posizioni di prima.

**Com'è venuto.** L'approccio è quello previsto, con cinque cose che vale la pena
ricordare:

- **`display: contents` invece di due impaginazioni.** Le tre righe dell'header e
  il contenitore dei controlli di ogni pannello esistono nel DOM ma su desktop
  *non partecipano al layout*: i figli restano figli del flex dell'header e della
  barra, cioè esattamente com'erano. Su schermo stretto le stesse scatole
  diventano righe vere e cassetti. Nessuna duplicazione di markup, e la
  non-regressione desktop è verificabile confrontando le posizioni.
- **Due media query, non una.** La prima domanda che il codice fa non è "sono su
  un telefono" ma "quale risorsa manca": `(max-width: 720px), (max-height: 560px)`
  nasconde i controlli nei cassetti e passa le altezze a `svh`; solo
  `(max-width: 720px)` spezza l'header in righe. Il caso che ha imposto la
  divisione è il telefono coricato — 844×390 prendeva l'impaginazione desktop, e
  con i bersagli da 40 px l'header andava a **109 px su 390 di altezza**, il 28%
  dello schermo. Sono 55 px su una riga sola.
- **`svh` e non `vh` né `dvh`.** `dvh` cambia quando la barra del browser si
  ritrae: sarebbe un `ResizeObserver` che rialloca tre canvas mentre si scrolla.
  `svh` è la misura a barre visibili, quindi è stabile.
- **Il `PAD` è diventato una funzione della larghezza** (52/40 → 34/30 sotto i
  520 px): su 390 px i margini erano un quarto dello schermo. Il vincolo "stessi
  margini per i tre pannelli" ne esce più forte di prima, non più debole, perché
  ora dipende da un solo numero — la larghezza, che i tre canvas hanno identica
  per costruzione. L'unico effetto collaterale trovato: la scritta `Hz` dello
  spettrogramma andava addosso all'etichetta della tacca più alta, e con margini
  stretti si omette (un asse con 5k/2k/1k non si confonde con altro).
- **Il grip era due righe di CSS**, come previsto: 22 px di area utile con la riga
  disegnata sottile, e `touch-action: none` — che è la riga che impedisce alla
  pagina di scrollare sotto il dito. In più `pointercancel`, che mancava: col dito
  il sistema può revocare il puntatore e il ridimensionamento restava attaccato.

**Aperto.** Nessuna prova su un telefono vero: l'emulazione dà metriche ed eventi
di tocco veri, non la barra del browser che si ritrae né la latenza del dito.

---

## Fase 4 — Registrazione video + audio

**Ambito deciso: solo esportazione.** Video configurabile + audio sincronizzato,
scaricati alla fine. **Niente** riapertura di sessione, niente timeline
scrubbabile, niente cloud. Il render offline in WebCodecs resta fuori.

**Come.** `canvas.captureStream(30)` per il video e la traccia audio del
microfono nello **stesso** `MediaStream` dato a un solo `MediaRecorder`:

```js
new MediaStream([compositeCanvas.captureStream(30).getVideoTracks()[0],
                 A.stream.getAudioTracks()[0]])
```

Questo è il punto chiave: **la sincronia A/V la dà gratis il recorder**, che
timbra entrambe le tracce con lo stesso orologio. Non si sincronizza niente a
mano. E l'`offset` audio già presente in header è applicato al *disegno*,
quindi finisce dentro il video automaticamente: il file è auto-consistente con
quello che si vedeva a schermo.

**Un file, non tre.** Un canvas di composizione fuori schermo: a ogni frame tre
`drawImage` dei canvas esistenti, impilati, e si registra solo quello. Costo
trascurabile, e si ottiene un file solo — che è ciò che serve per condividere.
Tre file separati sono più codice e lasciano tre video che nessun player rimette
in fila.

**La configurabilità** diventa allora tre checkbox (sensore / pitch /
spettrogramma) che decidono quali strati compone e quanto è alto il canvas di
uscita. Se il microfono è chiuso si registra solo video.

**Da mettere in conto.**
- **Cambiare scheda buca la registrazione**: `requestAnimationFrame` viene
  sospeso in background e il video prende un frame lunghissimo. Va scritto nella
  UI.
- Formato webm VP9 + Opus, con negoziazione via `MediaRecorder.isTypeSupported`.
  Coerente con l'essere già Chrome/Edge-only.
- I chunk si accumulano in RAM come array di Blob: fino a ~10 minuti nessun
  problema. Per sessioni lunghe, `showSaveFilePicker()` + writable stream scrive
  su disco man mano e toglie il limite (solo Chrome desktop) — opzionale.
- Download con `URL.createObjectURL` + `<a download>`, nome file col timestamp
  della sessione.

**Extra a costo quasi zero, da valutare:** export CSV dei campioni EMG allo
stop. I dati sono già in un array timbrato; è l'unico output che rende una
sessione rianalizzabile, cosa che un video non è.

**Fatto quando.** ✅ Si preme *Registra*, si sceglie cosa includere, si ferma, e
si scarica un `.webm` in cui i grafici scorrono e l'audio è allineato a quello
che mostravano. Verificato in Chrome headless con ffprobe sul file prodotto:
`.mp4` 1240×906 H.264 + AAC, **171 fotogrammi in 5.71 s (29.9 fps)** contro i 30
chiesti, le due tracce che partono entro **0 ms** e finiscono entro **2 ms**
l'una dall'altra, un fotogramma estratto a metà che contiene davvero i tre
pannelli, e la miniatura QuickLook che macOS genera da solo. Il CSV è arrivato
con 196 righe e tempi strettamente crescenti.

**Com'è venuto.** L'impianto è quello previsto — un canvas di composizione, un
solo recorder, niente sincronizzazione a mano — con cinque cose da ricordare:

- **L'impaginazione è una funzione pura** (`record/layout.js`), ed è l'unica
  parte che si poteva sbagliare in silenzio: un rettangolo storto si vede solo
  riguardando il file, quindi sta da sola e la coprono i test. Due dettagli non
  ovvi ci sono finiti dentro: le dimensioni **pari** (i codec 4:2:0 devono
  arrotondare il piano di crominanza e certi encoder rifiutano l'ingresso
  dispari) e lo scarto degli strati di misura 0 — un pannello compresso o
  nascosto — perché una `drawImage` con sorgente larga 0 è un'eccezione, non un
  no-op.
- **La geometria si fissa alla partenza.** Un `MediaRecorder` non cambia
  risoluzione a metà stream, quindi se durante la registrazione si tira il grip
  il pannello viene *scalato* dentro lo spazio che aveva, e se lo si comprime la
  sua banda resta fondo. Provato: il file non cambia formato a metà.
- **Anche l'audio si decide alla partenza**, per lo stesso motivo: una traccia
  aggiunta dopo non entrerebbe nel file. Microfono chiuso = video muto, e lo
  dice il log. Il caso opposto — chiudere il microfono *mentre* si registra, che
  ferma la traccia che il recorder ha in mano — non rompe niente: il video
  continua e l'audio raccolto fino a lì resta nel file.
- **Il formato è mp4, e la scelta è arrivata dopo.** Si partiva da WebM VP9 —
  formato di casa di Chrome — ed è durato fino alla prima prova su un Mac vero.
  Due cose, misurate: macOS il WebM non lo legge affatto (nessuna anteprima,
  nessuna miniatura, `qlmanage` che si pianta invece di fallire), e il WebM di
  `MediaRecorder` non dichiara la durata perché è un muxer *live* — guardando i
  byte mancano `Duration`, `SeekHead` e `Cues`. L'mp4 dello stesso registratore
  risolve entrambe senza una riga di post-processing. I codec però vanno chiesti
  **per nome**: con `video/mp4` liscio Chrome ha messo dentro ora H.264+Opus ora
  VP9, cioè proprio le combinazioni che QuickTime non apre. WebM resta come
  ripiego dove l'mp4 non si registra.
- **Il CSV era davvero quasi gratis** e vale più di quanto costa: esporta la
  finestra viva del ring buffer con i tempi a microsecondi, che è la risoluzione
  a cui timbra il firmware — scriverne meno butterebbe via l'informazione per cui
  esiste il protocollo.

**Aperto.** Il sesto pulsante nell'header non ha rotto il mobile (a 390×844
l'header resta 102 px con i pulsanti su una riga sola, come alla fase 3), ma è
l'ultimo che ci sta: il prossimo va nel cassetto. E la registrazione lunga è
ancora tutta in RAM come array di Blob — sopra i ~10 minuti serve
`showSaveFilePicker()`.

---

## Fuori piano (per ora)

- **Timeline scrubbabile e riapertura sessione.** Sarebbe lo stesso lavoro del
  render offline: pilotare il disegno da un cursore `tNow` invece che da
  `T.now()`. Escluso esplicitamente dalla fase 4.
- **Render offline in WebCodecs** (`VideoEncoder` + muxer): qualità
  pubblicabile, zero frame persi, spettrogramma ricalcolato. Richiede la fase 2.
- **Seriale su Android via WebUSB**, se servirà.
- **Port nativo** (Flutter), solo se servono iOS o installer.
