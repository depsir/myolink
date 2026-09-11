// ============================== la fase ==============================
//
// Un solo stato, tre valori, e tutto il resto ci si appende. Nasce da una frase
// sola di chi l'app la usa:
//
//   «non si capisce perché quando abilito il simulatore e o il microfono vedo
//   cose e poi quando registro cosa registra e se stoppo il microfono cosa fa, e
//   se stoppo la registrazione se continuo a vedere il live, insomma non si
//   capisce e non si capisce poi dove vanno a finire le cose registrate»
//
// Sono cinque domande, e sono **una per flag indipendente**: `S.running` (il
// link), `A.on` (il microfono), `R.on` (la registrazione), `MK.cursor` (la
// revisione). Quattro interruttori che nessuna schermata dichiarava e nessuna
// relazione legava fra loro. Il difetto non era la densità della UI: era che non
// c'era un modello.
//
// **Gli ingressi non sono una fase.** Sensore e microfono sono uno stato
// PERMANENTE — la rastrelliera di un multitraccia, le sorgenti di OBS — e la
// registrazione è un'azione sopra di essi. Accendere il microfono non cambia
// cosa stai facendo, cambia cosa entra.
//
// **Fermare invece sì, e qui c'era un errore mio.** Avevo sostenuto che «il vivo
// non è una modalità, registrare aggiunge»: vero MENTRE registri, falso appena
// fermi. Da quel momento non stai più guardando te stesso, stai guardando una
// registrazione — e tenere le due cose insieme produce esattamente quello che si
// vedeva: *Registra* in alto e *Salva/Elimina* in basso, due set di comandi che
// si contendono lo schermo mentre i grafici scorrono via sotto una presa ferma.
//
//   vivo         → ingressi, riquadro, grafici che scorrono.      comando: Registra
//   registrando  → identico, più il tempo e i pallini rossi.      comando: Ferma
//   presa        → tutto fermo sulla registrazione, la striscia   comando: ← Torna al vivo
//                  è la navigazione.
//
// *Registra* non esiste mentre guardi una presa; *Salva/Elimina* non esistono dal
// vivo. Non si sovrappongono più perché non convivono. E «registra di nuovo»
// smette di essere un caso a sé: per rifarlo torni al vivo, ed è lì che l'app
// chiede se salvare quella che stai per perdere.
//
// Niente DOM qui dentro: chi vuole vedere la fase a schermo si iscrive. Il modo
// semplice/avanzato NON è una fase e sta apposta altrove (`ui/modo.js`): è una
// preferenza di quanto mostrare, non un compito diverso.

export const FASI = ["vivo", "registrando", "presa"];

export const F = { now: "vivo" };

const subs = [];

// L'iscritto viene chiamato subito con la fase corrente: così chi si aggancia
// all'avvio non deve rifare a mano la prima sincronizzazione, e non esiste un
// istante in cui lo schermo dice una fase diversa da quella vera.
export function onFase(fn) {
  subs.push(fn);
  fn(F.now, null);
}

export function setFase(f) {
  if (!FASI.includes(f)) throw new Error("fase sconosciuta: " + f);
  if (f === F.now) return F.now;
  const prima = F.now;
  F.now = f;
  for (const s of subs) s(f, prima);
  return f;
}

export const fase = () => F.now;
