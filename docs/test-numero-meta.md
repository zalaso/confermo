# Collaudare l'integrazione WhatsApp senza uno studio reale

Meta assegna a ogni sviluppatore un **numero di test gratuito**, senza verifica
aziendale e senza partita IVA. Serve per provare l'intera catena — invio dei
template, pulsanti, risposte in arrivo, ringraziamento — **prima** di attivare
un canale su uno studio vero, così il primo contatto con un cliente non è anche
il primo collaudo.

Il provider `meta` in Confermo parla direttamente con la Cloud API di Meta.
Poiché 360dialog è solo un proxy sopra la stessa API, quello che funziona qui
funziona anche in produzione con 360dialog: cambiano l'URL e il tipo di
credenziale, non il resto.

> **Limiti del numero di test.** Meta permette di scrivere solo a un massimo di
> 5 numeri che aggiungi come destinatari (il tuo cellulare, quello di un
> collega...), e non serve verifica per usarlo. È pensato per lo sviluppo, non
> per la produzione: per uno studio reale serve comunque un numero verificato,
> con 360dialog o con Meta in versione completa.

---

## 1. Creare l'app su Meta for Developers

1. Vai su **developers.facebook.com** e accedi con un account Facebook.
2. **My Apps → Create App → Other → Business**.
3. Nella dashboard dell'app, **Add product → WhatsApp → Set up**.
4. Meta crea in automatico un **account WhatsApp di test** e un **numero di
   test**. Li trovi in **WhatsApp → API Setup**.

## 2. Annotare le credenziali

Sempre in **WhatsApp → API Setup**:

- [ ] **Phone number ID** — l'identificativo del numero di test (NON il numero
      in sé). È la stringa numerica sotto "From".
- [ ] **Access token** — il token temporaneo mostrato in alto. Dura 24 ore:
      per i test va bene, per un uso prolungato si genera un token permanente
      (System User) da Business Settings.
- [ ] **Destinatari di prova**: nella stessa pagina, alla voce "To", aggiungi e
      verifica i numeri a cui potrai scrivere (max 5). Ricevono un codice via
      WhatsApp da confermare.

## 3. I template

Sul numero di test puoi inviare da subito i **template di esempio** già
approvati da Meta (es. `hello_world`), utili per verificare il trasporto.

Per provare i template veri di Confermo (`promemoria_48h`, `promemoria_3h`) vai
in **WhatsApp Manager → Message templates → Create template** e inseriscili come
descritto in [whatsapp-setup.md](whatsapp-setup.md) (categoria UTILITY, lingua
it, due pulsanti quick-reply). L'approvazione richiede in genere pochi minuti.

> Se l'account di test non permette di sottomettere template personalizzati, lo
> scopri qui — prima di andare da un cliente — e nel frattempo il trasporto
> resta collaudabile con i template di esempio.

## 4. Configurare Confermo

Crea uno studio **non** in modalità demo (o togli la modalità demo a quello di
prova), poi dalla dashboard → **Impostazioni → Canale WhatsApp**:

- [ ] Provider: **Meta Cloud API (diretto)**
- [ ] Numero mittente: il numero di test
- [ ] **Phone number ID**: quello annotato al passo 2
- [ ] **Access token**: quello annotato al passo 2 → **Salva**
- [ ] Copia l'**URL webhook** e il **verify token** che compaiono

## 5. Collegare il webhook

L'app deve essere raggiungibile in HTTPS pubblico (`APP_BASE_URL`). Se stai
provando in locale, esponi la porta con un tunnel (es. `cloudflared tunnel` o
`ngrok http 3001`) e imposta temporaneamente quell'URL come `APP_BASE_URL`.

Nella dashboard dell'app Meta → **WhatsApp → Configuration → Webhook**:

- [ ] **Callback URL**: incolla l'URL **completo, compresa la parte `?token=...`**
      (verificato sul campo: Meta conserva la query string anche nelle POST, e
      il nostro webhook autentica proprio con quel token)
- [ ] **Verify token**: solo il valore dopo `token=`
- [ ] Salva: Meta chiama l'URL in GET, Confermo risponde con il challenge e la
      verifica passa.
- [ ] Alla voce **Webhook fields**, iscriviti a **messages**. Senza questa
      spunta Meta verifica l'URL e poi non inoltra nulla: sembra un guasto del
      software, invece è solo la sottoscrizione mancante.

## 5-bis. Iscrivere l'app all'account WhatsApp — IL PASSAGGIO INVISIBILE

**Salta questo e i messaggi in arrivo non arriveranno mai**, pur avendo tutte le
pagine di configurazione in ordine e il pulsante "Test" funzionante.

Il motivo: l'account WhatsApp deve essere iscritto **alla tua app**. Di
serie è iscritto a un'app interna di Meta (`WA DevX Webhook Events 1P App`),
quella che alimenta la schermata di prova della console — e i messaggi vanno
lì, non a te. Questa iscrizione non compare in nessuna pagina di
configurazione: si vede e si cambia solo via API.

Su **developers.facebook.com/tools/explorer** (Strumenti → Graph API Explorer):

- [ ] In alto a destra seleziona la **tua app**, e genera un token di accesso
      con `whatsapp_business_management`. È il punto critico: la chiamata iscrive
      *l'app del token che stai usando*, quindi con l'app sbagliata selezionata
      iscriveresti quella sbagliata.
- [ ] Metodo **GET** su `<WABA_ID>/subscribed_apps` per vedere lo stato attuale
      (il WABA_ID è il "WhatsApp Business Account ID" accanto al Phone number ID)
- [ ] Se la tua app non è nell'elenco: metodo **POST** sullo stesso indirizzo →
      deve rispondere `{"success": true}`
- [ ] Rifai il **GET**: ora devono comparire due app, la tua e quella di Meta.
      Convivono senza problemi.

Questo passaggio non serve con 360dialog: là è il BSP a gestire l'iscrizione.

## 6. Prova completa

- [ ] Impostazioni → **Attiva canale** → **Invia messaggio di prova** verso uno
      dei numeri di test.
- [ ] Sul telefono, premi **Confermo**: la risposta deve tornare a Confermo (lo
      vedi nella card dell'appuntamento che diventa verde, o nel registro
      eventi).
- [ ] Prova anche **Devo disdire** e un messaggio di testo libero: devono
      comparire nel riquadro "Messaggi da gestire".

Se qualcosa non torna — un codice di errore inatteso, una risposta che non
arriva — annota il messaggio esatto: è proprio ciò che questo collaudo serve a
far emergere, e si sistema nel codice del provider `meta` (o nella logica
condivisa in `cloud-api.ts`) prima di toccare uno studio reale.

---

## Errori incontrati davvero, e come si riconoscono

Raccolti durante il primo collaudo (30/07/2026), superato con successo.

**`(#132001) Template name does not exist in the translation`**
Nome o lingua del template non combaciano con quello che il codice invia.
Nel nostro caso era un refuso nel nome (`promemroia_48h`). Da sapere: i nomi
sono **case-sensitive** e **immutabili** — non si rinominano, va creato un
template nuovo ed eliminato quello sbagliato. Altre cause dello stesso errore:
lingua diversa da `it`, oppure template creato su un account WhatsApp diverso
da quello del numero che sta inviando.

**Il messaggio parte, ma premendo il pulsante non accade nulla**
Quasi sempre è l'iscrizione dell'app all'account WhatsApp (passo 5-bis).
Come distinguere in un colpo: scrivi un messaggio libero dal telefono al numero
di test e guarda il riquadro "Messaggi da gestire" in dashboard.
- non compare nulla → l'iscrizione manca, oppure il webhook non riceve
- compare **col nome del paziente** → tutto in ordine sul riconoscimento
- compare **solo col numero mascherato** → il numero del paziente in archivio
  non corrisponde a quello da cui scrive

**Credenziali non valide dopo un giorno**
L'access token di test di Meta scade in **24 ore**. Si rigenera dalla pagina
"Passaggio 1. Prova" e si reincolla in Impostazioni.

**Nessun errore nei log ma niente arriva**
Cerca nei log una riga qualsiasi con `webhook`, non solo gli errori: la
differenza fra "nessuna richiesta" (Meta non ci ha chiamato → iscrizione) e
"richiesta con esito 200" (ci ha chiamato ma il payload non è stato
interpretato → problema di codice) indirizza tutta la diagnosi.
