# Attivazione di uno studio — foglio di campo

Da avere sottomano durante la visita. È la versione operativa di
[whatsapp-setup.md](whatsapp-setup.md), che resta il riferimento completo.

**Durata realistica: 45-60 minuti**, più l'attesa per l'approvazione dei
template da parte di Meta (da pochi minuti a 24 ore, non dipende da voi).

> Il canale WhatsApp è intestato **allo studio**, non a te: servono i suoi
> documenti e il suo numero. Tu guidi la procedura, lui mette le credenziali.

---

## Prima della visita — da far preparare allo studio

Manda questa lista qualche giorno prima. Se manca qualcosa la sessione si
interrompe a metà, ed è la cosa più fastidiosa che possa succedere.

- [ ] **Un numero di telefono dedicato**, che non sia già registrato su
      WhatsApp (né normale né Business). Deve poter ricevere una chiamata o un
      SMS di verifica durante la procedura. Va bene una SIM nuova o un numero
      fisso dello studio.
- [ ] **Visura camerale** o Certificato di Registrazione Aziendale, in PDF.
      In alternativa Meta accetta Atto Costitutivo, Statuto, certificato di
      partita IVA o un estratto conto bancario intestato allo studio.
- [ ] **Partita IVA** e denominazione legale esatta, come risulta in visura.
- [ ] **Sito web dello studio**, pubblico e in HTTPS. Se non ce l'hanno,
      segnalalo prima: Meta lo richiede e può rallentare la verifica.
- [ ] **Una email** dello studio a cui accedere durante la sessione.
- [ ] Se hanno già una **pagina Facebook o un Business Manager**, le
      credenziali. Se non ce l'hanno, si crea durante la procedura.

Fai anche una domanda che non è tecnica ma pesa più di tutte:

- [ ] **Che gestionale usano, e cosa sa esportare.** Se non c'è un export
      degli appuntamenti, qualcuno dovrà inserirli due volte. Meglio saperlo
      prima di attivare il canale.

---

## Durante la visita

### 1. Account 360dialog (10 min)

Su **hub.360dialog.com** → registrazione con la email dello studio.
L'account è intestato a loro: la password la scelgono e la conservano loro.

### 2. Collegamento del numero (15 min)

Segui l'Embedded Signup di Meta:
accesso o creazione del Business Manager → creazione del WhatsApp Business
Account → inserimento del numero → verifica via SMS o chiamata.

⚠️ Il codice di verifica arriva sul numero dello studio: assicurati che il
telefono sia lì, in mano a qualcuno, prima di iniziare.

A fine procedura, dal pannello del canale, annota:

- [ ] **ID canale** (visibile nella pagina del canale o nell'URL)
- [ ] **API key** — «Generate API key». **Si vede una volta sola**: copiala
      subito. Se la perdi se ne genera un'altra, ma la vecchia smette di
      funzionare.

### 3. Verifica del business (5 min per avviarla)

Dal pannello, avvia la Partner-led Business Verification e carica la visura.
Poi si aspetta Meta. Si può proseguire con il resto nel frattempo.

### 4. Sottomissione dei due template (10 min)

Pannello 360dialog → Templates → Add template.
Per entrambi: categoria **UTILITY**, lingua **Italian (it)**, due pulsanti di
tipo **Quick Reply**.

I nomi devono essere esattamente questi, il software li cerca così.

**Template 1 — nome: `promemoria_48h`**

```
Gentile {{1}}, le ricordiamo il suo appuntamento presso {{2}} il giorno {{3}} alle ore {{4}}. Risponda con un pulsante per aiutarci a organizzare l'agenda.
```

Esempi da inserire per la review: {{1}} Mario Rossi · {{2}} Studio Dentistico
Bianchi · {{3}} 21/07/2026 · {{4}} 15:30

Pulsanti: `Confermo` e `Devo disdire`

**Template 2 — nome: `promemoria_3h`**

```
Gentile {{1}}, le ricordiamo l'appuntamento di oggi alle ore {{2}} presso {{3}}. A più tardi!
```

Esempi: {{1}} Mario Rossi · {{2}} 15:30 · {{3}} Studio Dentistico Bianchi

Pulsanti: gli stessi due.

### 5. Configurazione in Confermo (5 min)

Dashboard dello studio → **Impostazioni** → «Canale WhatsApp dello studio»:

- [ ] Numero mittente
- [ ] ID canale
- [ ] API key → **Salva impostazioni**
- [ ] Copia l'**URL webhook** che compare dopo il salvataggio

Poi nel pannello 360dialog, alla voce Webhook URL, incolla quell'URL.
Contiene il token segreto dello studio: non va condiviso altrove.

### 6. Prova e attivazione (5 min)

- [ ] Impostazioni → «Invia messaggio di prova» verso il cellulare della
      segretaria (non il tuo: è più convincente se lo vedono arrivare loro)
- [ ] Farle premere **Confermo** sul telefono
- [ ] Verificare che in agenda l'appuntamento diventi verde

Solo se questi tre punti funzionano: **Attiva canale**.

Se i template non sono ancora approvati, la prova fallisce con un errore sul
modello: è normale, si rimanda l'attivazione a quando Meta risponde. Il resto
della configurazione resta salvato.

---

## Prima di andare via

- [ ] **Cambia la password** dell'accesso alla dashboard insieme a loro
      (Impostazioni → Password di accesso) e falla mettere nel loro gestore di
      password, non su un post-it.
- [ ] **Consegna il modulo di consenso** ([modulo-consenso-pazienti.md](modulo-consenso-pazienti.md))
      e spiega che senza firma il sistema non manda niente a quel paziente.
- [ ] **Controlla la fascia oraria di silenzio** (Impostazioni): il valore
      predefinito 21:00–08:00 va bene quasi sempre, ma se lo studio apre alle
      7:30 va spostata.
- [ ] **Verifica le tipologie di appuntamento** e ricorda la regola: etichette
      generiche, mai diagnosi. È il punto su cui uno studio medico si gioca la
      conformità.
- [ ] **Concorda come entrano gli appuntamenti**: inserimento manuale o import
      CSV, e chi lo fa ogni mattina. Se questo punto resta vago, fra tre
      settimane il sistema è vuoto.

---

## Se qualcosa va storto

**Il numero risulta già registrato su WhatsApp.** Va prima cancellato
dall'account WhatsApp esistente, e la cancellazione richiede tempo. È il
motivo per cui conviene una SIM nuova.

**La verifica del business viene rifiutata.** Di solito il nome legale non
coincide esattamente con quello in visura, oppure il documento è scaduto. Si
ricarica e si riprova.

**Il template viene rifiutato.** Meta motiva sempre il rifiuto. Le cause
tipiche sono categoria sbagliata (deve essere UTILITY, non MARKETING) o
esempi delle variabili mancanti. Si corregge e si risottomette.

**L'invio di prova dà «Template rifiutato» o «numero non su WhatsApp».**
Il sistema distingue i due casi e li mostra nella card dell'appuntamento. Il
secondo significa che il destinatario non ha WhatsApp su quel numero.

**Qualsiasi altro errore:** annota il messaggio esatto e sentiamoci — il
provider 360dialog non ha mai fatto una chiamata reale prima di questo studio,
quindi è possibile che serva un aggiustamento nel codice.
