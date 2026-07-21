# Attivare WhatsApp per un nuovo studio (360dialog)

Ogni studio è **intestatario del proprio canale WhatsApp**: account 360dialog e
numero suoi. Confermo si collega al canale con la API key dello studio, salvata
cifrata. Questa è la procedura completa, da fare una volta per studio.

## Prerequisiti

- Un numero di telefono dedicato al canale, **non già registrato su WhatsApp**
  (consigliato: una nuova SIM o un numero fisso dello studio abilitato a
  ricevere una chiamata di verifica). Il numero che i pazienti vedranno.
- Un account Meta Business dello studio (se non c'è, si crea durante l'onboarding).
- Accesso email/telefono del titolare per le verifiche.

## 1. Creare l'account 360dialog e il canale

1. Registrarsi su https://hub.360dialog.com (piano base, nessun costo di setup).
2. Seguire l'onboarding "Embedded Signup" di Meta: login con l'account Meta
   dello studio, creazione/collegamento del WhatsApp Business Account (WABA),
   registrazione del numero con verifica via SMS o chiamata.
3. A fine procedura il canale appare nello Hub: annotare
   - l'**ID del canale** (visibile nell'URL o nella pagina del canale)
   - generare la **API key** dal pannello: WhatsApp Accounts → il canale →
     "Generate API key". **La chiave si vede una sola volta: copiarla subito.**

## 2. Completare il profilo business (facoltativo ma consigliato)

Nel pannello 360dialog: nome dello studio, foto/logo, indirizzo, orari.
È quello che il paziente vede aprendo la chat.

## 3. Sottomettere i due template a Meta

Nel pannello 360dialog → Templates → "Add template". Categoria **UTILITY**,
lingua **Italian (it)**. I testi vanno incollati ESATTAMENTE così (le variabili
numerate sono obbligatorie in questo formato). I nomi devono essere questi,
perché il software li usa per l'invio.

### Template 1 — nome: `promemoria_48h`

Corpo:

```
Gentile {{1}}, le ricordiamo il suo appuntamento presso {{2}} il giorno {{3}} alle ore {{4}}. Risponda con un pulsante per aiutarci a organizzare l’agenda.
```

Esempi variabili (richiesti da Meta in fase di review):
{{1}} = Mario Rossi · {{2}} = Studio Dentistico Bianchi · {{3}} = 21/07/2026 · {{4}} = 15:30

Pulsanti: tipo **Quick Reply**, due pulsanti:
1. `Confermo`
2. `Devo disdire`

### Template 2 — nome: `promemoria_3h`

Corpo:

```
Gentile {{1}}, le ricordiamo l’appuntamento di oggi alle ore {{2}} presso {{3}}. A più tardi!
```

Esempi: {{1}} = Mario Rossi · {{2}} = 15:30 · {{3}} = Studio Dentistico Bianchi

Pulsanti: stessi due Quick Reply (`Confermo` / `Devo disdire`).

L'approvazione di Meta richiede tipicamente da pochi minuti a 24 ore per la
categoria utility. Stato visibile nel pannello Templates.

> Nota: il messaggio di ringraziamento post-conferma ("Grazie, ti aspettiamo!")
> NON è un template: viene inviato come messaggio libero dentro la finestra di
> 24 ore aperta dalla risposta del paziente, quindi non serve sottometterlo.

## 4. Inserire le credenziali in Confermo

Dashboard → **Impostazioni** → "Canale WhatsApp dello studio":

1. **Numero mittente**: il numero registrato al passo 1 (es. +39 06 1234567).
2. **ID canale**: quello annotato al passo 1.
3. **API key**: incollarla nel campo (write-only: non sarà mai più mostrata,
   solo gli ultimi 4 caratteri per conferma). Salvare.
4. Copiare l'**URL webhook** che compare dopo il salvataggio.

## 5. Configurare il webhook su 360dialog

Nel pannello 360dialog → il canale → Webhook URL: incollare l'URL copiato
(contiene il token segreto dello studio — non condividerlo). In alternativa via
API:

```bash
curl -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
  -H "D360-API-KEY: <API_KEY_DEL_CANALE>" \
  -H "Content-Type: application/json" \
  -d '{"url": "<URL_WEBHOOK_COPIATO>"}'
```

Requisito: l'app deve essere raggiungibile in HTTPS pubblico
(`APP_BASE_URL` nel `.env` di produzione deve essere l'URL pubblico).

## 6. Test e attivazione

1. In Impostazioni → "Invia messaggio di prova": inserire un numero WhatsApp
   reale (es. il cellulare della segretaria) e inviare. Se i template sono
   approvati e la key è giusta, il messaggio arriva in pochi secondi.
2. Rispondere dal telefono premendo un pulsante: la risposta deve comparire
   in dashboard (stato appuntamento o banner "Messaggi da gestire").
3. Solo quando il test funziona: premere **"Attiva canale"**. Da quel momento
   i promemoria dello studio partono dal canale reale invece che dal mock.

## Cosa NON inserire nel sistema

Confermo tratta dati personali comuni (nome, telefono, data e ora), **mai dati
sanitari**. La differenza non è formale: i dati relativi alla salute sono una
categoria particolare (art. 9 GDPR) che richiede basi giuridiche e misure
molto più onerose. Per restare fuori da quella categoria:

- **Nel campo «tipo di appuntamento»**: solo etichette generiche e brevi
  («Controllo», «Prima visita», «Medicazione», «Seduta»). Mai diagnosi,
  patologie, nomi di farmaci, parti del corpo, specializzazioni che rivelino
  una condizione («visita oncologica», «controllo diabetologico»,
  «fisioterapia post-infortunio»). Il campo è limitato a 40 caratteri
  apposta: se non ci sta, quasi sempre è perché contiene troppo.
- **Nei testi dei messaggi**: il tipo di appuntamento non è disponibile tra le
  variabili, e non va aggirato scrivendolo a mano nel template. Il messaggio
  arriva come notifica sul telefono e può leggerlo chiunque abbia il
  dispositivo in mano, anche a schermo bloccato.
- **Nei nomi dei pazienti**: nessuna annotazione tipo «Mario Rossi (protesi)».
- **Da nessuna parte**: referti, allegati, note cliniche, codici fiscali,
  numeri di tessera sanitaria, dati di pagamento. Il sistema non ha campi per
  queste informazioni ed è voluto.

Se lo studio ha bisogno di collegare un appuntamento a informazioni cliniche,
quelle restano nel suo gestionale: qui basta il riferimento generico.

## Cose da sapere

- **Costi**: le conversazioni utility sono a pagamento (tariffa Meta per
  conversazione a cui 360dialog aggiunge il canone mensile del canale).
- **Opt-out**: se un paziente scrive STOP/BASTA, Confermo lo marca
  automaticamente e non gli invia più nulla. La cosa è visibile nella pagina
  Pazienti ("non vuole messaggi").
- **Qualità del numero**: Meta assegna un rating al numero; troppi blocchi da
  parte degli utenti lo abbassano. I promemoria richiesti dal paziente sono a
  basso rischio.
- **GDPR**: firmare il DPA con 360dialog (disponibile nello Hub) e citare
  360dialog/Meta come sub-responsabili nell'informativa dello studio.
- **Rotazione API key**: se la chiave viene rigenerata nel pannello, va
  reincollata in Impostazioni. La vecchia smette di funzionare subito.
