# Piano di lavoro — MyoLink

Quattro fasi indipendenti, in ordine di dipendenza. Ognuna è ripartibile a
freddo: qui c'è il perché, cosa si tocca e quando è finita.

| # | fase | stato |
|---|------|-------|
| 1 | Diagnostica dei permessi (bug Brave mobile) | **fatta** |
| 2 | Build: sorgenti a moduli, bundle in uscita | da fare |
| 3 | UI mobile | da fare |
| 4 | Registrazione video + audio | da fare |

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

**Fatto quando.**
- `npm run dev` serve l'app in locale con hot reload su https/localhost;
- `npm run build` produce un `dist/` deployabile, e l'app buildata si comporta
  come oggi (grafico, pitch, spettrogramma, entrambi i trasporti, simulatore);
- `npm test` verde su CRC, COBS, packet, wrap del timestamp, YIN, store;
- il deploy Vercel funziona dal build.

**Trappole.**
- I test del DSP non hanno bisogno del DOM: tenere `dsp/` e `proto/` puri, senza
  toccare `document` — è la ragione principale per cui lo split conviene.
- L'ordine di inizializzazione: oggi il codice si affida al fatto che tutto sta
  in un unico scope. I moduli lo rendono esplicito, e qualche `const` di livello
  superiore va spostata in `state.js` per non creare cicli di import.

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
  events ci sono già (`index.html:944`), quindi è area di tocco + una riga CSS.
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

**Fatto quando.** Su un telefono in portrait si connette, si apre il microfono,
si vedono almeno due pannelli insieme, e si riesce a ridimensionarne uno col
dito senza che la pagina scrolli.

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

**Fatto quando.** Si preme *Registra*, si sceglie cosa includere, si ferma, e si
scarica un `.webm` in cui i grafici scorrono e l'audio è allineato a quello che
mostravano.

---

## Fuori piano (per ora)

- **Timeline scrubbabile e riapertura sessione.** Sarebbe lo stesso lavoro del
  render offline: pilotare il disegno da un cursore `tNow` invece che da
  `T.now()`. Escluso esplicitamente dalla fase 4.
- **Render offline in WebCodecs** (`VideoEncoder` + muxer): qualità
  pubblicabile, zero frame persi, spettrogramma ricalcolato. Richiede la fase 2.
- **Seriale su Android via WebUSB**, se servirà.
- **Port nativo** (Flutter), solo se servono iOS o installer.
