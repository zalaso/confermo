# Setup di Confermo, passo per passo

Dalla cartella vuota fino a uno studio che invia promemoria veri.

Il percorso è diviso in quattro parti. **La prima si fa una volta sola**; le
altre si ripetono per ogni studio.

| Parte | Quando | Tempo |
| --- | --- | --- |
| [1. Mettere online il servizio](#parte-1--mettere-online-il-servizio) | Una volta sola | ~30 min |
| [2. Creare lo studio](#parte-2--creare-lo-studio) | Per ogni studio | 5 min |
| [3. Collegare il canale WhatsApp](#parte-3--collegare-il-canale-whatsapp) | Per ogni studio | ~45 min + attese |
| [4. Collaudo](#parte-4--collaudo-prima-di-consegnare) | Per ogni studio | 10 min |

> Per **fare demo** non serve nulla della parte 3: la modalità dimostrativa
> funziona senza alcuna credenziale. Vedi [§ Preparare una demo](#preparare-una-demo).

---

## Prima di iniziare

Serve avere:

- **Node.js 22 o superiore** e **git** installati
- Un account **GitHub** (il codice va in un repository, anche privato)
- Un account su **Railway** oppure un server proprio

Per lo sviluppo in locale non serve installare PostgreSQL: viene scaricato come
dipendenza del progetto.

### Provare in locale (facoltativo)

```bash
npm install
npm run db:start                  # database locale, lascialo aperto
npm run db:migrate -w apps/api    # solo la prima volta
npm run seed -- --clinic "Studio Demo" --preset dentista
npm run dev:api                   # in un altro terminale
npm run dev:web                   # in un terzo terminale
```

Dashboard su `http://localhost:5173`, credenziali stampate dal comando `seed`.

---

## Parte 1 — Mettere online il servizio

Percorso consigliato: **Railway**, regione europea. L'alternativa su server
proprio è in [riferimenti/deploy.md](riferimenti/deploy.md).

### 1.1 — Il codice su GitHub

Il repository deve esistere prima che Railway possa vederlo:

```bash
git init
git add -A
git commit -m "Confermo"
gh repo create confermo --private --source=. --remote=origin --push
```

Verifica che `.env` **non** sia finito nel commit (è escluso dal `.gitignore`,
ma controllalo: contiene segreti).

### 1.2 — Il progetto su Railway

1. **New Project → Deploy from GitHub repo** → seleziona `confermo`
2. Se il repository non compare: **Configure GitHub App** e autorizza l'accesso
3. **Settings → Region**: scegli **europe-west4** — i dati dei pazienti devono
   restare in UE
4. **Settings → Source → Root Directory**: deve essere `/`, non `apps/api`

Il primo deploy fallisce perché manca il database: è previsto.

> Non serve configurare i comandi di build: il file `railway.json` nella radice
> dichiara già build, migrazioni e avvio.

### 1.3 — Il database

**+ New → Database → PostgreSQL**, anch'esso in regione europea.

### 1.4 — Le variabili d'ambiente

Sul servizio `confermo` → **Variables → Raw Editor**, incolla:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<genera>
CREDENTIALS_ENCRYPTION_KEY=<genera>
NODE_ENV=production
NPM_CONFIG_INCLUDE=dev
MESSAGING_PROVIDER=mock
```

Genera i due segreti con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Tre avvertenze che fanno perdere tempo se ignorate:

- **`CREDENTIALS_ENCRYPTION_KEY` non è recuperabile.** Se la perdi, le
  credenziali WhatsApp salvate diventano illeggibili e vanno reinserite a mano
  studio per studio. Mettila in un gestore di password.
- **`NPM_CONFIG_INCLUDE=dev` è obbligatoria.** Con `NODE_ENV=production` npm
  salta le dipendenze di sviluppo, ma gli strumenti che compilano la dashboard
  stanno lì: senza questa variabile il build fallisce.
- **`DATABASE_URL` va scritta esattamente così**, con le graffe: è un
  riferimento che Railway risolve. Se la card del database non si chiama
  `Postgres`, correggi quel nome.

### 1.5 — Il dominio pubblico

**Settings → Networking → Generate Domain**. Copia l'indirizzo e aggiungilo
alle variabili:

```
APP_BASE_URL=https://<il-tuo-dominio>
```

Con `https://`, senza barra finale. Serve a costruire l'indirizzo del webhook
WhatsApp, quindi dev'essere quello definitivo.

### 1.6 — Verifica

Salvando le variabili parte un nuovo deploy. Quando è verde:

```
https://<il-tuo-dominio>/api/health
```

Risposta attesa:

```json
{"ok":true,"database":"ok","scheduler":{"status":"ok"}}
```

Se `database` non è `ok`, il problema è la connessione al database e non ha
senso proseguire.

---

## Parte 2 — Creare lo studio

Dalla **Console** del servizio `confermo` su Railway:

**Per uno studio reale:**

```bash
npm run seed -w apps/api -- --clinic "Studio Dentistico Rossi" --preset dentista --no-demo --email studio@esempio.it
```

**Per uno studio dimostrativo** (senza `--no-demo`, resta in modalità demo):

```bash
npm run seed -w apps/api -- --clinic "Studio Dentistico Rossi" --preset dentista
```

Preset disponibili: `dentista`, `poliambulatorio`, `fisioterapia`. Cambiano solo
le tipologie di appuntamento proposte, non il funzionamento.

Il comando stampa email e password: **annotale**.

> ⚠️ Attenzione: il seed **cancella e ricrea** i dati dello studio se ne esiste
> già uno con lo stesso nome. Non lanciarlo su uno studio con dati veri.

### Cambiare la password

Da dashboard → **Impostazioni → Password di accesso** (serve quella attuale).
Se l'accesso è perso, dalla Console:

```bash
npm run set-password -w apps/api -- --list                     # chi è registrato
npm run set-password -w apps/api -- --email studio@esempio.it  # genera una password nuova
```

---

## Parte 3 — Collegare il canale WhatsApp

**Il canale è intestato allo studio**: numero, account e documenti sono suoi.
Prima di questa parte lo studio deve avere pronto il materiale elencato in
[per-lo-studio.md](per-lo-studio.md).

Due strade possibili.

### Strada A — 360dialog (consigliata per la produzione)

Un intermediario ufficiale: intermedia la fatturazione e offre assistenza, che
per uno studio vero vale il canone.

Procedura completa: **[riferimenti/whatsapp-360dialog.md](riferimenti/whatsapp-360dialog.md)**
Foglio di campo da usare durante la visita: **[riferimenti/checklist-attivazione.md](riferimenti/checklist-attivazione.md)**

In sintesi: account su hub.360dialog.com → collegamento del numero → verifica
dell'azienda → sottomissione dei due modelli → credenziali in dashboard →
webhook nel pannello.

### Strada B — Meta Cloud API (diretta)

Nessun intermediario, costo inferiore, ma l'assistenza sei tu. È anche la
strada per **collaudare gratuitamente** su un numero di test, senza verifica
aziendale.

Procedura completa: **[riferimenti/whatsapp-collaudo-meta.md](riferimenti/whatsapp-collaudo-meta.md)**

### In entrambi i casi: i due modelli di messaggio

I modelli vanno approvati da Meta **per ogni canale**: quelli approvati su un
canale non valgono su un altro. I testi esatti sono in
[riferimenti/whatsapp-360dialog.md](riferimenti/whatsapp-360dialog.md).

Tre regole che se sbagliate costano una ricreazione o un mancato recapito:

1. **Nomi esatti**: `promemoria_48h` e `promemoria_3h`, minuscoli. Sono
   case-sensitive e **non si possono rinominare**: un refuso costa la
   ricreazione del modello.
2. **Categoria Utility, mai Marketing.** Meta limita i messaggi marketing a
   circa 2 al giorno per utente sommati fra tutte le aziende: il promemoria
   potrebbe non arrivare.
3. **Due pulsanti nell'ordine giusto**: `Confermo`, poi `Devo disdire`.

### Inserire le credenziali

Dashboard → **Impostazioni → Canale WhatsApp**: provider, numero mittente,
identificativo del canale, credenziale → **Salva**. Poi copia l'**indirizzo del
webhook** che compare e incollalo nel pannello del provider.

---

## Parte 4 — Collaudo prima di consegnare

Da fare **sul dispositivo che userai**, sulla rete che userai.

- [ ] `https://<dominio>/api/health` risponde `ok`
- [ ] Accesso dal telefono: nessuno scorrimento laterale, agenda leggibile
- [ ] **Impostazioni → Invia messaggio di prova** verso un cellulare reale: il
      messaggio arriva **con i due pulsanti**
- [ ] Creare un paziente con un numero raggiungibile e un appuntamento fra ~47
      ore: entro un minuto il promemoria parte **da solo**
- [ ] Premere **Confermo**: la scheda diventa verde e arriva il ringraziamento
- [ ] Premere **Devo disdire** su un altro: diventa rossa, compare tra i
      messaggi da gestire, e il promemoria delle 3 ore risulta annullato
- [ ] Scrivere **STOP**: il paziente passa a «non vuole messaggi»
- [ ] Riattivarlo dalla sua scheda (serve il consenso privacy spuntato)
- [ ] Verificare gli **orari di silenzio** in Impostazioni: 21:00–08:00 va bene
      quasi sempre, ma se lo studio apre alle 7:30 vanno spostati
- [ ] Verificare le **tipologie di appuntamento**: etichette generiche, mai
      diagnosi

Se al punto del promemoria automatico non parte nulla, prima di sospettare un
guasto controlla l'ora: dentro gli orari di silenzio l'invio viene rimandato, ed
è voluto.

---

## Preparare una demo

Non serve alcuna credenziale WhatsApp.

```bash
npm run seed -- --clinic "Nome dello studio che visiti" --preset dentista
```

Poi, dalla dashboard, la **barra gialla** in cima permette di cambiare nome
dello studio e tipo di attività e di **azzerare i dati** in meno di un secondo,
per passare da un cliente al successivo.

Durante la presentazione, su ogni appuntamento il pulsante **📱 Messaggio** apre
il telefono simulato: «Invia promemoria adesso» mostra il messaggio vero, e i
pulsanti sono cliccabili.

---

## Se qualcosa non funziona

| Sintomo | Causa tipica |
| --- | --- |
| Il build su Railway fallisce con `EBUSY` | Un `npm ci` di troppo nel comando di build: lo esegue già la piattaforma |
| Il build fallisce compilando la dashboard | Manca `NPM_CONFIG_INCLUDE=dev` |
| `/api/health` risponde 503 | Database irraggiungibile, oppure scheduler fermo da oltre 5 minuti |
| «Modello rifiutato (132001)» | Nome o lingua del modello non combaciano; oppure è su un altro account WhatsApp |
| Il messaggio parte ma la risposta non torna | Manca la sottoscrizione al campo `messages`, o (su Meta) l'iscrizione dell'app all'account WhatsApp |
| Errore di credenziali dopo un giorno | Token di test di Meta scaduto: dura 24 ore |
| Un pulsante della dashboard non fa nulla | Guarda la console del browser: se c'è un errore di rete, il server potrebbe essere in fase di riavvio |

Diagnosi dettagliate in
[riferimenti/whatsapp-collaudo-meta.md](riferimenti/whatsapp-collaudo-meta.md),
sezione finale.
