# Piano di lavoro — MyoLink

Fasi indipendenti, in ordine di dipendenza. Ognuna è ripartibile a freddo: qui
c'è il perché, cosa si tocca e quando è finita.

| # | fase | stato |
|---|------|-------|
| 1 | Diagnostica dei permessi (bug Brave mobile) | **fatta** |
| 2 | Build: sorgenti a moduli, bundle in uscita | **fatta** |
| 3 | UI mobile | **fatta** |
| 4 | Registrazione video + audio | **fatta** |
| 5a | Calibrazione e attivazione normalizzata | **fatta** |
| 5b | Momenti salienti: due manopole, salienza relativa | **fatta** |
| 5c | Replay della sessione registrata | da fare |
| 6 | **Un rilevatore solo, tarato sui dati veri** — fatta | vedi [PIANO-fase6.md](PIANO-fase6.md) |
| 7 | **Due modi e due fasi: la UI per chi canta** | vedi [PIANO-fase7.md](PIANO-fase7.md) |

> **4 settembre 2026 — la fase 5b è superata.** Le prime registrazioni cantate vere
> (`docs/samples/`) hanno smentito l'ipotesi su cui era costruita, e il rilevamento
> si rifà da capo su una misura sola. Questo documento resta come racconto di com'è
> andata, e va letto prima della fase 6; ma per **cosa fare adesso** si va in
> [PIANO-fase6.md](PIANO-fase6.md).

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

## Fase 5 — Momenti salienti: calibrazione, regole, replay

**Obiettivo.** Trovare nella performance i punti dove il sostegno è eccessivo,
insufficiente o instabile, e poterli **riguardare**.

**Ambito deciso.** Rilevamento **a posteriori** sulla sessione appena
registrata: niente riapertura di file vecchi, niente flag dal vivo in questa
fase. Il rilevamento è **solo muscolare**; la nota rilevata è un'etichetta e un
filtro opzionale, non una dipendenza.

Tre sottofasi. La 5a è propedeutica — senza di lei una soglia non è
configurabile, è un numero senza unità — ma il cuore sono la 5b e la 5c.

### Il vincolo che decide tutto il resto: il sensore sta sull'addome laterale

Non sulla laringe. È obliquo esterno, cioè un muscolo del **sostegno del
fiato**, e questo cambia tre cose.

**Il segnale è buono.** Muscolo grosso e superficiale, sEMG ben condizionato,
un massimo funzionale ha senso. L'MVC classico però no: una flessione del
tronco contro resistenza è scomoda e poco ripetibile. Al suo posto
un'**espirazione forzata massimale** — un "sh!" secco fino a volume residuo —
che è ripetibile e sta già nel gesto del cantante. Il MyoWare va allineato alle
fibre (obliquo esterno: diagonali, verso il basso e l'avanti); un montaggio
storto lo becca il controllo di SNR della calibrazione.

**La semantica si ribalta**, in meglio: troppa attivazione = spinta, appoggio
premuto, manovra di Valsalva; troppo poca = fiato non sostenuto. È l'asse
pedagogicamente interessante, più di quanto lo sarebbe stata la tensione
laringea.

**Il confondente è la respirazione stessa.** La parete addominale ha un ciclo
lento alla frequenza della frase: inspirazione = rilascio, frase = attivazione
progressiva. Due ricadute concrete:

1. Il riposo **non è piatto**. La MAD misurata in calibrazione include
   l'ondulazione respiratoria, e va bene: è il rumore vero contro cui misurare.
2. L'attivazione **cresce naturalmente verso la fine di una frase**. Una soglia
   piatta sul picco flaggerà i finali di frase, non i passaggi difficili.

Da (2) esce un raffinamento da provare in 5b, non un requisito: **il rilascio
inspiratorio è visibile nell'EMG**, quindi le frasi si possono segmentare
dall'EMG stesso, senza microfono, e la metrica interessante diventa relativa
alla frase — attivazione già alta *all'inizio* (premuto da subito) invece che
alla fine (naturale). Da tarare sui dati veri, non da decidere prima.

**Falsi positivi accettati.** Sull'addome un movimento del corpo produce
attivazione, e capiterà mentre si canta. È una decisione presa, non un problema
aperto: si accettano e si scartano a mano (vedi la curatela in 5b).

---

### Cosa dicono i dati veri (21 agosto 2026)

Una registrazione sul sensore vero, addome laterale, **BLE alimentato da
powerbank** (niente percorso verso la rete): 30 s di riposo, tre `"sssh"` tenuti,
cinque `"SH!"` secchi. È la misura da cui vengono quasi tutte le scelte numeriche
di questa fase, e va tenuta perché **nessuna di quelle scelte sarebbe stata
indovinabile a ragionamento**.

| grandezza | valore | cosa ne segue |
|---|---|---|
| cadenza | 200 Hz, **0% di pacchetti persi** | il BLE tiene 200 Hz con `MYO_BLE_BATCH 1`, meglio di quanto il README lasciasse sperare |
| riposo | base 247, σ **4.19** count/campione | il riposo è *quieto*, non rumoroso |
| σ della *media* a 300 ms | **4.73** | peggio che per campione: il disturbo **non è rumore bianco**, e allargare la finestra non serviva a niente |
| σ della *mediana* a 300 ms | **1.92** | 2.5× meglio. I bozzi del riposo sono stretti (~10 ms) e una mediana li butta |
| livello di un tenuto | +46 grezzo → **+46 filtrato** | la mediana toglie i bozzi, non il piano |
| tenuto massimale | **+42** count (1.0% della scala ADC) | il massimo *sostenibile* è piccolo, e non è un difetto |
| accento balistico | **+541** (mediana) … +808 (max), 13–20% della scala | 13–17× il tenuto: un colpo arriva dove un tenuto non arriva |
| SNR col tetto balistico | **281** | il montaggio era buono da sempre |
| appoggio di una frase cantata comoda | **+1…+10** count | dentro il rumore: `×rif` resta spenta, ed è un fatto sul canto |
| riga spettrale a 33.3 Hz | 0.6 count | periodo di **esattamente 6 campioni** a 200 Hz = intervallo di connessione BLE da 30 ms. È la radio che accoppia nell'ADC. Innocua, ma spiegata |

**Le tre conclusioni che contano.**

1. **I livelli si leggono con una mediana, le forme sui campioni grezzi.** Un
   accento dura 130–240 ms, cioè quanto la finestra: filtrarlo lo dimezzerebbe.
   La separazione fra livelli e forme non la fa il filtro, la fa l'analisi.
2. **La dinamica utile al canto è di poche decine di count**, su un riposo con
   2–4 count di rumore filtrato. Il sostegno è un'attivazione *bassa e
   sostenuta*: SNR del fenomeno interessante 5–20 a 1. Basta, e spiega perché
   l'unità giusta è **σ del riposo** e non una percentuale di un tetto.
3. **Il tenuto e il canto comodo possono stare entrambi dentro il rumore senza
   che nulla sia rotto.** Da qui la calibrazione che non è più un cancello.

Osservazione soggettiva, riportata da chi indossava il sensore e più utile di
qualunque soglia: *"quello che vedo sul grafico è simile alla sensazione di
quando canto sbagliato"*. Il segnale porta il fenomeno; il resto è presentazione.

**Come rifare questa analisi.** `node app/tools/verify-csv.mjs sessione.csv`
stampa il profilo al secondo (da cui si leggono gli intervalli), e con
`--rest a:b --max a:b,c:d --ha a:b [--rif a:b]` fa girare il **modulo vero** —
stesse funzioni, stesse costanti, stesso verdetto dell'app — su una registrazione
già fatta. È il modo di cambiare una costante e vedere subito l'effetto su dati
reali, invece di indovinare.

---

### Fase 5a — Calibrazione e attivazione normalizzata

**Perché.** Il MyoWare ENV in count ADC dipende da impedenza cutanea, posizione
degli elettrodi, guadagno e tessuto: `> 800` significa cose diverse su due
persone e su due sessioni della stessa persona. Senza normalizzazione le soglie
della 5b non si trasferiscono, e la feature non è configurabile ma solo
ri-indovinabile ogni volta.

**Tre misure**, sulla linea SENIAM ma adattate all'addome:

| misura | durata | cosa si estrae |
|---|---|---|
| riposo | ~10 s, più cicli respiratori | **mediana** e **MAD** — non media e σ: una contrazione involontaria a metà misura non deve spostare lo zero |
| massimo funzionale | 3 prove da ~4 s, con pausa | il **plateau**: 90° percentile della media mobile a 1 s, poi mediana delle tre prove. Il massimo assoluto è un artefatto |
| riferimento | una frase comoda a mezzo volume | il livello di appoggio normale |

**Due denominatori, non uno.** `%max` dice quanto lontano dal massimo
fisiologico; `×rif` dice quanto sopra il proprio normale. Sull'addome il
secondo è il primario, perché "il 180% del tuo appoggio comodo" è una frase che
significa qualcosa, mentre "il 25% di un'espirazione massimale" no.
`a = (v − base) / (den − base)`, clampato a 0.

**Il verdetto è il prodotto vero di questa fase** — è quello che risponde a
"come sta reagendo il sensore su questa persona", e va emesso insieme ai
numeri:

| controllo | verdetto |
|---|---|
| `(max − base) / MAD` | < 10 → elettrodi mal posizionati o storti rispetto alle fibre: rifai |
| deriva della mediana nei 10 s di riposo | non stabile → il gel non ha fatto contatto, aspetta |
| base vicina a metà scala | contatto scadente o offset saturo |
| campioni a 4095 durante il massimo | guadagno troppo alto, i picchi sono tagliati |

**Dove sta.**

```
app/src/core/calib.js     protocollo, statistiche, verdetto, persistenza — senza DOM
app/src/ui/calib.js       il <dialog>: quattro blocchi cronometrati, riepiloghi, referto
app/test/calib.test.js    31 test (115 in tutto)
app/tools/verify-csv.mjs  il modulo vero su un CSV già registrato
```

`core/calib.js` non importa niente e non tocca il DOM: è il tipo di codice che
sbagliato non si vede — un percentile storto non si nota, si propaga — quindi è
tutto coperto dai test, come il resto di `core/`.

**Come si verifica in browser.** Chrome headless via CDP (vedi README per il
perché `window.MyoLink` esiste): `MyoLink.CAL` è la calibrazione **attiva**,
`MyoLink.calBuilt` l'ultima **costruita** anche se le sue scale sono spente —
serve perché è il percorso su cui si sbaglia. Il simulatore è, dal punto di vista
della calibrazione, un montaggio con la linea di base che vaga: farci girare la
procedura fa scattare quasi tutte le diagnostiche, ognuna per la ragione giusta,
ed è un test negativo che non costa niente.

**Validità e deriva.** La calibrazione muore quando si spostano gli elettrodi,
cioè a ogni sessione: si salva in `localStorage` **timbrata**, riutilizzabile
ma con avviso esplicito sull'età. La deriva in sessione (sudore, gel) si misura
come percentile basso su finestra lunga e si **mostra**, non si corregge:
durante un brano continuo non ci sono pause di riposo, quindi il percentile
basso non è più il riposo, e correggere in silenzio sarebbe inventare.

**UI minima ma non nulla.** La calibrazione è un'*interazione*, non un display:
serve un flusso guidato ("rilassati 10 s" → "sh! massimale" ×3 → "canta una
frase comoda") e il verdetto nel log. La riga in percentuale nel pannello
statistiche viene fuori da sé come sottoprodotto — non è lì che sta il valore.

**Due modifiche di contorno che servono qui.**

- **Alzare la frequenza di campionamento a 100–200 Hz.** A 20 Hz il Nyquist è
  10 Hz, cioè a cavallo della banda del tremore (4–12 Hz) che in 5b è una
  feature, e l'onset ha risoluzione ±50 ms, grossa per una regola tipo "nei
  primi 150 ms". Sono qualche centinaio di byte/s e **non serve riflashare**: il
  campo `Hz` + *Applica* manda già `P<µs>` a caldo.
- **Un `offset EMG`**, come l'`aoff` che c'è per l'audio: l'inviluppo del
  MyoWare è hardware e causale, quindi *segue* il muscolo di qualche decina di
  ms. Su una finestra di 150 ms è un terzo della finestra.

**Fatto quando.** ✅ Il flusso produce i due denominatori e un verdetto sensato
su un montaggio buono e su uno volutamente sbagliato, i valori sopravvivono a un
reload, e il pannello statistiche mostra l'attivazione in `×rif` oltre che in
count. Verificato con **31 test unitari** su `core/calib.js` (102 in tutto) e in
Chrome headless via CDP: procedura completa coi sei blocchi guidata dal
simulatore, `Azzera` che cancella anche il salvataggio, ripresa da
`localStorage` con l'età nel log, le tre righe di statistiche che passano da `—`
a `1.10 ×rif` / `27 %` / `ok · SNR 45`, le due righe tratteggiate sul grafico, e
zero eccezioni.

**Com'è venuto.** Il protocollo è quello previsto — quattro blocchi, due
denominatori, un verdetto — con sei cose da ricordare:

- **Il blocco degli accenti è diventato il pezzo più interessante, e non era
  nel piano.** È arrivato dal nome dell'esercizio: `"HA!"` e `"SGH!"` sono due
  cose diverse, la seconda sostenuta dà il *tetto* e la prima staccata dà la
  **forma** — picco, salita, durata mediani di cinque accenti volontari e
  puliti. È il riferimento con cui la 5b potrà dire che un'altra attivazione non
  è pulita, invece di prendere soglie assolute da un paper.
- **Il rumore va misurato sulle DIFFERENZE, non sui valori**, e questo l'hanno
  trovato i test. Misurata come MAD dei valori, la σ del riposo si mangia la
  deriva del contatto — abbastanza da nascondere se stessa: il blocco con 80
  count di deriva passava per pulito, perché il controllo era `|deriva| > 3σ` e
  σ era cresciuta insieme alla deriva. Sulle differenze consecutive (MAD × 1.4826
  / √2) la σ è cieca a qualunque andamento lento e resta robusta a un artefatto
  isolato, che produce due differenze enormi su centinaia.
  Ricaduta sul ragionamento di partenza: il piano diceva che l'ondulazione
  respiratoria "deve contare, è il rumore vero". **È il contrario**: sull'addome
  il respiro è *segnale*, e una σ che se lo mangia gonfia ogni soglia costruita
  su di essa — la soglia degli accenti, l'SNR e il controllo sulla deriva.
- **`measured` e `ready` sono due cose diverse.** Il primo dice che i quattro
  blocchi sono stati misurati, il secondo che quei numeri sono una *scala*
  usabile — che è più forte di "il massimo sta sopra il riposo": se lo supera di
  due σ il denominatore è rumore. Separati per una ragione di diagnostica: il
  caso del sensore staccato ha i blocchi e non ha la scala, e deve ricevere il
  messaggio sull'SNR e sull'orientamento delle fibre, non un inutile
  "calibrazione incompleta".
- **Il simulatore è, dal punto di vista della calibrazione, un sensore montato
  male** — e questo è un test negativo gratuito che vale la pena tenere. La sua
  sinusoide lenta produce SNR 7, 157 count di deriva nel riposo, tre prove del
  massimo che non concordano (1232 / 2020 / 1417), riferimento sopra il massimo
  e un accento riconosciuto su cinque: **cinque diagnostiche su sei scattano**,
  ognuna per la ragione giusta.
- **Due dettagli della procedura che vengono dall'usarla.** Ogni blocco parte con
  due secondi di *preparati*, o il primo secondo di ogni misura è il gesto che
  parte — e nel riposo sarebbe la mano che lascia il mouse, cioè un artefatto
  dentro il dato che definisce lo zero. E le tre prove del massimo **non si
  concatenano da sole**: dopo un'espirazione forzata serve respirare, e quanto
  non lo può indovinare un timer.
- **Tenuto e colpo sono due tetti diversi**, e confonderli era il modo in cui il
  blocco del massimo falliva *senza spiegarsi*. Trovato alla prima sessione col
  sensore addosso: il gesto naturale non è la `"sgh"` continua ma uno `"SH!"`
  secco, che ha un picco molto più alto — un colpo balistico arriva più su di
  quanto si riesca a tenere. Ma quel blocco misura il plateau con una media
  mobile a **1 secondo**, e un colpo da 200 ms lì viene diluito cinque volte: il
  "massimo" scende vicino al rumore, e il sintomo che si vede è *"il riferimento
  è più alto del massimo"* — che non dice cosa hai sbagliato. Ora la stessa
  registrazione si legge con **due finestre**, 1 s e 0.2 s, e il loro rapporto
  distingue un tenuto da un colpo con un messaggio che nomina la causa. Il tetto
  istantaneo non c'era bisogno di misurarlo: è `burst.picco`, che il blocco degli
  accenti già dava.
- **Il rumore da mettere al denominatore è quello del LIVELLO, non del
  campione** — ed è la correzione più importante arrivata dal campo. Il sintomo:
  SNR 2 su un montaggio in cui l'utente vedeva benissimo le differenze sul
  grafico. Aveva ragione lui. `noiseSigma` (differenze fra campioni consecutivi)
  risponde a *"quanto è dentellata la traccia"*, ma una soglia non si mette mai
  su un campione: si mette sulla media a 200 ms, che il dentellìo lo media via.
  Con un inviluppo oscillante i due numeri differiscono di un fattore grosso, e
  il denominatore era sovrastimato di altrettanto.
  Ora ce ne sono due, con due usi distinti: `noise` per campione regola le soglie
  di rilevamento degli accenti, che lavorano sui campioni grezzi; `noiseLvl` — σ
  robusta delle medie su finestre **disgiunte** — regola l'SNR e i margini di
  `ready`, che sono domande sui livelli. Disgiunte e non mobili: due medie mobili
  adiacenti condividono tutti i campioni tranne uno, e una σ stimata su quelle
  sarebbe sbagliata di √N, cioè di sei volte a 200 Hz.
  Ricaduta: il rapporto fra i due è **esso stesso una diagnosi**. Per rumore
  bianco vale √N; molto meno vuol dire rumore strutturato — ronzio di rete,
  contatto che salta — che non si toglie né col guadagno né con la finestra, e il
  verdetto ora lo dice. E il simulatore, la cui sinusoide lenta *è* vagare, da
  qui in avanti viene correttamente **rifiutato**: il percorso accettato lo prova
  il banco iniettando una calibrazione, quello di rifiuto lo prova il simulatore.
- **Un'escursione piccola non è un problema di elettrodi ma di guadagno**, e le
  due cause vanno separate perché la cura è diversa. Sotto il 12% della scala
  dell'ADC il verdetto dice di alzare il guadagno, e dice anche perché funziona:
  il segnale cresce, il rumore del convertitore no.
- **I livelli si leggono con una MEDIANA, non con una media**, e questa la ha
  decisa una registrazione vera analizzata a valle (30 s di riposo + tenuti +
  accenti, 200 Hz su BLE, zero pacchetti persi). Il disturbo del riposo non è
  rumore bianco ma **bozzi stretti**, una decina di ms l'uno: una media li spalma
  sulla finestra, una mediana li butta. Misurato: la σ della lettura a 300 ms
  passa da **4.73 a 1.92 count**, 2.5 volte, e il livello di un tenuto passa
  intatto (+46 grezzo, +46 filtrato). Con la media, allargare la finestra non
  serviva a niente — a 300 ms la σ era *peggio* che per campione.
  Corollario: gli accenti restano sui campioni grezzi. Un colpo dura 130-240 ms,
  cioè quanto la finestra, e filtrarlo lo dimezzerebbe. La separazione
  livelli/forme non la fa il filtro, la fa l'analisi.
- **Il tetto che risponde a "il sensore vede il muscolo?" è l'accento, non il
  tenuto.** Sui dati veri stavano a **17 volte** di distanza: tenuto +42 count
  (1% della scala ADC), accento +541..+808 (13-20%). Con la σ giusta l'SNR
  passa da 2 a **281**, e la calibrazione viene accettata. Cioè: **il montaggio
  era buono dall'inizio**, e i due rifiuti venivano entrambi da errori di misura
  miei — la finestra sbagliata per il rumore e il gesto sbagliato come tetto.
  `cal.max` resta il tenuto perché è il massimo *sostenibile*, ed è quello che ha
  senso confrontare con una frase cantata, che è sostenuta; `cal.peak` è il tetto
  balistico e serve all'SNR. Quando i due divergono molto il verdetto lo dice, e
  dice anche la conseguenza: %max è una scala debole, si usa ×rif.
- **"Alza il guadagno e l'SNR sale" è vero solo a una condizione**, e prima la
  asserivo senza. Alzando il guadagno crescono insieme segnale e rumore del
  sensore: solo la quantizzazione (1 count) e il rumore dell'ADC restano dov'erano.
  Quindi la promessa vale sotto ~8 count di σ per campione — sui dati veri erano
  4.19, quindi lì vale — e sopra va detto l'opposto: il guadagno compra
  risoluzione, non rapporto, e il limite è a monte.
- **Il confronto con √N per giudicare la "bianchezza" del rumore è morto con la
  mediana**, perché la riduzione di una mediana non è quella di una media. Al suo
  posto una domanda più diretta e più utile: *quanta parte del disturbo
  sopravvive al filtro?* `noiseLvl / noise` vicino a 1 vuol dire troppo lento per
  essere filtrato — contatto che vaga, riferimento incerto — e quello non lo
  aggiusta né il guadagno né la finestra.
- **Una curiosità con una spiegazione esatta**: nello spettro del riposo c'è una
  riga a 33.3 Hz con armoniche, cioè un periodo di **esattamente 6 campioni** a
  200 Hz. Sei campioni sono quelli che entrano in un intervallo di connessione BLE
  da 30 ms: è la radio che accoppia nell'ADC a ogni evento. Ampiezza 0.6 count,
  innocua, ma spiegata.
- **La calibrazione ha smesso di essere un cancello**, e questa l'ha imposta la
  seconda persona vera. `ready` pretendeva riposo *e* tenuto *e* riferimento
  sopra soglia, e spegneva ogni lettura quando uno dei tre mancava. Ma
  l'appoggio di una frase **cantata comoda**, sull'obliquo esterno, sta pochi
  count sopra il riposo: è un fatto sul canto, non un montaggio sbagliato. Ora
  `ready` vuol dire solo *il riposo è misurato* — che basta, perché "quanto è
  alta questa attivazione rispetto al tuo riposo" non ha bisogno di nessun tetto
  — e `hasMax`/`hasRif` accendono le loro scale separatamente. Chi manca spegne
  se stesso e lo dice per nome, invece di dire "massimo o riferimento" e
  spegnere tutto.
  Ne è nata una terza unità, `σ`: quante deviazioni standard del riposo sopra il
  riposo. Non chiede nessun gesto oltre ai dieci secondi di fermo, esiste
  sempre, ed è quella su cui la 5b ordinerà i momenti salienti.
- **Una calibrazione rifiutata non diventa attiva, ma i suoi numeri devono
  restare ispezionabili.** `CAL` tiene solo quella attiva; `MyoLink.calBuilt`
  espone l'ultima costruita comunque sia andata. È il percorso su cui si sbaglia,
  e non averlo raggiungibile dal banco voleva dire non poterlo verificare.
- **Il verdetto stava solo nel log, e il dialog modale gli sta davanti.** Peggio:
  sul percorso di rifiuto non veniva nemmeno scritto, quindi il messaggio diceva
  "guarda il verdetto nel log" e nel log non c'era niente — un rifiuto che
  manda a cercare la spiegazione in un posto vuoto. Ora il referto sta nel
  dialog, e **ogni blocco mostra i propri numeri accanto a sé**: è quella la
  risposta alla domanda vera, che non è "com'è andata" ma *"quale dei quattro è
  quello strano"*.
- **L'`offset EMG` sposta il disegno, non i dati.** L'inviluppo del MyoWare è
  filtrato in hardware e in modo causale, quindi *segue* il muscolo; la traccia
  si disegna spostata indietro di quel ritardo per allinearla al pitch, ma lo
  store e il CSV restano timbrati dal firmware. Il contrario avrebbe compensato
  in un posto solo al prezzo di rendere il CSV non più il dato grezzo.

**Aperto.**

- **Manca il blocco del riferimento su dati veri.** La registrazione analizzata
  aveva riposo, tenuti e accenti ma nessuna frase cantata, e `rif` è il
  denominatore della scala primaria (×rif). Finché non c'è, l'unità in cui la 5b
  esprimerà le soglie non è stata verificata su niente.
- **Le soglie del verdetto restano in parte scelte e non misurate.** Quelle
  toccate dai dati veri ora hanno un numero dietro (mediana contro media, il
  pavimento dell'ADC a 8 count, il rapporto accento/tenuto a 6×); SNR 10 / 20,
  deriva 3σ e i margini 5σ / 3σ no. Le soglie del verdetto (SNR 10 / 20,
  deriva 3σ, margini 5σ e 3σ) e le durate dei blocchi restano scelte ragionate,
  non misurate.
- **La deriva IN SESSIONE non c'è.** Quella implementata è la deriva *dentro* il
  blocco di riposo, che è un controllo sul contatto degli elettrodi. Seguire la
  linea di base lungo mezz'ora di prove è un'altra misura, e sta nella 5b.
- **La cadenza non l'alza la 5a.** Il campo `Hz` c'è già e manda `P<µs>` a caldo;
  passare a 100 Hz è una prova da fare col sensore addosso, e serve a sapere se
  l'oscillazione osservata a 20 Hz è una forma o era aliasing.

---

### Fase 5b — Momenti salienti

**Il vincolo che decide il disegno, e non è tecnico.** Chi usa lo strumento è un
insegnante di canto, non un tecnico. Da lì tre conseguenze che valgono più di
qualunque scelta di algoritmo:

1. **Pochissime manopole, e comprensibili.** Non un oggetto di configurazione con
   metriche, unità e soglie: due o tre comandi che si capiscono senza spiegazione.
2. **I falsi positivi sono preferibili.** Il coach ascolta la voce e decide lui se
   quel punto era davvero sbagliato; un punto di troppo costa dieci secondi, un
   punto mancato non si recupera. Quindi si ottimizza il **richiamo**, non la
   precisione — che è l'opposto di come si taglierebbe un rilevatore "serio".
3. **Non arriveranno etichette.** Chi ha il sensore non sa dire con certezza
   quando il canto è giusto e quando è sbagliato, quindi il piano di "tarare le
   soglie su segmenti etichettati" non sta in piedi. Il disegno non può dipendere
   da un dataset che non esisterà.

Lo scopo è **questo e nient'altro**: su una registrazione di cinque minuti, vedere
subito i punti caldi senza scorrere tutto.

**Il ribaltamento che ne segue: salienza RELATIVA alla registrazione, non soglie
assolute.** Ordinare i momenti di una canzone fra loro non richiede una scala
fisiologica: bastano il riposo e il suo rumore, presi dai tratti quieti della
registrazione stessa. Quindi la calibrazione non è un prerequisito della 5b — è
un raffinamento che aggiunge un'unità confrontabile fra sessioni. Il che è anche
la sola strada praticabile, visto che sull'addome `×rif` resta spesso spenta.

**Le manopole, tutte quante:**

| comando | cosa dice l'utente | come è fatto sotto |
|---|---|---|
| **quanti punti** (uno slider, 5–60) | "dammi venti momenti da guardare" | ordine di pesca già costruito, si taglia a N |
| **cosa cerchi** (tre caselle) | "troppa tensione" / "sostegno che manca" / "instabile" | tre rilevatori che versano candidati nella stessa lista |

Lo slider è il punto: **esprime l'uscita, non il meccanismo**. "Venti punti" si
capisce senza sapere cos'è una soglia, tiene il tempo di lettura sotto controllo
— che era la richiesta — e realizza da sé la preferenza per i falsi positivi:
tirarlo su ne fa comparire di più. Durata minima, isteresi, finestre restano
costanti interne, tarate una volta.

**I tre rilevatori.** Ognuno produce candidati con una misura, e ogni misura
diventa il suo **percentile dentro questa registrazione** prima di entrare in
lista.

| casella | misura | come è delimitato |
|---|---|---|
| *troppa tensione* | il livello (mediana a 300 ms) sopra il riposo | isteresi fra l'80° e il 60° percentile del livello di questa registrazione |
| *sostegno che manca* | quanto sotto la mediana del **canto** sta il livello | solo dentro i tratti dove il microfono sente voce (`clarity ≥` soglia del pannello pitch), primi 300 ms esclusi |
| *instabile* | fluttuazione / livello: un **rapporto**, quindi indipendente dal guadagno | finestre da 0,6 s in cui il livello sta fermo e la fluttuazione attraversa il proprio centro almeno tre volte |

Nessuna soglia assoluta da superare: si ordina e si taglia a N. I percentili di
ingresso decidono la **granularità** dei candidati, non la sensibilità.

**Come si mescolano: girone all'italiana fra le caselle spuntate.** Con venti
punti e due caselle escono dieci e dieci; i posti che un rilevatore non usa vanno
agli altri. L'alternativa — un ordinamento globale per percentile — darebbe più
posti al rilevatore più prolifico, che è il contrario di quello che chiede chi ha
spuntato due cose perché vuole vederne due. E l'ordine di pesca si costruisce
**prima** di tagliare, il che dà le due proprietà che si sentono usando lo
strumento: *alzare lo slider non fa mai sparire un punto che c'era*, e *togliere
una casella non tocca i punti degli altri tipi, gliene aggiunge*. Nessuna delle
due manopole può far scomparire quello che stavi guardando.

**La curatela non è un accessorio: è l'unica via alla taratura.** Ogni punto si
può tenere o scartare. Non essendoci etichette a monte, quelle scelte — fatte
ascoltando — sono il solo dataset che si formerà mai, ed è con quello che le
costanti interne si aggiusteranno. Uno strumento che dice *"guarda qui"* e
raccoglie il *"sì / no" di chi ha orecchie.*

**Cosa si vede.** Una **striscia panoramica** larga quanto la finestra, che
rappresenta tutta la registrazione: inviluppo del segnale, la riga del riposo, una
**corsia per tipo** con una tacca per punto, e il rettangolo della finestra che i
tre pannelli stanno mostrando. È quella a soddisfare il "vedere al volo", non una
lista da scorrere. Sotto, la lista cliccabile — `mm:ss`, tipo, nota, tieni/scarta
— e le bande sul pannello EMG in tempo del grafico, che finiscono nel video da sé.

**Il punteggio non si mostra.** Nessun numero accanto al punto: un numero
inviterebbe a regolarlo, e le manopole sono due. Sopravvive in `marks.json`.

**Dove sta.**

```
app/src/core/marks.js     riposo dalla registrazione, i tre rilevatori, percentili, scelta, intervallo — senza DOM
app/src/ui/marks.js       il pannello: due manopole, striscia, lista, curatela, cursore, riascolto
app/src/audio/tape.js     il nastro dell'audio: anello di PCM, cercabile, riproducibile da un istante
app/src/draw/chart.js     le bande sul grafico EMG
app/src/record/export.js  marksVtt / marksJson / pitchCsv
app/test/marks.test.js    50 test, + 12 in tape.test.js (177 in tutto)
app/tools/marks-csv.mjs   il modulo vero su un CSV già registrato, con --vtt per ascoltare in VLC
app/tools/bench-momenti.mjs  l'app vera in Chrome headless (era bench-5b.mjs: la fase 6 l'ha riscritto)
```

**Fatto quando.** ✅ Su un brano sintetico di tre e di cinque minuti — con dentro
tratti premuti, tratti molli e tratti che oscillano, messi a mano — con lo slider
a venti la striscia mostra venti punti; i **4 tratti premuti su 4** e i **3 molli
su 3** escono in cima al loro rilevatore, e i tratti oscillanti sono primo e
secondo; tirare lo slider a quaranta ne aggiunge venti **senza ricalcolare la
registrazione** e senza spostare i primi venti; tenere/scartare sopravvive al
ricalcolo; il `.vtt` scaricato porta VLC sui punti tenuti. E, con il microfono
aperto, `▶ ascolta` fa risentire l'audio dal cursore mentre i tre pannelli
scorrono con lui — senza aver premuto Registra. Verificato con **50 test
unitari** sul modulo, 12 sul nastro (177 in tutto) e con `tools/bench-5b.mjs` (oggi `bench-momenti.mjs`),
che guida l'app vera in Chrome headless: **35 controlli** verdi, zero eccezioni.

**Com'è venuto.** Le due manopole e i tre rilevatori sono quelli previsti. Quello
che non era previsto è che **tre dei quattro problemi veri fossero bordi di frase**
— e nessuno dei tre si vedeva ragionando:

- **Il riposo di una canzone sta nelle pause fra le frasi, non in dieci secondi di
  fermo.** Dentro un brano non esistono dieci secondi di fermo; esiste il rilascio
  inspiratorio fra due frasi, che dura un secondo o due. Con finestre da 5 s come
  in calibrazione **nessuna finestra è quieta**, e la "base" diventa la frase meno
  forte: sul banco sbagliava di **+26 count su 30** di appoggio, cioè quasi
  l'intera dinamica utile. Ora le finestre sono da 1,5 s, e la base è il **5°
  percentile del livello** invece della media delle finestre quiete — un
  percentile esiste anche dove le pause sono poche, e non è il minimo (che sarebbe
  un buco di pacchetti).
- **"Sostegno che manca" trovava l'attacco di ogni frase, trenta su trenta.** Non
  è un difetto del canto: il livello si legge con una mediana sugli **ultimi** 300
  ms, quindi appena la voce parte quella finestra descrive ancora la pausa. E
  sull'addome il sostegno *precede* il suono, quindi lì non c'è proprio niente da
  rilevare. Si escludono i primi 300 ms di ogni tratto cantato, e il tratto molle
  iniettato passa dal non essere in lista al primo posto con un distacco di 3×
  sul secondo.
- **"Instabile" trovava i bordi delle frasi, per la stessa ragione al contrario.**
  Un gradino dentro una finestra da 0,6 s produce una deviazione grossa come un
  tremore. Due guardie, e sono la definizione operativa di *oscillare* contro
  *cambiare*: la fluttuazione deve **attraversare il proprio centro almeno tre
  volte** (un gradino attraversa una volta, un tremore a 6 Hz sette) e il livello
  dentro la finestra deve **stare fermo** (variare meno di metà di se stesso — una
  salita è materia di "troppa tensione"). Con le due guardie i due tratti
  oscillanti sono primo e secondo, con distacco.
- **La banda in cui si cerca l'oscillazione è delimitata da due tempi già
  misurati, non da una frequenza scelta a mano.** Il bordo lento è la finestra di
  lettura del livello (300 ms): più lento di così non è oscillazione, è la frase
  che sale. Il bordo veloce è la **salita di un accento pulito**, che la
  calibrazione già misura (`cal.burst.salita`; senza calibrazione, 80 ms): più
  veloce di così non è muscolo, è il dentellìo che la mediana esiste per togliere.
  È così che "contro la forma dell'accento" diventa un filtro di validità e non
  un'altra soglia da tarare.
- **L'intervallo da analizzare è la REGISTRAZIONE, non tutto lo store**, e questa
  è la trappola che avrebbe fatto sembrare rotto il rilevatore migliore: nello
  store può starci la calibrazione, e i suoi cinque accenti massimali stanno 13-17
  volte sopra un tenuto. Con quelli dentro, i percentili della canzone finiscono
  tutti schiacciati in basso e "troppa tensione" non trova più niente. Da qui
  `R.t1` accanto a `R.t0` — l'intervallo registrato sopravvive alla fine della
  registrazione — e la riga di referto che dice **su cosa** ha guardato.
- **La deriva misurata sui tratti quieti è cieca esattamente quando c'è qualcosa
  da vedere**, e l'hanno trovato i test iniettando 60 count di deriva: prendendo i
  tratti più quieti di *tutta* la registrazione, con una deriva in salita cadono
  tutti nella prima metà, e il confronto fra le due metà non si può fare. Ora ogni
  metà si guarda coi **propri** tratti quieti. La deriva si **mostra e non si
  corregge** — durante un brano continuo non ci sono pause di riposo, quindi
  correggere in silenzio sarebbe inventare uno zero — e sopra 8σ il referto lo
  dice con la conseguenza pratica: guarda se i punti si affollano in una metà.
- **Il percentile serve meno di quanto sembrava, e vale la pena saperlo.**
  L'ordinamento è invariante a qualunque riscalatura monotona, quindi la σ non lo
  tocca: pesa solo su ciò che si scrive a schermo e sui controlli di presenza. Ne
  segue la regola per la calibrazione, quando c'è: **migliora il rumore, non la
  base**. La base va presa dalla registrazione, perché se gli elettrodi si sono
  mossi quella di `calib.js` è lo zero di un'altra cosa; la σ è misurata su fermo
  vero, mentre un tratto quieto dentro un brano contiene respiro e coda di frase,
  quindi si tiene **la più piccola delle due**. E il percentile resta comunque, in
  `marks.json`: senza, un domani si saprebbe *quali* punti il coach ha tenuto ma
  non *dove stavano* nella distribuzione — che è metà dell'informazione per
  tarare.
- **Il pareggio fra i due percentili di ingresso.** Il livello è una mediana di
  interi: su un tratto fermo e poco rumoroso metà campioni sono identici, e i due
  percentili possono cadere sullo stesso valore. Col confronto largo "dentro"
  diventa tutta la registrazione, cioè **un momento unico lungo cinque minuti**;
  ora in caso di pareggio i confronti diventano stretti.
- **Il cursore di revisione è un pezzo di 5c preso in anticipo, e senza di lui la
  lista era decorativa**: si poteva sapere che c'era un momento a 2:14 e non
  poterlo guardare. Cliccare un punto (o un posto qualunque della striscia) sposta
  l'asse dei tempi dei tre pannelli, col momento **al centro** e non sul bordo
  destro — dal vivo il bordo destro è l'adesso, in revisione l'interessante è cosa
  c'era attorno. Vince anche col sensore collegato, perché guardare un momento e
  vedersi trascinare via dal vivo un secondo dopo sarebbe inutilizzabile; si esce
  con *dal vivo*, che è un pulsante e non un timeout. `n` e `p` scorrono i punti.
- **Un CSV del pitch, che non era in programma.** Senza, una sessione registrata
  non è rianalizzabile a freddo per due terzi: "sostegno che manca" ha bisogno di
  sapere quando c'era voce, e il CSV dell'EMG non lo dice. Due file e non uno,
  perché sono due basi dei tempi diverse e fonderle vorrebbe dire interpolarne una
  — cioè inventare. Con quello, `tools/marks-csv.mjs` fa girare tutti e tre i
  rilevatori su una registrazione già fatta, e con `--vtt` scrive i capitoli da
  dare a VLC accanto all'mp4: si controllano i punti **ascoltando**, senza
  passare dall'app.
- **`PitchStore` da 32768 a 262144** (4 MB): ~87 minuti invece di ~11. Su un
  limite così il sintomo non è un errore, è la prima metà della canzone che
  sparisce in silenzio.

**Aggiunto dopo, dalla prima sessione vera con una persona.** Tre cose, e tutte e
tre venivano dalla stessa domanda — *"ho sbagliato qualcosa?"* — che è la domanda
che fa uno strumento quando non dice cosa sta facendo.

- **Chi calibra, canta e preme Momenti non ha sbagliato niente: era lo strumento
  che guardava nel posto sbagliato.** Senza registrazione l'intervallo era *tutto
  lo store*, calibrazione compresa, e i cinque accenti massimali si prendevano
  tutti i primi posti. Ora l'intervallo lo decide `pickRange`, che è una funzione
  pura e testata perché sbagliata non si vede: registrazione se c'è, altrimenti
  **da dove è finita la calibrazione** (più due secondi per rimettersi in
  posizione), altrimenti tutto — e **quale dei tre sia lo scrive**, nella barra
  del pannello e nel log. Una registrazione più corta di otto secondi non conta
  come registrazione: *Registra* premuto e ripremuto per sbaglio non deve
  nascondere il resto della sessione.
- **Stop non scarica più il video.** Vedersi comparire un file nei download
  premendo Stop, prima di aver guardato com'è venuto, "sembra strano" — ed è
  strano davvero, perché fra Stop e "lo tengo" in mezzo c'è il riascolto. Il file
  resta in memoria, un pulsante **Salva video + CSV (2:24 · 12.4 MB)** lo scarica
  con durata e peso scritti sopra, e il log dice che *Momenti* lo analizza mentre
  *Salva* lo porta via. È anche il pezzo che serviva alla 5c, dove il replay prende il video
  da `R.blob` invece di dal disco.
- **Il nastro dell'audio, che è metà della 5c.** La domanda vera era *"posso
  riascoltare dal cursore in avanti?"*, e la risposta era no: l'audio del
  microfono passava dalla FFT e dal pitch e veniva buttato, quindi l'unica copia
  stava dentro l'mp4 — bisognava decidere **prima** di cantare che si voleva poter
  riascoltare. Ora un anello di PCM gira per tutto il tempo in cui il microfono è
  aperto (24 kHz Int16, otto minuti, 23 MB) e `▶ ascolta` — o la barra
  spaziatrice — riparte dal cursore. Dettagli che non erano ovvi:
  - **PCM grezzo e non un secondo MediaRecorder**, che costerebbe 2 MB invece di
    23. Un blob di MediaRecorder si legge solo quando è chiuso: per riascoltare a
    metà sessione bisognerebbe fermare e riavviare la registrazione, cioè bucare
    il nastro proprio mentre serve. E il WebM che produce è un flusso *live* senza
    `Duration` né `Cues` — misurato alla fase 4 — quindi cercare un punto dentro è
    esattamente ciò che non sa fare.
  - **Ogni blocco porta il suo timbro**, come ogni campione EMG: così `1:47` nella
    lista e `1:47` nel nastro sono lo stesso istante, senza assumere che il clock
    della scheda audio e `performance.now()` corrano insieme (non lo fanno:
    qualche decimo di secondo su cinque minuti). Un salto indietro nel timbro vuol
    dire base dei tempi cambiata, e il nastro si azzera — la regola di
    `Ring.monotonic`, di nuovo.
  - **Mentre si riascolta, la cattura non scrive.** Né negli store né nel nastro:
    il microfono sente le casse, e senza questo lo spettrogramma registrerebbe il
    riascolto come se fosse adesso e il nastro si sovrainciderebbe da solo. Era
    già scritto come trappola della 5c ("in replay la cattura audio NON deve
    scrivere negli store"), ed è arrivata con l'audio invece che col video.
  - **Il cursore lo muove la riproduzione**, quindi EMG, pitch e spettrogramma
    scorrono insieme all'audio senza un timer in più: `timeAxis()` chiama
    `reviewT()` a ogni fotogramma, e quella durante il riascolto risponde con la
    posizione della riproduzione. Verificato in browser: +0,90 s di cursore in
    0,90 s di orologio.
  - **Cercare in un buco torna indietro, non avanti.** Chi clicca a 1:30 vuole
    sentire cosa c'era lì: saltare al primo campione dopo il buco gli farebbe
    sentire un altro pezzo di canzone credendo che sia quello.

**Aggiunto dopo, dal giro seguente: due pulsanti che mentivano sul nome.** Non
erano bug — l'app faceva esattamente quello che c'era scritto nel codice — ed è
il motivo per cui erano rimasti lì: nessun test può accorgersi che un'etichetta
racconta un'altra storia.

- **"Stop" era un disconnetti.** Accanto a *Registra*, un pulsante *Stop* si legge
  come lo stop della stessa cosa: metti in pausa la lettura e poi riprendi. Invece
  chiudeva il link col device, e per ricominciare bisognava rifare la scelta del
  dispositivo dal dialogo del browser. Adesso c'è scritto **Disconnetti**, e il
  log dice cosa resta (*"i dati letti restano in memoria"*) invece del solo
  "stop". Una pausa vera non è stata aggiunta di proposito: sarebbe un terzo stato
  fra collegato e scollegato — con l'asse dei tempi che avanza e i dati che non
  arrivano, cioè un buco identico a una radio che cade — e quel buco l'app lo
  mostra già. Il pulsante che si accende e si spegne quante volte si vuole è
  *Registra*, ed è quello giusto per farlo.
- **"Salva video" salvava metà della prova.** Chi registra tre minuti si aspetta
  di portarsi a casa *quella prova*: il video **e** i dati. Il CSV c'era, ma era
  l'altro pulsante e conteneva un'altra cosa — tutta la memoria, calibrazione e
  riscaldamento compresi — quindi il dubbio giusto ("questi dati sono quelli del
  video?") aveva risposta *no*, senza che niente lo dicesse. Ora allo stop la
  registrazione **si porta dietro i suoi campioni**, tagliati sull'intervallo del
  video con gli stessi estremi che usa `pickRange` per i *Momenti*, e un clic
  scarica `myolink-<data>.mp4`, `.csv` e `.pitch.csv` con il **timbro condiviso**:
  tre file che si riconoscono come lo stesso pezzo di prova stando uno accanto
  all'altro nella cartella dei download. L'altro pulsante si chiama *CSV live* e
  dice quello che fa.
  - **I dati si congelano allo stop, non al salvataggio.** È la trappola vera:
    lo store è un anello, a 1 kHz tiene ~7 minuti, e fra lo stop e il salvataggio
    ci sono per progetto il riascolto e i *Momenti*. Chi salva dopo dieci minuti
    troverebbe l'inizio della prova già mangiato da quello che è arrivato dopo —
    e il file uscirebbe più corto del video senza un errore da nessuna parte.
    Costa qualche MB di testo accanto a un video da cento, tenuto come Blob e non
    come stringa.
  - **Un intervallo, non due implementazioni.** `inRange` è una ricerca binaria
    sull'anello con gli **estremi compresi**, ed è la stessa fetta per l'EMG e per
    il pitch. Mezzo campione fuori per parte sarebbe invisibile su un grafico e
    visibile in un CSV: il posto peggiore in cui scoprirlo.
  - **Un file vuoto non si scrive affatto.** Registrare senza sensore collegato
    dava un CSV di sola intestazione, che sembra un dato perso; ora il file non
    esce e il log dice perché ("era registrato solo il video").
  - Verificato in browser, non solo a unit test: con 180 s di brano in memoria e
    3 s registrati, il blob del CSV ha **586 righe su 36.000** e **nessuna riga
    fuori dall'intervallo**.
- **Il cronometro della registrazione saltava, e quello faceva sembrare piantata
  l'app.** Era appeso a `ondataavailable`, cioè all'arrivo dei chunk: il
  `timeslice` è di un secondo ma l'encoder consegna quando gli conviene, e in una
  prova headless il primo pezzo è arrivato dopo **sei secondi, tutto insieme**.
  Ora lo muove il ciclo di disegno — che gira comunque a ogni fotogramma finché si
  registra — e il DOM si tocca solo quando cambia il secondo o il conteggio dei
  byte. Verificato campionando l'etichetta ogni 300 ms: `0:00 … 0:06`, un secondo
  per secondo, nessun salto.
  - **Il peso non si può accelerare, e quindi si dice diversamente.** I byte
    esistono quando l'encoder li ha consegnati: `0.0 MB` fermo accanto a un
    cronometro che corre è il numero che fa dubitare della registrazione, quindi
    il peso compare **quando c'è** e in kB finché è piccolo. Il tempo è la cosa
    che l'app sa con certezza a ogni fotogramma; il peso arriva dopo.
  - **E la durata è finita accanto ai mega dove serviva**: sul pulsante
    (`Salva video + CSV (2:24 · 18.6 MB)`), sulla riga che butta la registrazione
    precedente e su quella che la salva. 12 MB non dicono se sono venti secondi o
    tre minuti, e fra due prove è la durata a farle riconoscere. Sotto il minuto
    i secondi con un decimale, perché a otto secondi `0:08` nasconde proprio la
    cifra che dice se il pulsante è stato premuto e ripremuto per sbaglio.

**Aperto.**

- **Non è ancora passato su una registrazione vera.** Tutto quello che sta qui
  sopra è misurato su brani sintetici e sul simulatore: i tre rilevatori trovano
  quello che ci è stato messo dentro, che è una condizione necessaria e non
  sufficiente. La prossima cosa da fare è `tools/marks-csv.mjs` su una canzone
  vera col suo mp4 accanto.
- **"Instabile" è l'unico dei tre senza un numero misurato dietro.** La forma
  dell'indice (rapporto fluttuazione/livello) e le due guardie sono ragionate;
  quanto valga su una voce vera non si sa. E a 20 Hz il Nyquist è a 10 Hz, in
  mezzo alla banda del tremore: **la registrazione di prova va fatta a 200 Hz**
  (campo `Hz` + *Applica*), o quel rilevatore parte handicappato.
- **Il raffinamento "già alta all'inizio della frase" non è stato fatto.** Le
  frasi si possono segmentare dall'EMG stesso (il rilascio inspiratorio si vede),
  e "premuto da subito" è più interessante di "premuto verso la fine", che è
  naturale. Ma è da tarare sui dati veri, non da decidere prima.
- **La curatela non persiste oltre la sessione.** Sta in `marks.json`, che si
  scarica; un `localStorage` per sessione avrebbe senso solo insieme a un formato
  di sessione, che è fuori dalla fase 5.
- **La quota equa fra le caselle è una scelta, non una misura.** Su un brano vero
  potrebbe risultare che un rilevatore meriti più posti degli altri; si vedrà
  guardando, ed è una riga.

### Fase 5c — Replay

**Metà è già fatta dalla 5b**, e non per caso: serviva a lei. Il cursore di
revisione muove già i tre pannelli, il nastro dell'audio fa già risentire un
momento dal punto giusto, e il file dell'mp4 resta già in memoria invece di
scaricarsi. Quello che manca alla 5c è **il video**: un `<video>` nascosto sul
blob, `video.currentTime` legato allo stesso cursore, e lo spettrogramma
ri-derivato riproducendo. Cioè il replay *con le immagini* invece che col solo
audio.

**Costa poco perché quattro pezzi ci sono già**, e vale la pena averlo scritto:

1. **Il disegno è già parametrico sul tempo, e il cursore ORA C'È.** `drawChart(ax)`,
   `drawPitch(ax)`, `drawSpec(ax)` ricevono `{W, tNow, tLeft}` da `timeAxis()` in
   `main.js`, e la 5b ci ha già messo dentro il cursore di revisione: cliccare un
   momento sposta i tre pannelli su quel punto. Al replay resta da agganciare il
   `<video>` a quel cursore, non da inventarlo.
2. **Il blob non si scarica più da sé: resta in `R.blob`**, che è dove il replay
   lo prenderà. E `R.t0` è già l'ancora fra i due tempi:
   `secondiVideo = tMark − T.fromHost(R.t0)`.
3. **La catena audio è agganciata a una sorgente sostituibile**
   (`A.src = createMediaStreamSource(...)`): con `createMediaElementSource` lo
   spettrogramma si rigenera dal video senza una riga di DSP nuovo. Non serve
   salvare 24 MB di colonne: non si salvano, si riproducono.

**Come.** Il blob si tiene invece di solo scaricarlo, un `<video>` nascosto lo
riproduce, la lista degli highlight diventa cliccabile
(`video.currentTime = ...`) con `n`/`p` per il precedente e il successivo —
dal vivo, con le mani occupate, è l'unica interazione che serve davvero.

**La divisione dei tre pannelli in replay, che è anche la trappola da non
sbagliare:**

- **EMG e pitch dagli store registrati** → seek istantaneo, si può anche
  tornare indietro.
- **Spettrogramma ri-derivato riproducendo** → in avanti a 1×, e dopo un salto
  la storia si ricostruisce da lì.

**In replay la cattura audio NON deve scrivere negli store.** `Ring.monotonic`
azzera lo store su un salto indietro > 0,5 s, e un seek è esattamente quello:
il primo salto distruggerebbe i dati della sessione. Per lo *spettrogramma*
quel clear-on-jump è invece il comportamento giusto e si sfrutta; per il
*pitch* la cattura si spegne e si disegna quello registrato.

**Un timecode piccolo nell'angolo del canvas di composizione.** Rende
l'allineamento video↔grafico verificabile su qualunque fotogramma estratto con
ffmpeg, per sempre. (L'allineamento *dovrebbe* essere corretto per costruzione:
i 29,9 fps misurati alla fase 4 contro i 30 chiesti sono fotogrammi in meno,
non una timeline sbagliata — `MediaRecorder` timbra con l'orologio vero. Ma è
esattamente il tipo di cosa che si vuole poter ricontrollare invece di
ricordare.)

**Da mettere in conto.** Il blob resta in RAM finché non si registra di nuovo:
è lo stesso limite già annotato alla fase 4, non uno nuovo.

**Fatto quando.** Finita una registrazione, la lista degli highlight è
cliccabile e il video salta al punto con i tre pannelli allineati a quello che
mostravano dal vivo; `n`/`p` scorrono i mark; l'allineamento è verificato
leggendo il timecode di un fotogramma estratto.

---

### Da qui

Ordine consigliato per chi riprende a freddo:

1. **Leggere "Cosa dicono i dati veri"** qui sopra. Le costanti di `core/calib.js`
   che hanno un numero dietro vengono da lì, e cambiarle senza rileggerlo vuol
   dire rifare errori già fatti tre volte.
2. **Provare la 5b su una canzone vera**, che è la cosa che manca adesso:
   `node app/tools/marks-csv.mjs canzone.csv --pitch canzone-pitch.csv --n 20
   --vtt canzone.vtt`, poi guardare l'mp4 in VLC con quel `.vtt` accanto e
   ascoltare i venti punti. È lì che si scopre se le costanti dei tre rilevatori
   vanno spostate, e nessun brano sintetico lo può dire. **Registrare a 200 Hz**:
   a 20 Hz il Nyquist taglia la banda del tremore e "instabile" parte handicappato.
3. **5c**, perché la lista di punti della 5b è ciò che rende il replay utile — e
   perché metà del lavoro è già fatta: il cursore di revisione della 5b È la
   `timeAxis()` che legge un cursore invece di `T.now()`, e al replay resta da
   agganciarci il `<video>`.

**Decisioni ancora aperte, da prendere con chi canta e non da soli:**

- **Il blocco del tenuto vale ancora i suoi 3 × 4 s?** Accende solo `%max`, che
  sui dati veri risulta una scala debole, e tre espirazioni forzate sono la parte
  spiacevole della procedura. Toglierlo accorcerebbe la calibrazione di un terzo;
  tenerlo costa poco e dà un numero in più. Va deciso guardando se `%max` verrà
  mai usata davvero. La 5b non la usa: le basta `base`, e la σ solo per quello
  che scrive a schermo.
- **Serve ancora il blocco del riferimento**, se `×rif` resta spenta quasi sempre?
  La σ del riposo copre il caso, e il riferimento costa 8 s. Ma è l'unica unità
  *musicalmente* leggibile ("il 180% del tuo appoggio normale"), quindi la
  domanda è se esista un posizionamento in cui si accende.
- **Il blocco degli accenti, invece, ha guadagnato un uso**: la sua `salita` è il
  bordo veloce della banda in cui la 5b cerca le oscillazioni. Senza calibrazione
  quel bordo è 80 ms scelti a mano.
- **La quota equa fra i tre rilevatori** (dieci e dieci con due caselle) è una
  scelta di disegno: su un brano vero potrebbe risultare che uno meriti più posti.

**Cosa NON rifare.** Le tre cose che questa fase ha già corretto, e su cui è
facile ricadere: misurare il rumore sui valori invece che sulle differenze;
misurare i livelli con una media invece che con una mediana; e trattare un
denominatore debole come un errore di misura invece che come un'informazione.

A queste la 5b aggiunge due trappole sue, che sono la stessa trappola vista da due
lati — **il livello si legge guardando indietro, e i bordi di frase lo sanno**:
non cercare un'attivazione bassa nei primi 300 ms di una frase (la finestra
descrive ancora la pausa), e non chiamare "instabile" un gradino (dentro una
finestra da 0,6 s un attacco produce la stessa deviazione di un tremore). E una
terza che non c'entra col segnale: **analizzare la registrazione, non lo store** —
se dentro c'è la calibrazione, i suoi accenti schiacciano tutti i percentili.

---

### Fuori dalla fase 5

- **Riapertura di sessioni vecchie.** Richiederebbe un formato di sessione
  (header con calibrazione, regole e mappatura `t0`, più array EMG e pitch — lo
  spettrogramma no, si rigenera dall'audio). È l'unico dei tre livelli di replay
  che introduce qualcosa da mantenere, quindi resta fuori finché non serve.
- **Note-bersaglio da partitura.** Con un elenco di note noto prima si potrebbe
  flaggare anche la nota *mancata*, che il pitch rilevato da solo non dice.
- **Flag dal vivo.** La 5b lo rende quasi gratis, ma è una decisione a parte.

---

## Fuori piano (per ora)

- **Riapertura di sessioni salvate su disco.** Il cursore `tNow` invece di
  `T.now()` — escluso dalla fase 4 — entra nella **fase 5c**, ma solo per la
  sessione appena registrata, che è in RAM. Riaprire un file vecchio richiede
  un formato di sessione e resta fuori.
- **Render offline in WebCodecs** (`VideoEncoder` + muxer): qualità
  pubblicabile, zero frame persi, spettrogramma ricalcolato. Richiede la fase 2.
- **Seriale su Android via WebUSB**, se servirà.
- **Port nativo** (Flutter), solo se servono iOS o installer.
