# Lista d'attesa: riassegnare gli slot liberati

**Etichette:** `enhancement`, `da-valutare`
**Stima:** 3-4 giorni · **da non iniziare prima di aver misurato** (vedi in fondo)

## Il problema

Quando un paziente disdice, lo slot liberato compare fra i «messaggi da gestire»
e qualcuno deve decidere chi chiamare. Il valore del preavviso — il motivo per
cui Confermo chiede una risposta invece di limitarsi ad avvisare — si realizza
solo se quel posto viene davvero riempito.

Oggi la parte finale è tutta manuale: la segretaria guarda l'agenda, pensa a chi
potrebbe volerlo, telefona.

## Approccio

1. **Disponibilità sul paziente.** Un campo che indica che il paziente accetta di
   essere avvisato di posti liberi anticipati, con eventuali preferenze minime
   (mattina / pomeriggio). Richiede un **consenso a parte**: è una comunicazione
   diversa dal promemoria di un appuntamento già fissato, e il modulo firmato
   parla solo di promemoria.
2. **All'evento di disdetta**, cercare i candidati: pazienti disponibili, con
   consenso valido, non in opt-out, con un appuntamento futuro compatibile o
   in attesa di essere fissato.
3. **Proporre a uno per volta**, non a tutti insieme: un messaggio con il posto
   libero e un pulsante «Lo prendo», con una finestra di risposta (per esempio
   30 minuti) prima di passare al successivo. Proporlo a dieci persone
   contemporaneamente significa nove pazienti delusi e una corsa al primo che
   risponde.
4. **Assegnazione atomica**: il primo che accetta prende lo slot, gli altri
   ricevono un messaggio di chiusura. Serve lo stesso rigore usato per l'unicità
   degli invii, altrimenti due pazienti si presentano alla stessa ora.
5. **Nuovo modello di messaggio** da far approvare da Meta, con il pulsante.

## Criteri di accettazione

- [ ] Un paziente entra in lista d'attesa solo con un consenso esplicito
- [ ] Alla disdetta parte una proposta al primo candidato compatibile
- [ ] Se non risponde entro la finestra, si passa al successivo
- [ ] Due pazienti non possono prendere lo stesso slot, in nessuna condizione di
      concorrenza
- [ ] Chi accetta riceve la conferma e trova l'appuntamento in agenda
- [ ] La segreteria può disattivare del tutto la funzione
- [ ] L'opt-out (STOP) esclude anche dalle proposte di lista d'attesa

## File coinvolti

- `apps/api/src/services/replies.ts` — il punto in cui una disdetta viene
  registrata è dove innescare la ricerca
- `apps/api/src/messaging/templates.ts` — nuovo modello
- `apps/api/prisma/schema.prisma` — disponibilità e stato delle proposte

## Perché non farla adesso

È la funzione con il valore percepito più alto, ed è la prima che verrà in mente
quando la si mostrerà a uno studio. Ma va costruita **dopo** che un pilota reale
ha dimostrato che le disdette anticipate arrivano davvero e in quale quantità.

Se in un mese di uso reale le disdette anticipate sono tre, automatizzare la
riassegnazione è ottimizzare un problema che non esiste; se sono trenta,
diventa la funzione più importante del prodotto. Il dato lo danno le statistiche
già presenti — `remindersCancelRequested` conta esattamente questo.

Rivalutare dopo **un mese di dati reali** dal primo studio.
