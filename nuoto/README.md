# Nuoto: generatore di sedute

App statica (HTML + JS, nessuna dipendenza, nessun servizio esterno). Apri `index.html` nel browser,
anche da file locale o da GitHub Pages. I dati restano in `localStorage`; da Impostazioni puoi esportare o importare il backup JSON.

- `generator.js`: tutta la logica. La funzione pura `generaSeduta(profilo, input, storico)`, più
  `rigeneraBlocco`, `ricalcola` e `validaSeduta`. Profili, volumi, quote per focus, moltiplicatori di passo
  e date dei test sono in cima al file (`CONFIG`, `PROFILI`).
- `app.js`: interfaccia (genera, seduta con spunte/tempi/modifica, registro, impostazioni).
- `generator.test.js`: test, da lanciare con `node nuoto/generator.test.js`.

Regole principali: vasca da 25 m, 7 blocchi, stima dei tempi dal test più recente con ~4' di transizioni.
Palette no → pull + nuoto normale o pugni chiusi. Progressione dalle ultime 3 sedute
(+2×50 m / -5" ogni 2 settimane per Emanuele, +50 m ogni 3 settimane con soste fisse a 20" per Beatrice).
Test nelle settimane 4/8/12 dal 28/10/2026.

**Sedute inserite a mano** (Registro → "Aggiungi seduta già fatta", `creaSedutaManuale`): contano per progressione
(fatica, completata sì/no), passo (se c'è il tempo del test) e settimane di test.

**Riflessioni** (opzionali, a fine seduta o dal Registro, `analizzaRiflessioni`): nelle riflessioni degli ultimi 10 giorni
il generatore cerca fastidi a spalla, gambe/crampi, ginocchio, schiena/collo e difficoltà di respiro (ignorando frasi negate
come "nessun dolore") e adatta la seduta: niente palette e pull ridotto, gambe dimezzate, niente rana/farfalla,
respirazione graduale, esercizi a secco esclusi. Ogni adattamento è spiegato nelle note della seduta.

## Installarla sul telefono

È una PWA: si installa dal browser e funziona anche offline.

1. Pubblica il repository con GitHub Pages (Settings → Pages → Deploy from a branch, cartella `/ (root)`).
2. Apri `https://emanuele23698.github.io/sitemap/nuoto/` sul telefono.
3. iPhone (Safari): Condividi → "Aggiungi alla schermata Home". Android (Chrome): menu ⋮ → "Installa app".

Dopo una modifica ai file, aumenta `VERSIONE` in `sw.js` così il telefono scarica la nuova versione.
