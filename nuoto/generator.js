/*
 * generator.js — generatore di sedute (vasca e secco) basato su regole.
 *
 * Funzione principale, pura e deterministica:
 *   generaSeduta(profilo, input, storico) -> seduta
 *
 * - profilo: uno dei PROFILI qui sotto (o un oggetto con la stessa forma)
 * - input:   { data:'YYYY-MM-DD', durata:30|45|60, tipo:'vasca'|'secco', energia:1..5,
 *              attrezzi:{ pullBuoy, tavoletta, palette }, focus:'tecnica'|'resistenza'|'respirazione'|'misto',
 *              seed?:number }
 * - storico: array di sedute salvate nel Registro (stato 'completata', con fatica e blocchi spuntati)
 *
 * Nessuna dipendenza, nessun servizio esterno, nessun accesso a Date.now()/Math.random():
 * stessa entrata -> stessa seduta. Per avere una variante diversa basta cambiare input.seed.
 *
 * Funziona sia nel browser (window.Generatore) sia in Node (require('./generator.js')).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Generatore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configurazione generale (modificabile)
  // ---------------------------------------------------------------------------
  var CONFIG = {
    dataPartenza: '2026-10-28',
    settimaneTest: [4, 8, 12],
    transizioniSec: 240, // ~4 minuti tra blocchi, docce, spostamenti
    vasca: 25,
    fattoreEnergia: { 1: 0.8, 2: 0.9, 3: 1, 4: 1, 5: 1.05 },
    // moltiplicatori sul passo di riferimento (1 = passo del test)
    passoBlocco: {
      riscaldamento: 1.08, base: 1.0, test: 0.97, pull: 1.0, gambe: 1.4,
      respirazione: 1.05, veloce: 0.9, defaticamento: 1.12
    },
    // ripartizione del volume per focus
    quote: {
      misto:        { riscaldamento: .15, base: .30, pull: .16, gambe: .10, respirazione: .12, veloce: .08, defaticamento: .09 },
      tecnica:      { riscaldamento: .15, base: .26, pull: .16, gambe: .10, respirazione: .12, veloce: .12, defaticamento: .09 },
      resistenza:   { riscaldamento: .15, base: .36, pull: .16, gambe: .10, respirazione: .08, veloce: .07, defaticamento: .08 },
      respirazione: { riscaldamento: .15, base: .26, pull: .16, gambe: .10, respirazione: .18, veloce: .07, defaticamento: .08 }
    },
    ordineBlocchi: ['riscaldamento', 'base', 'pull', 'gambe', 'respirazione', 'veloce', 'defaticamento'],
    // ordine in cui si accorcia la seduta se non entra nel tempo
    ordineRiduzione: ['pull', 'respirazione', 'base', 'riscaldamento', 'gambe', 'defaticamento', 'veloce']
  };

  // ---------------------------------------------------------------------------
  // Profili
  // ---------------------------------------------------------------------------
  var PROFILI = {
    emanuele: {
      id: 'emanuele',
      nome: 'Emanuele',
      // test iniziale: 400 m in 9:00 (≈ 2:15/100 m)
      test: { distanza: 400, tempoSec: 540, soste: false, data: '2026-10-28' },
      volumi: { 30: 950, 45: 1500, 60: 2100 },
      recuperoBase: 20,     // recupero base (s)
      recuperoMin: 10,      // la progressione non scende sotto
      quotaBaseMax: 1,      // nessun limite sul blocco base
      intervalloProgressione: 14, // giorni minimi tra due aumenti
      passoProgressioneMetri: 100, // +2×50 m
      riduzioneRecupero: 5,        // -5"
      alternaFocus: true,          // focus "misto": ruota resistenza/tecnica/respirazione
      finaliTecnici: ['crawl', 'rana', 'farfalla'],
      livelloSecco: 0
    },
    beatrice: {
      id: 'beatrice',
      nome: 'Beatrice',
      // test iniziale: 200 m in 8:00 con soste
      test: { distanza: 200, tempoSec: 480, soste: true, data: '2026-10-28' },
      volumi: { 30: 600, 45: 900, 60: 1250 },
      recuperoBase: 20,
      recuperoMin: 20,      // soste al muro solo 20": il recupero non si riduce
      quotaBaseMax: 0.2,    // fatica nel blocco base: tienilo corto
      intervalloProgressione: 21, // progressione più lenta
      passoProgressioneMetri: 50,
      riduzioneRecupero: 0,
      alternaFocus: false,
      finaliTecnici: ['crawl'],
      livelloSecco: -1
    }
  };

  // ---------------------------------------------------------------------------
  // Utilità
  // ---------------------------------------------------------------------------
  function rngDa(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function scegli(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function arrotonda(m, passo) { passo = passo || 25; return Math.max(passo, Math.round(m / passo) * passo); }
  function ripeti(n, d) { var a = []; for (var i = 0; i < n; i++) a.push(d); return a; }
  function somma(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function clona(o) { return JSON.parse(JSON.stringify(o)); }

  function giorniTra(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  function settimanaDi(data) {
    return Math.floor(giorniTra(CONFIG.dataPartenza, data) / 7) + 1;
  }
  function formattaTempo(sec) {
    sec = Math.round(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /** "9:00", "9.00", "9'00", "540" -> secondi; null se non valido */
  function leggiTempo(str) {
    if (str == null) return null;
    var t = String(str).trim().replace(/["”]/g, '');
    if (!t) return null;
    var m = t.match(/^(\d{1,2})\s*[:.'’]\s*(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    if (/^\d+$/.test(t)) return Number(t);
    return null;
  }
  /** [50,50,50,50] -> "4×50"; [25,50,75,50,25] -> "25-50-75-50-25"; [200,50,50] -> "200 + 2×50" */
  function formattaSerie(serie) {
    if (!serie || !serie.length) return '';
    var gruppi = [];
    serie.forEach(function (d) {
      var g = gruppi[gruppi.length - 1];
      if (g && g.d === d) g.n++; else gruppi.push({ d: d, n: 1 });
    });
    if (gruppi.length > 1 && gruppi.every(function (g) { return g.n === 1; })) return serie.join('-');
    return gruppi.map(function (g) { return g.n > 1 ? g.n + '×' + g.d : String(g.d); }).join(' + ');
  }
  /** "4x50", "4×50 + 2x25", "25-50-75-50-25", "400" -> array di distanze; null se non valido */
  function leggiSerie(str) {
    if (str == null) return null;
    var parti = String(str).split('+'), out = [];
    for (var i = 0; i < parti.length; i++) {
      var p = parti[i].trim();
      if (!p) return null;
      var m = p.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
      if (m) {
        var n = Number(m[1]), d = Number(m[2]);
        if (!n || !d || n > 100) return null;
        out = out.concat(ripeti(n, d));
        continue;
      }
      var nums = p.split(/[-,\s]+/).filter(Boolean);
      for (var j = 0; j < nums.length; j++) {
        if (!/^\d+$/.test(nums[j]) || Number(nums[j]) <= 0) return null;
        out.push(Number(nums[j]));
      }
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------------------
  // Storico: passo di riferimento e progressione
  // ---------------------------------------------------------------------------
  function storicoProfilo(profilo, storico, data) {
    return (storico || [])
      .filter(function (s) {
        return s && s.profiloId === profilo.id && s.stato === 'completata' && (!data || s.data <= data);
      })
      .sort(function (a, b) {
        if (a.data !== b.data) return a.data < b.data ? 1 : -1;
        return (b.completataIl || '') > (a.completataIl || '') ? 1 : -1;
      });
  }

  function passoDaTest(distanza, tempoSec, soste) {
    // se il test è stato fatto con soste, il passo "pulito" è circa il 10% più veloce
    return (tempoSec / distanza) * 100 * (soste ? 0.9 : 1);
  }

  /** Passo di riferimento (s/100 m) dal test più recente nel registro, altrimenti dal test del profilo. */
  function passoRiferimento(profilo, storico, data) {
    var sedute = storicoProfilo(profilo, storico, data);
    for (var i = 0; i < sedute.length; i++) {
      var blocchi = sedute[i].blocchi || [];
      for (var j = 0; j < blocchi.length; j++) {
        var b = blocchi[j];
        if (b.tipo === 'test' && b.completato && b.tempoSec > 0) {
          var dist = somma(b.serie || []) || profilo.test.distanza;
          return {
            sec100: passoDaTest(dist, b.tempoSec, !!profilo.test.soste),
            fonte: 'Test ' + dist + ' m del ' + sedute[i].data + ' (' + formattaTempo(b.tempoSec) + ')',
            testSec: b.tempoSec
          };
        }
      }
    }
    return {
      sec100: passoDaTest(profilo.test.distanza, profilo.test.tempoSec, profilo.test.soste),
      fonte: 'Test iniziale ' + profilo.test.distanza + ' m (' + formattaTempo(profilo.test.tempoSec) +
        (profilo.test.soste ? ', con soste' : '') + ')',
      testSec: profilo.test.tempoSec
    };
  }

  function bloccoSaltato(s) {
    return (s.blocchi || []).some(function (b) { return !b.completato; });
  }

  /**
   * Livello di progressione per la prossima seduta in vasca.
   * Livello L => +ceil(L/2) × passoProgressioneMetri sul blocco base e -floor(L/2) × riduzioneRecupero.
   */
  function calcolaProgressione(profilo, storico, data) {
    var prec = storicoProfilo(profilo, storico, data).filter(function (s) { return s.tipo === 'vasca'; });
    if (!prec.length) {
      return { livello: 0, ultimoAumento: data, azione: 'inizio', motivo: 'Prima seduta registrata: livello di partenza.' };
    }
    var rif = prec[0].progressione || {};
    var livello = rif.livello || 0;
    var ultimoAumento = rif.ultimoAumento || prec[prec.length - 1].data;
    var ultime = prec.slice(0, 3);

    var difficili = ultime.filter(function (s) { return (s.fatica || 0) >= 4 || bloccoSaltato(s); });
    if (difficili.length) {
      var ultima = prec[0];
      var duraUltima = (ultima.fatica || 0) >= 4 || bloccoSaltato(ultima);
      var dueDure = ultime.slice(0, 2).length === 2 && ultime.slice(0, 2).every(function (s) {
        return (s.fatica || 0) >= 4 || bloccoSaltato(s);
      });
      if (dueDure || (ultima.fatica || 0) >= 5) {
        return {
          livello: Math.max(-2, livello - 1), ultimoAumento: ultimoAumento, azione: 'riduci',
          motivo: 'Ultime sedute pesanti (fatica alta o blocchi saltati): riduco un po\'.'
        };
      }
      return {
        livello: livello, ultimoAumento: ultimoAumento, azione: 'mantieni',
        motivo: duraUltima ? 'Ultima seduta pesante: mantengo il carico.' :
          'Una delle ultime sedute è stata pesante: mantengo il carico.'
      };
    }
    if (ultime.length < 2) {
      return { livello: livello, ultimoAumento: ultimoAumento, azione: 'mantieni', motivo: 'Servono almeno 2 sedute per valutare un aumento.' };
    }
    var giorni = giorniTra(ultimoAumento, data);
    if (giorni >= profilo.intervalloProgressione) {
      return {
        livello: livello + 1, ultimoAumento: data, azione: 'aumenta',
        motivo: 'Fatica ≤3 e tutto completato nelle ultime sedute: aumento.'
      };
    }
    return {
      livello: livello, ultimoAumento: ultimoAumento, azione: 'mantieni',
      motivo: 'Sedute ok: prossimo aumento tra ' + (profilo.intervalloProgressione - giorni) + ' giorni.'
    };
  }

  function testDovuto(profilo, storico, data) {
    var sett = settimanaDi(data);
    if (CONFIG.settimaneTest.indexOf(sett) < 0) return false;
    return !storicoProfilo(profilo, storico, data).some(function (s) {
      return settimanaDi(s.data) === sett && (s.blocchi || []).some(function (b) { return b.tipo === 'test' && b.completato; });
    });
  }

  // ---------------------------------------------------------------------------
  // Costruttori dei blocchi in vasca: (ctx, budgetMetri, rng) -> blocco
  // ---------------------------------------------------------------------------
  function n50(budget, min) { return Math.max(min || 2, Math.round(budget / 50)); }

  var DRILL = [
    { nome: 'catch-up', nota: 'La mano aspetta l\'altra davanti: allunga e senti lo scivolamento.' },
    { nome: '6 battute - 1 bracciata', nota: 'Sul fianco per 6 battute, poi una bracciata e cambi lato. Testa ferma.' },
    { nome: 'zip (pollice lungo il fianco)', nota: 'Gomito alto nel recupero: il pollice "chiude la zip" dal fianco all\'ascella.' },
    { nome: 'sculling avanti', nota: 'Braccia tese avanti, piccoli "8" con le mani: senti l\'appoggio sull\'acqua.' },
    { nome: 'bracciata singola (un braccio)', nota: 'Un braccio fermo avanti, l\'altro lavora. Respira dal lato che lavora.' }
  ];

  var COSTRUTTORI = {
    riscaldamento: function (ctx, budget, rng) {
      var tot = arrotonda(budget, 50);
      var varianti = [
        function () { return { serie: ripeti(tot / 50, 50), rec: 10, descrizione: '50 stile libero / 50 dorso alternati, ritmo facile.' }; },
        function () { return { serie: [tot], rec: 0, descrizione: 'Nuoto continuo facile: ogni 4 vasche una a dorso.' }; }
      ];
      if (tot >= 200 && tot % 100 === 0) {
        varianti.push(function () { return { serie: ripeti(tot / 100, 100), rec: 15, descrizione: '100 progressivi: ogni 100 un po\' più lungo e sciolto.' }; });
      }
      var v = scegli(rng, varianti)();
      v.titolo = 'Riscaldamento';
      v.nota = 'Respira con calma, allunga la bracciata. Nessuna fretta.';
      return v;
    },

    base: function (ctx, budget, rng) {
      var p = ctx.profilo, rec = ctx.recuperoBase;
      if (p.quotaBaseMax < 1) {
        // Base corta e variabile (Beatrice)
        var schemi = [
          [25, 50, 25], [25, 50, 75, 50, 25], [25, 50, 75, 100, 75, 50, 25],
          [50, 25, 50, 25], [50, 25, 50, 25, 50, 25], [50, 50, 25, 25, 50, 50],
          [50, 50, 50, 50], [50, 50, 50, 50, 50, 50]
        ];
        var adatti = schemi.filter(function (s) { return somma(s) <= budget * 1.15; });
        if (!adatti.length) adatti = [[25, 50, 25]];
        var migliori = adatti.filter(function (s) { return somma(s) >= budget * 0.75; });
        var serie = scegli(rng, migliori.length ? migliori : adatti).slice();
        return {
          titolo: 'Base', serie: serie, rec: rec,
          descrizione: 'Stile libero, tratti brevi e variati. Soste al muro solo ' + rec + '".',
          nota: 'Se la vasca diventa pesante rallenta, ma arriva al muro. Ritmo ~' +
            formattaTempo(ctx.passo / 2) + '/50.'
        };
      }
      var stile = ctx.stileBase;
      if (stile === 'tecnica') {
        var drill = scegli(rng, DRILL);
        return {
          titolo: 'Base tecnica', serie: ripeti(n50(budget, 4), 50), rec: rec, passoMult: 1.15,
          descrizione: '25 ' + drill.nome + ' + 25 nuoto completo.',
          nota: drill.nota
        };
      }
      if (stile === 'respirazione') {
        var n = Math.max(2, Math.round(budget / 100));
        return {
          titolo: 'Base', serie: ripeti(n, 100), rec: rec,
          descrizione: 'Crawl con respirazione bilaterale ogni 3 bracciate.',
          nota: 'Target ~' + formattaTempo(ctx.passo * 1.03) + ' per 100. Espira tutto in acqua prima di girare la testa.'
        };
      }
      // resistenza
      var d = budget >= 800 && rng() < 0.5 ? 200 : 100;
      var reps = Math.max(2, Math.round(budget / d));
      var negativo = rng() < 0.4;
      return {
        titolo: 'Base', serie: ripeti(reps, d), rec: rec,
        descrizione: negativo ? 'Crawl in negative split: seconda metà di ogni ' + d + ' più veloce.' :
          'Crawl a ritmo costante.',
        nota: 'Target ~' + formattaTempo(d / 100 * ctx.passo) + ' per ' + d + ' m. Conta le bracciate per vasca e tienile uguali.'
      };
    },

    test: function (ctx) {
      var p = ctx.profilo, t = p.test;
      return {
        titolo: 'Test ' + t.distanza + ' m', serie: [t.distanza], rec: 0, test: true, fisso: true,
        descrizione: t.soste ?
          'Stile libero a tempo. Soste brevi permesse (max 20"), annota quante.' :
          'Crawl a tempo, partenza dal muro, ritmo costante: primi 100 controllati.',
        nota: 'Riferimento attuale: ' + formattaTempo(ctx.passoInfo.testSec) +
          '. Inserisci il tempo finale (mm:ss): aggiorna il passo di riferimento.'
      };
    },

    pull: function (ctx, budget, rng) {
      var a = ctx.attrezzi;
      if (a.palette && a.pullBuoy) {
        var d = budget >= 300 ? 100 : 50;
        return {
          titolo: 'Pull', serie: ripeti(Math.max(2, Math.round(budget / d)), d), rec: ctx.recupero(15), passoMult: 0.97,
          descrizione: 'Pull buoy + palette, trazione lunga.', attrezzi: ['pull buoy', 'palette'],
          nota: 'Spingi l\'acqua fino alla coscia; entra con la punta delle dita, non col palmo piatto.'
        };
      }
      if (a.palette) {
        return {
          titolo: 'Pull', serie: ripeti(n50(budget), 50), rec: ctx.recupero(15),
          descrizione: 'Palette, nuoto completo con gambe leggere.', attrezzi: ['palette'],
          nota: 'Sentire la presa: gomito alto, mano sotto il corpo.'
        };
      }
      var varianti = [];
      if (a.pullBuoy) {
        varianti.push(function () {
          var n = n50(budget); if (n % 2) n++;
          return {
            titolo: 'Pull', serie: ripeti(n, 50), rec: ctx.recupero(15),
            descrizione: 'Alterna 50 con pull buoy / 50 nuoto normale.', attrezzi: ['pull buoy'],
            nota: 'Palette non usate: blocco sostituito con pull + nuoto normale. Nel 50 normale mantieni la stessa trazione.'
          };
        });
      }
      varianti.push(function () {
        return {
          titolo: 'Pugni chiusi', serie: ripeti(n50(budget), 50), rec: ctx.recupero(15), passoMult: 1.05,
          descrizione: '25 pugni chiusi + 25 mano aperta.',
          nota: 'Palette non usate: blocco sostituito con pugni chiusi. Senti l\'avambraccio che spinge, poi la mano aperta "pesa" di più.'
        };
      });
      return scegli(rng, varianti)();
    },

    gambe: function (ctx, budget, rng) {
      var n = n50(budget);
      var varianti = ctx.attrezzi.tavoletta ? [
        { descrizione: 'Gambe crawl con tavoletta.', nota: 'Battuta dall\'anca, caviglie morbide, piedi appena sotto la superficie.' },
        { descrizione: 'Gambe con tavoletta: 25 ampie e lente + 25 strette e veloci.', nota: 'Ginocchia quasi tese, spinta dall\'anca.' }
      ] : [
        { descrizione: 'Gambe sul fianco, braccio basso avanti, cambio lato ogni 25.', nota: 'Orecchio sul braccio, guarda il fondo: corpo allineato.' },
        { descrizione: 'Gambe dorso, braccia lungo i fianchi.', nota: 'Bacino alto, ginocchia sotto la superficie.' },
        { descrizione: 'Gambe in streamline, braccia tese sopra la testa.', nota: 'Respira sollevando poco la testa; addome attivo.' }
      ];
      var v = scegli(rng, varianti);
      return {
        titolo: 'Gambe', serie: ripeti(n, 50), rec: ctx.recupero(15),
        descrizione: v.descrizione, nota: v.nota, attrezzi: ctx.attrezzi.tavoletta ? ['tavoletta'] : []
      };
    },

    respirazione: function (ctx, budget, rng) {
      var n = n50(budget);
      var beatrice = ctx.profilo.quotaBaseMax < 1;
      var varianti = beatrice ? [
        { descrizione: 'Respiro ogni 3 bracciate (bilaterale).', nota: 'Espira tutto sott\'acqua con calma, poi gira la testa insieme alla spalla.' },
        { descrizione: '25 respiro ogni 2 sul lato debole + 25 ogni 3.', nota: 'Un occhio sotto e uno sopra l\'acqua quando respiri.' }
      ] : [
        { descrizione: 'Respiro 3-5-7: una vasca per schema, poi ricomincia.', nota: 'Espira lentamente e in modo continuo; se ogni 7 è troppo, torna a 5.' },
        { descrizione: 'Ipossica: respiro ogni 5 all\'andata, ogni 3 al ritorno.', nota: 'Bracciata lunga e rilassata, non accelerare per "arrivare".' },
        { descrizione: 'Bilaterale ogni 3, nota il lato più difficile.', nota: 'Testa ferma, ruota con il corpo; bocca appena fuori dall\'acqua.' }
      ];
      if (ctx.attrezzi.tavoletta) {
        varianti.push({
          descrizione: 'Gambe con tavoletta, viso in acqua: bolle continue, respiro laterale ogni 6 battute.',
          nota: 'Esercizio di controllo dell\'espirazione: niente apnea a polmoni pieni.', passoMult: 1.35
        });
      }
      var v = scegli(rng, varianti);
      return {
        titolo: 'Respirazione', serie: ripeti(n, 50), rec: 20, passoMult: v.passoMult,
        descrizione: v.descrizione, nota: v.nota
      };
    },

    veloce: function (ctx, budget) {
      var n = Math.max(4, Math.round(budget / 25));
      var stile = ctx.stileFinale;
      if (stile === 'rana') {
        return {
          titolo: 'Finale: rana tecnica', serie: ripeti(n, 25), rec: 20, passoMult: 1.15,
          descrizione: 'Rana tecnica: bracciata, gambata, scivola 2 secondi. Ultima 25 veloce.',
          nota: 'Gambe a "frusta" con piedi a martello; le mani tornano avanti veloci e unite.'
        };
      }
      if (stile === 'farfalla') {
        return {
          titolo: 'Finale: farfalla tecnica', serie: ripeti(n, 25), rec: 30, passoMult: 1.2,
          descrizione: 'Farfalla tecnica: un braccio (dx / sx / entrambi), 2 colpi di delfino per bracciata. Ultima 25 completa.',
          nota: 'Il delfino parte dal petto, non dalle ginocchia. Respira guardando in avanti basso.'
        };
      }
      return {
        titolo: 'Finale veloce', serie: ripeti(Math.min(n, ctx.profilo.quotaBaseMax < 1 ? 6 : 12), 25), rec: 30, passoMult: 0.9,
        descrizione: 'Crawl veloce: 25 forti con frequenza alta.',
        nota: 'Veloce ma lungo: non accorciare la bracciata. Recupero completo.'
      };
    },

    defaticamento: function (ctx, budget) {
      return {
        titolo: 'Defaticamento', serie: [arrotonda(budget, 50)], rec: 0,
        descrizione: 'Facile, dorso o stile libero a scelta.',
        nota: 'Respiro lento, sciogli spalle e collo.'
      };
    }
  };

  // ---------------------------------------------------------------------------
  // Stima tempi e adattamento alla durata
  // ---------------------------------------------------------------------------
  function stimaBlocco(b, passo) {
    if (b.esercizi) return b.stimaSec || 0;
    var m = somma(b.serie || []);
    var mult = (b.passoMult || CONFIG.passoBlocco[b.tipo] || 1);
    var pause = Math.max(0, (b.serie || []).length - 1) * (b.rec || 0);
    return Math.round(m / 100 * passo * mult + pause);
  }

  function riduciBlocco(b) {
    if (b.fisso || b.esercizi) return false;
    var s = b.serie, min = b.tipo === 'base' ? 2 : 1;
    if (s.length > min) {
      // togli dall'ultima posizione (o dal centro se è una piramide simmetrica)
      var simm = s.length >= 3 && s.join() === s.slice().reverse().join() && s[0] !== s[Math.floor(s.length / 2)];
      if (simm) {
        if (s.length - 2 < Math.max(3, min)) return false;
        b.serie = s.slice(1, s.length - 1);
      } else {
        b.serie = s.slice(0, s.length - 1);
      }
      return true;
    }
    if (s.length === 1 && s[0] > 100) { b.serie = [s[0] - 50]; return true; }
    return false;
  }

  function ricalcola(seduta) {
    var s = clona(seduta);
    s.blocchi.forEach(function (b) {
      if (b.esercizi) {
        b.metri = 0;
        b.stimaSec = stimaSecco(b);
      } else {
        b.metri = somma(b.serie || []);
        b.stimaSec = stimaBlocco(b, s.passo100);
      }
    });
    s.totaleMetri = somma(s.blocchi.map(function (b) { return b.metri || 0; }));
    s.stimaSec = somma(s.blocchi.map(function (b) { return b.stimaSec || 0; })) + CONFIG.transizioniSec;
    return s;
  }

  // ---------------------------------------------------------------------------
  // Contesto
  // ---------------------------------------------------------------------------
  function normalizzaInput(input) {
    input = input || {};
    if (!input.data || !/^\d{4}-\d{2}-\d{2}$/.test(input.data)) throw new Error('input.data richiesto nel formato YYYY-MM-DD');
    var durata = [30, 45, 60].indexOf(Number(input.durata)) >= 0 ? Number(input.durata) : 45;
    var a = input.attrezzi || {};
    var out = {
      data: input.data,
      durata: durata,
      tipo: input.tipo === 'secco' ? 'secco' : 'vasca',
      energia: clamp(Math.round(Number(input.energia) || 3), 1, 5),
      attrezzi: { pullBuoy: a.pullBuoy !== false, tavoletta: a.tavoletta !== false, palette: a.palette === true },
      focus: ['tecnica', 'resistenza', 'respirazione', 'misto'].indexOf(input.focus) >= 0 ? input.focus : 'misto'
    };
    out.seed = input.seed != null ? (Number(input.seed) >>> 0) : hash(JSON.stringify(out));
    return out;
  }

  function creaContesto(profilo, inp, storico) {
    var passoInfo = passoRiferimento(profilo, storico, inp.data);
    var prog = calcolaProgressione(profilo, storico, inp.data);
    var vasche = storicoProfilo(profilo, storico, inp.data).filter(function (s) { return s.tipo === 'vasca'; });
    var stileBase = inp.focus;
    if (stileBase === 'misto') {
      stileBase = profilo.alternaFocus ? ['resistenza', 'tecnica', 'respirazione'][vasche.length % 3] : 'resistenza';
    }
    var finali = profilo.finaliTecnici || ['crawl'];
    var adjEnergia = inp.energia <= 2 ? 5 : 0;
    var livelloRec = Math.floor(Math.max(0, prog.livello) / 2);
    var recBase = Math.max(profilo.recuperoMin, profilo.recuperoBase - livelloRec * (profilo.riduzioneRecupero || 0));
    if (prog.livello < 0) recBase += 5 * -prog.livello;
    if (profilo.recuperoMin === profilo.recuperoBase) recBase = profilo.recuperoBase; // soste fisse
    else recBase += adjEnergia;
    return {
      profilo: profilo,
      input: inp,
      attrezzi: inp.attrezzi,
      passoInfo: passoInfo,
      passo: passoInfo.sec100,
      progressione: prog,
      settimana: settimanaDi(inp.data),
      test: inp.tipo === 'vasca' && testDovuto(profilo, storico, inp.data),
      stileBase: stileBase,
      stileFinale: finali[vasche.length % finali.length],
      recuperoBase: recBase,
      recupero: function (r) { return r + adjEnergia; },
      disponibileSec: inp.durata * 60 - CONFIG.transizioniSec
    };
  }

  function budgetVasca(ctx) {
    var p = ctx.profilo, inp = ctx.input;
    var volume = p.volumi[inp.durata] * (CONFIG.fattoreEnergia[inp.energia] || 1);
    var q = clona(CONFIG.quote[inp.focus] || CONFIG.quote.misto);
    if (q.base > p.quotaBaseMax) {
      var extra = q.base - p.quotaBaseMax;
      q.base = p.quotaBaseMax;
      q.riscaldamento += extra / 3; q.respirazione += extra / 3; q.gambe += extra / 3;
    }
    var budget = {};
    Object.keys(q).forEach(function (k) { budget[k] = volume * q[k]; });
    var L = ctx.progressione.livello;
    var extraProg = L > 0 ? Math.ceil(L / 2) * p.passoProgressioneMetri : L * 50;
    budget.base = Math.max(100, budget.base + extraProg);
    return budget;
  }

  function completaBlocco(raw, tipo, indice, ctx) {
    var b = {
      id: tipo + '-' + indice,
      tipo: raw.test ? 'test' : tipo,
      titolo: raw.titolo,
      serie: raw.serie,
      rec: raw.rec || 0,
      descrizione: raw.descrizione || '',
      nota: raw.nota || '',
      attrezzi: raw.attrezzi || [],
      completato: false,
      tempo: ''
    };
    if (raw.passoMult) b.passoMult = raw.passoMult;
    if (raw.fisso) b.fisso = true;
    b.metri = somma(b.serie);
    b.stimaSec = stimaBlocco(b, ctx.passo);
    return b;
  }

  function adattaAlTempo(blocchi, ctx) {
    var tot = function () { return somma(blocchi.map(function (b) { return stimaBlocco(b, ctx.passo); })); };
    var guardia = 0, i = 0, bloccati = 0;
    var ordine = CONFIG.ordineRiduzione;
    while (tot() > ctx.disponibileSec && guardia++ < 500 && bloccati < ordine.length) {
      var tipo = ordine[i++ % ordine.length];
      var b = blocchi.filter(function (x) { return x.tipo === tipo; })[0];
      if (b && riduciBlocco(b)) bloccati = 0; else bloccati++;
    }
    blocchi.forEach(function (b) { b.metri = somma(b.serie); b.stimaSec = stimaBlocco(b, ctx.passo); });
  }

  // ---------------------------------------------------------------------------
  // Secco: circuito a corpo libero
  // ---------------------------------------------------------------------------
  var SECCO = {
    mobilita: [
      'Circonduzioni braccia avanti e indietro', 'Rotazioni del busto', 'Gatto-mucca (cat-cow)',
      'Apertura spalle con braccia a W', 'Affondo con rotazione del busto', 'Slanci gambe avanti e laterali',
      'Cerchi con le anche', 'Rotazioni delle caviglie'
    ],
    forza: [
      { nome: 'Squat a corpo libero', rip: [8, 10, 12, 15, 20] },
      { nome: 'Push-up (sulle ginocchia se serve)', rip: [5, 6, 8, 10, 12] },
      { nome: 'Superman (estensioni dorsali)', rip: [8, 10, 12, 14, 16] },
      { nome: 'Affondi alternati', rip: [5, 6, 8, 10, 12], lato: true },
      { nome: 'Glute bridge', rip: [10, 12, 15, 18, 20] },
      { nome: 'Y-T-W a terra (prono)', rip: [4, 5, 6, 8, 10] },
      { nome: 'Mountain climber', sec: [15, 20, 25, 30, 35] },
      { nome: 'Jumping jack', sec: [20, 25, 30, 40, 45] },
      { nome: 'Squat jump', rip: [5, 6, 8, 10, 12], minEnergia: 4 },
      { nome: 'Burpee', rip: [3, 4, 5, 6, 8], minEnergia: 4 }
    ],
    core: [
      { nome: 'Plank frontale', sec: [15, 20, 30, 40, 45] },
      { nome: 'Plank laterale', sec: [10, 15, 20, 25, 30], lato: true },
      { nome: 'Dead bug', rip: [5, 6, 8, 10, 12], lato: true },
      { nome: 'Hollow hold', sec: [10, 15, 20, 25, 30] },
      { nome: 'Flutter kick supino (gambe a forbice)', sec: [15, 20, 25, 30, 40] },
      { nome: 'Bird dog', rip: [5, 6, 8, 10, 12], lato: true }
    ],
    stretching: [
      'Pettorali al muro', 'Dorsali (posizione del bambino)', 'Tricipiti dietro la testa',
      'Spalla a braccio incrociato', 'Quadricipiti in piedi', 'Flessori dell\'anca in affondo', 'Polpacci al muro'
    ]
  };

  function mescola(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function esercizio(e, livello) {
    var dose = e.rip ? e.rip[livello] + ' rip' : e.sec[livello] + '"';
    if (e.lato) dose += ' per lato';
    var sec = (e.rip ? e.rip[livello] * 3 : e.sec[livello]) * (e.lato ? 2 : 1);
    return { nome: e.nome, dose: dose, sec: sec };
  }

  var COSTRUTTORI_SECCO = {
    riscaldamento: function (ctx, rng) {
      var n = ctx.input.durata >= 45 ? 6 : 5;
      var es = mescola(rng, SECCO.mobilita).slice(0, n).map(function (nome) { return { nome: nome, dose: '30"', sec: 30 }; });
      return { titolo: 'Mobilità', giri: 1, rec: 0, recEsercizi: 5, esercizi: es, nota: 'Movimenti ampi e controllati, scalda spalle e anche.' };
    },
    circuito: function (ctx, rng, opz) {
      var liv = ctx.livelloSecco, nEs = (opz && opz.nEs) || { 30: 5, 45: 6, 60: 7 }[ctx.input.durata];
      var pool = SECCO.forza.filter(function (e) { return !e.minEnergia || ctx.input.energia >= e.minEnergia; });
      var es = mescola(rng, pool).slice(0, nEs).map(function (e) { return esercizio(e, liv); });
      return {
        titolo: 'Circuito', giri: (opz && opz.giri) || 3, rec: ctx.input.energia <= 2 ? 90 : 60, recEsercizi: 15, esercizi: es,
        nota: 'Esegui gli esercizi di fila con 15" di pausa, recupero tra i giri. Qualità prima della velocità.'
      };
    },
    core: function (ctx, rng) {
      var es = mescola(rng, SECCO.core).slice(0, 3).map(function (e) { return esercizio(e, ctx.livelloSecco); });
      return {
        titolo: 'Core', giri: ctx.input.durata >= 45 ? 3 : 2, rec: 30, recEsercizi: 10, esercizi: es,
        nota: 'Schiena neutra, ombelico verso la colonna: è la base della posizione in acqua.'
      };
    },
    defaticamento: function (ctx, rng) {
      var n = ctx.input.durata >= 45 ? 6 : 4;
      var es = mescola(rng, SECCO.stretching).slice(0, n).map(function (nome) { return { nome: nome, dose: '30"', sec: 30 }; });
      return { titolo: 'Stretching', giri: 1, rec: 0, recEsercizi: 5, esercizi: es, nota: 'Respira lento, nessun rimbalzo.' };
    }
  };

  function stimaSecco(b) {
    var giro = somma(b.esercizi.map(function (e) { return e.sec + (b.recEsercizi || 0); }));
    return Math.round(giro * b.giri + (b.giri - 1) * (b.rec || 0));
  }

  function bloccoSecco(raw, tipo, indice) {
    var b = {
      id: tipo + '-' + indice, tipo: tipo, titolo: raw.titolo, giri: raw.giri, rec: raw.rec,
      recEsercizi: raw.recEsercizi, esercizi: raw.esercizi, descrizione: raw.descrizione || '',
      nota: raw.nota || '', completato: false, tempo: '', metri: 0
    };
    b.stimaSec = stimaSecco(b);
    return b;
  }

  function generaSecco(ctx, rng) {
    ctx.livelloSecco = clamp(ctx.input.energia - 1 + (ctx.profilo.livelloSecco || 0), 0, 4);
    var ordine = ['riscaldamento', 'circuito', 'core', 'defaticamento'];
    var blocchi = ordine.map(function (t, i) { return bloccoSecco(COSTRUTTORI_SECCO[t](ctx, rng), t, i); });
    var circ = blocchi[1];
    var fissi = blocchi[0].stimaSec + blocchi[2].stimaSec + blocchi[3].stimaSec;
    var perGiro = stimaSecco(Object.assign({}, circ, { giri: 1 })) + circ.rec;
    circ.giri = clamp(Math.floor((ctx.disponibileSec - fissi + circ.rec) / perGiro), 2, 6);
    circ.stimaSec = stimaSecco(circ);
    // se ancora troppo lungo (30'): togli esercizi dal circuito, poi giri al core
    while (fissi + circ.stimaSec > ctx.disponibileSec && circ.esercizi.length > 4) {
      circ.esercizi.pop(); circ.stimaSec = stimaSecco(circ);
    }
    if (fissi + circ.stimaSec > ctx.disponibileSec && blocchi[2].giri > 1) {
      blocchi[2].giri--; blocchi[2].stimaSec = stimaSecco(blocchi[2]);
    }
    return blocchi;
  }

  // ---------------------------------------------------------------------------
  // API pubblica
  // ---------------------------------------------------------------------------
  /**
   * Genera una seduta. Funzione pura: non modifica i parametri.
   */
  function generaSeduta(profilo, input, storico) {
    if (!profilo || !profilo.id) throw new Error('profilo non valido');
    var inp = normalizzaInput(input);
    var ctx = creaContesto(profilo, inp, storico || []);
    var rng = rngDa(inp.seed);
    var note = [];
    var blocchi;

    if (inp.tipo === 'secco') {
      blocchi = generaSecco(ctx, rng);
      note.push('Circuito a corpo libero, livello ' + (ctx.livelloSecco + 1) + '/5 (energia ' + inp.energia + ').');
    } else {
      var budget = budgetVasca(ctx);
      blocchi = CONFIG.ordineBlocchi.map(function (tipo, i) {
        var t = tipo === 'base' && ctx.test ? 'test' : tipo;
        return completaBlocco(COSTRUTTORI[t](ctx, budget[tipo], rng), tipo, i, ctx);
      });
      adattaAlTempo(blocchi, ctx);
      if (ctx.test) note.push('Settimana ' + ctx.settimana + ': test al posto del blocco base.');
      if (!inp.attrezzi.palette) note.push('Palette non ammesse: niente palette nel blocco pull.');
      note.push('Passo di riferimento ' + formattaTempo(ctx.passo) + '/100 m (' + ctx.passoInfo.fonte + ').');
      note.push('Progressione: ' + ctx.progressione.motivo);
      if (ctx.stileBase !== inp.focus) note.push('Focus misto: oggi base orientata a ' + ctx.stileBase + '.');
    }
    if (inp.energia <= 2) note.push('Energia bassa: volumi ridotti e recuperi più lunghi.');

    var seduta = {
      versione: 1,
      id: profilo.id + '-' + inp.data + '-' + inp.seed.toString(36),
      profiloId: profilo.id,
      data: inp.data,
      tipo: inp.tipo,
      durata: inp.durata,
      energia: inp.energia,
      focus: inp.focus,
      attrezzi: inp.attrezzi,
      seed: inp.seed,
      settimana: ctx.settimana,
      passo100: Math.round(ctx.passo),
      progressione: inp.tipo === 'vasca' ? ctx.progressione : null,
      test: !!ctx.test,
      disponibileSec: ctx.disponibileSec,
      blocchi: blocchi,
      note: note,
      stato: 'generata'
    };
    return ricalcola(seduta);
  }

  /**
   * Rigenera solo il blocco in posizione `indice`, mantenendo (circa) lo stesso volume/tempo.
   * Restituisce una nuova seduta; quella passata non viene modificata.
   */
  function rigeneraBlocco(profilo, seduta, indice, storico, seed) {
    var vecchio = seduta.blocchi[indice];
    if (!vecchio) throw new Error('blocco inesistente');
    var inp = normalizzaInput({
      data: seduta.data, durata: seduta.durata, tipo: seduta.tipo, energia: seduta.energia,
      attrezzi: seduta.attrezzi, focus: seduta.focus, seed: seed
    });
    var ctx = creaContesto(profilo, inp, storico || []);
    ctx.passo = seduta.passo100;
    var rng = rngDa(inp.seed ^ hash(vecchio.id));
    var nuovo;
    var tipoOrig = vecchio.id.split('-')[0];

    if (seduta.tipo === 'secco') {
      ctx.livelloSecco = clamp(inp.energia - 1 + (profilo.livelloSecco || 0), 0, 4);
      var opz = tipoOrig === 'circuito' ? { nEs: vecchio.esercizi.length, giri: vecchio.giri } : null;
      nuovo = bloccoSecco(COSTRUTTORI_SECCO[tipoOrig](ctx, rng, opz), tipoOrig, indice);
      nuovo.giri = vecchio.giri; nuovo.stimaSec = stimaSecco(nuovo);
      nuovo.id = vecchio.id;
    } else {
      if (vecchio.tipo === 'test') return clona(seduta);
      // alterna lo stile del finale per Emanuele quando rigeneri il finale
      if (tipoOrig === 'veloce' && profilo.finaliTecnici && profilo.finaliTecnici.length > 1) {
        ctx.stileFinale = scegli(rng, profilo.finaliTecnici);
      }
      if (tipoOrig === 'base' && seduta.focus === 'misto' && profilo.alternaFocus) {
        ctx.stileBase = scegli(rng, ['resistenza', 'tecnica', 'respirazione']);
      }
      var raw = COSTRUTTORI[tipoOrig](ctx, vecchio.metri || somma(vecchio.serie), rng);
      nuovo = completaBlocco(raw, tipoOrig, indice, ctx);
      nuovo.id = vecchio.id;
      var limite = (vecchio.stimaSec || stimaBlocco(vecchio, ctx.passo)) * 1.05;
      var g = 0;
      while (stimaBlocco(nuovo, ctx.passo) > limite && g++ < 100 && riduciBlocco(nuovo)) { /* accorcia */ }
    }
    var s = clona(seduta);
    s.blocchi[indice] = nuovo;
    return ricalcola(s);
  }

  /** Controlla che una seduta abbia il formato atteso (utile anche per sedute importate o generate altrove). */
  function validaSeduta(s) {
    var errori = [];
    function err(m) { errori.push(m); }
    if (!s || typeof s !== 'object') return { ok: false, errori: ['seduta mancante'] };
    if (!s.profiloId) err('profiloId mancante');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.data || '')) err('data non valida');
    if (['vasca', 'secco'].indexOf(s.tipo) < 0) err('tipo non valido');
    if ([30, 45, 60].indexOf(s.durata) < 0) err('durata non valida');
    if (!Array.isArray(s.blocchi) || !s.blocchi.length) err('blocchi mancanti');
    (s.blocchi || []).forEach(function (b, i) {
      var p = 'blocco ' + (i + 1) + ': ';
      if (!b.id) err(p + 'id mancante');
      if (!b.titolo) err(p + 'titolo mancante');
      if (s.tipo === 'vasca') {
        if (!Array.isArray(b.serie) || !b.serie.length) err(p + 'serie mancante');
        else if (b.serie.some(function (d) { return !(d > 0) || d % CONFIG.vasca !== 0; })) err(p + 'distanze non multiple di ' + CONFIG.vasca + ' m');
        if (!(b.rec >= 0)) err(p + 'recupero non valido');
      } else {
        if (!Array.isArray(b.esercizi) || !b.esercizi.length) err(p + 'esercizi mancanti');
        if (!(b.giri >= 1)) err(p + 'giri non validi');
      }
    });
    return { ok: !errori.length, errori: errori };
  }

  return {
    CONFIG: CONFIG,
    PROFILI: PROFILI,
    generaSeduta: generaSeduta,
    rigeneraBlocco: rigeneraBlocco,
    ricalcola: ricalcola,
    validaSeduta: validaSeduta,
    // utilità esposte per l'interfaccia e i test
    passoRiferimento: passoRiferimento,
    calcolaProgressione: calcolaProgressione,
    settimanaDi: settimanaDi,
    formattaTempo: formattaTempo,
    leggiTempo: leggiTempo,
    formattaSerie: formattaSerie,
    leggiSerie: leggiSerie
  };
});
