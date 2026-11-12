/* app.js — interfaccia. Tutta la logica di generazione è in generator.js. */
(function () {
  'use strict';
  var G = window.Generatore;
  var CHIAVE = 'nuoto.v1';
  var app = document.getElementById('app');

  // --------------------------------------------------------------------------
  // Stato e persistenza (solo localStorage)
  // --------------------------------------------------------------------------
  function inputDefault() {
    return { durata: 45, tipo: 'vasca', energia: 3, focus: 'misto', attrezzi: { pullBuoy: true, tavoletta: true, palette: false } };
  }
  function oggi() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function carica() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(CHIAVE)); } catch (e) { /* storage non disponibile */ }
    s = s || {};
    return {
      profilo: s.profilo || 'emanuele',
      vista: s.vista || 'genera',
      input: s.input || { emanuele: inputDefault(), beatrice: inputDefault() },
      correnti: s.correnti || { emanuele: null, beatrice: null },
      registro: Array.isArray(s.registro) ? s.registro : []
    };
  }
  var stato = carica();
  var ui = { modifica: null, data: oggi(), apri: {}, manuale: null };
  function manualeDefault() {
    return { data: oggi(), tipo: 'vasca', durata: '45', energia: 3, fatica: null, focus: 'misto', metri: '',
      completata: 'si', tempoTest: '', blocchi: '', riflessione: '' };
  }

  function salva() {
    try { localStorage.setItem(CHIAVE, JSON.stringify(stato)); }
    catch (e) { alert('Impossibile salvare in locale: ' + e.message); }
  }

  function profilo() { return G.PROFILI[stato.profilo]; }
  function input() { return stato.input[stato.profilo]; }
  function corrente() { return stato.correnti[stato.profilo]; }
  function setCorrente(s) { stato.correnti[stato.profilo] = s; salva(); }
  function nuovoSeed() { return Math.floor(Math.random() * 4294967295); }

  // --------------------------------------------------------------------------
  // Utilità di rendering
  // --------------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function seg(key, opzioni, valore) {
    return '<div class="seg">' + opzioni.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<button data-action="set" data-key="' + key + '" data-val="' + esc(v) + '" aria-pressed="' + (String(valore) === String(v)) + '">' + esc(l) + '</button>';
    }).join('') + '</div>';
  }
  function min(sec) { return Math.round(sec / 60) + '′'; }
  function dataIt(d) { var p = d.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  var GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  function giorno(d) { return GIORNI[new Date(d + 'T12:00:00').getDay()]; }
  var FOCUS = [['tecnica', 'Tecnica'], ['resistenza', 'Resistenza'], ['respirazione', 'Respiro'], ['misto', 'Misto']];

  // --------------------------------------------------------------------------
  // Viste
  // --------------------------------------------------------------------------
  function vistaGenera() {
    var inp = input(), p = profilo();
    var passo = G.passoRiferimento(p, stato.registro, ui.data);
    var prog = G.calcolaProgressione(p, stato.registro, ui.data);
    var sett = G.settimanaDi(ui.data);
    var prossimoTest = G.CONFIG.settimaneTest.filter(function (w) { return w >= sett; })[0];
    var h = '<h1>Nuova seduta · ' + esc(p.nome) + '</h1>';

    h += '<div class="field"><span class="label">Durata</span>' + seg('durata', [[30, '30′'], [45, '45′'], [60, '60′']], inp.durata) + '</div>';
    h += '<div class="field"><span class="label">Tipo</span>' + seg('tipo', [['vasca', 'Vasca'], ['secco', 'Secco']], inp.tipo) + '</div>';
    h += '<div class="field"><span class="label">Energia oggi</span>' + seg('energia', [1, 2, 3, 4, 5], inp.energia) + '</div>';
    if (inp.tipo === 'vasca') {
      h += '<div class="field"><span class="label">Attrezzi</span><div class="toggles">' +
        [['pullBuoy', 'Pull buoy'], ['tavoletta', 'Tavoletta'], ['palette', 'Palette']].map(function (a) {
          return '<button class="chip" data-action="attrezzo" data-val="' + a[0] + '" aria-pressed="' + !!inp.attrezzi[a[0]] + '">' + a[1] + '</button>';
        }).join('') + '</div></div>';
      h += '<div class="field"><span class="label">Focus</span>' + seg('focus', FOCUS, inp.focus) + '</div>';
    }
    h += '<div class="field"><label for="data">Data</label><input type="date" id="data" data-input="data" value="' + ui.data + '"></div>';

    h += '<div class="info"><b>Settimana ' + sett + '</b>' +
      (prossimoTest ? (prossimoTest === sett ? ' · <b>settimana di test</b>' : ' · test in settimana ' + prossimoTest) : '') +
      '<ul><li>Passo ' + G.formattaTempo(passo.sec100) + '/100 m — ' + esc(passo.fonte) + '</li>' +
      (inp.tipo === 'vasca' ? '<li>' + esc(prog.motivo) + '</li>' : '') +
      G.analizzaRiflessioni(p, stato.registro, ui.data).fonti.map(function (f) {
        return '<li>Riflessione del ' + dataIt(f.data).slice(0, 5) + ': ' + esc(f.testo) + ' → seduta adattata</li>';
      }).join('') + '</ul></div>';

    if (corrente()) {
      h += '<p class="muted small">C\'è già una seduta in corso: generandone una nuova verrà sostituita.</p>';
    }
    h += '<button class="btn primary big" data-action="genera">Genera seduta</button>';
    return h;
  }

  function bloccoVasca(b, i) {
    var testo = '<div class="serie">' + esc(G.formattaSerie(b.serie)) +
      (b.rec ? ' <span class="rec">· rec ' + b.rec + '″</span>' : '') + '</div>' +
      '<p class="desc">' + esc(b.descrizione) + '</p>' +
      (b.nota ? '<p class="nota">' + esc(b.nota) + '</p>' : '') +
      (b.attrezzi || []).map(function (a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('');
    if (ui.modifica === i) {
      testo += '<div class="edit">' +
        '<div><label>Serie (es. 4x50, 25-50-75, 200 + 2x50)</label><input type="text" id="e-serie" value="' + esc(G.formattaSerie(b.serie)) + '"></div>' +
        '<div><label>Recupero (secondi)</label><input type="number" min="0" step="5" id="e-rec" value="' + (b.rec || 0) + '"></div>' +
        '<div><label>Descrizione</label><textarea id="e-desc">' + esc(b.descrizione) + '</textarea></div>' +
        '<div><label>Nota tecnica</label><textarea id="e-nota">' + esc(b.nota) + '</textarea></div>' +
        '<div class="row"><button class="btn primary" data-action="salva-blocco" data-i="' + i + '">Salva</button>' +
        '<button class="btn" data-action="annulla">Annulla</button></div></div>';
    }
    return testo;
  }

  function bloccoSecco(b, i) {
    var testo = '<div class="serie">' + (b.giri > 1 ? b.giri + ' giri' : '1 giro') +
      (b.rec ? ' <span class="rec">· rec ' + b.rec + '″ tra i giri</span>' : '') + '</div>' +
      '<ul class="esercizi">' + b.esercizi.map(function (e) {
        return '<li><span>' + esc(e.nome) + '</span><b>' + esc(e.dose) + '</b></li>';
      }).join('') + '</ul>' +
      (b.nota ? '<p class="nota">' + esc(b.nota) + '</p>' : '');
    if (ui.modifica === i) {
      testo += '<div class="edit">' +
        '<div class="row"><div class="grow"><label>Giri</label><input type="number" min="1" id="e-giri" value="' + b.giri + '"></div>' +
        '<div class="grow"><label>Rec tra giri (s)</label><input type="number" min="0" step="5" id="e-rec" value="' + (b.rec || 0) + '"></div></div>' +
        '<div><label>Esercizi (uno per riga: nome | dose, es. "Squat | 12 rip")</label><textarea id="e-es" rows="7">' +
        esc(b.esercizi.map(function (e) { return e.nome + ' | ' + e.dose; }).join('\n')) + '</textarea></div>' +
        '<div><label>Nota</label><textarea id="e-nota">' + esc(b.nota) + '</textarea></div>' +
        '<div class="row"><button class="btn primary" data-action="salva-blocco" data-i="' + i + '">Salva</button>' +
        '<button class="btn" data-action="annulla">Annulla</button></div></div>';
    }
    return testo;
  }

  function vistaSeduta() {
    var s = corrente();
    if (!s) return '<div class="empty"><p>Nessuna seduta in corso.</p><button class="btn primary" data-action="vista" data-val="genera">Genera seduta</button></div>';
    var fatti = s.blocchi.filter(function (b) { return b.completato; }).length;
    var h = '<h1>' + (s.tipo === 'vasca' ? 'Vasca' : 'Secco') + ' · ' + giorno(s.data) + ' ' + dataIt(s.data) + '</h1>';
    h += '<div class="summary">' +
      (s.tipo === 'vasca' ? '<div><b>' + s.totaleMetri.toLocaleString('it-IT') + ' m</b><span>totale</span></div>'
        : '<div><b>' + s.blocchi.length + '</b><span>blocchi</span></div>') +
      '<div><b>~' + min(s.stimaSec) + '</b><span>su ' + s.durata + '′</span></div>' +
      '<div><b>' + fatti + '/' + s.blocchi.length + '</b><span>fatti</span></div></div>';
    if (s.note && s.note.length) h += '<div class="info"><ul style="margin:0">' + s.note.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';

    s.blocchi.forEach(function (b, i) {
      var cls = 'card' + (b.completato ? ' done' : '') + (b.tipo === 'test' ? ' test' : '');
      h += '<section class="' + cls + '"><div class="card-head">' +
        '<button class="check" data-action="spunta" data-i="' + i + '" aria-label="Segna come fatto" aria-pressed="' + !!b.completato + '">✓</button>' +
        '<div class="grow"><div class="row"><h2 class="grow">' + esc(b.titolo) + '</h2><span class="muted small">' +
        (b.metri ? b.metri + ' m · ' : '') + '~' + min(b.stimaSec) + '</span></div>' +
        (s.tipo === 'vasca' ? bloccoVasca(b, i) : bloccoSecco(b, i)) + '</div></div>';
      if (ui.modifica !== i) {
        h += '<div class="card-actions">' +
          '<input type="text" data-tempo="' + i + '" placeholder="' + (b.tipo === 'test' ? 'Tempo test (mm:ss)' : 'Tempi (es. 1:05, 1:07…)') + '" value="' + esc(b.tempo) + '" inputmode="' + (b.tipo === 'test' ? 'decimal' : 'text') + '">' +
          '<button class="btn small" data-action="modifica" data-i="' + i + '">Modifica</button>' +
          (b.tipo !== 'test' ? '<button class="btn small" data-action="rigenera-blocco" data-i="' + i + '">Rigenera</button>' : '') +
          '</div>';
      }
      h += '</section>';
    });

    h += '<div class="field fatica"><label for="rifl">Riflessione <span class="muted">(opzionale)</span></label>' +
      '<textarea id="rifl" data-rifl placeholder="Com\'è andata? Sensazioni, fastidi (es. spalla, crampi), respiro, cosa migliorare…">' + esc(s.riflessione) + '</textarea>' +
      '<p class="muted small">Se segnali fastidi (spalla, gambe, ginocchio, schiena) o problemi di respiro, le prossime sedute si adattano.</p></div>';
    h += '<div class="field fatica"><span class="label">Fatica a fine seduta (1 = facile, 5 = al limite)</span>' + seg('fatica', [1, 2, 3, 4, 5], s.fatica || '') + '</div>';
    h += '<button class="btn primary big" data-action="registra">Salva nel registro</button>';
    h += '<div class="row" style="margin-top:10px"><button class="btn grow" data-action="rigenera-tutto">Rigenera tutta</button>' +
      '<button class="btn danger grow" data-action="scarta">Scarta</button></div>';
    return h;
  }

  function vistaRegistro() {
    var p = profilo();
    var lista = stato.registro.filter(function (s) { return s.profiloId === p.id; })
      .sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : (b.completataIl || '') > (a.completataIl || '') ? 1 : -1; });
    var passo = G.passoRiferimento(p, stato.registro, oggi());
    var prog = G.calcolaProgressione(p, stato.registro, oggi());
    var h = '<h1>Registro · ' + esc(p.nome) + '</h1>';
    if (ui.manuale) return h + formManuale();
    h += '<button class="btn big" data-action="nuova-manuale" style="margin-bottom:16px">+ Aggiungi seduta già fatta</button>';
    h += '<div class="info">Passo ' + G.formattaTempo(passo.sec100) + '/100 m — ' + esc(passo.fonte) +
      '<br>Livello progressione: ' + prog.livello + ' — ' + esc(prog.motivo) + '</div>';
    if (!lista.length) return h + '<p class="empty">Ancora nessuna seduta registrata.</p>';
    lista.forEach(function (s) {
      var fatti = s.blocchi.filter(function (b) { return b.completato; });
      var metriFatti = fatti.reduce(function (t, b) { return t + (b.metri || 0); }, 0);
      var test = s.blocchi.filter(function (b) { return b.tipo === 'test' && b.tempoSec; })[0];
      h += '<details class="log"' + (ui.apri[s.id] ? ' open' : '') + ' data-id="' + esc(s.id) + '"><summary><div class="row"><b class="grow">' +
        giorno(s.data) + ' ' + dataIt(s.data) + ' · ' + (s.tipo === 'vasca' ? 'Vasca' : 'Secco') + ' ' + s.durata + '′</b>' +
        '<span>fatica ' + (s.fatica || '–') + '</span></div><div class="muted small">' +
        (s.tipo === 'vasca' ? metriFatti + ' / ' + s.totaleMetri + ' m · ' : '') +
        fatti.length + '/' + s.blocchi.length + ' blocchi' +
        (test ? ' · <b>test ' + G.formattaTempo(test.tempoSec) + '</b>' : '') +
        ' · energia ' + s.energia + (s.origine === 'manuale' ? '' : ' · ' + esc(s.focus)) +
        (s.origine === 'manuale' ? ' · <span class="tag" style="margin:0">inserita a mano</span>' : '') +
        (s.incompleta ? ' · non completata' : '') +
        (s.riflessione ? '<div class="rifl-anteprima">“' + esc(s.riflessione.length > 90 ? s.riflessione.slice(0, 90) + '…' : s.riflessione) + '”</div>' : '') +
        '</div></summary><div class="body"><ul>' +
        s.blocchi.map(function (b) {
          var det = s.tipo === 'vasca' ? G.formattaSerie(b.serie) + (b.rec ? ' rec ' + b.rec + '″' : '')
            : b.giri + '× ' + b.esercizi.map(function (e) { return e.nome; }).join(', ');
          return '<li>' + (b.completato ? '✓ ' : '✗ ') + '<b>' + esc(b.titolo) + '</b> ' + esc(det) +
            (b.tempo ? ' — <i>' + esc(b.tempo) + '</i>' : '') + '</li>';
        }).join('') + '</ul>' +
        ((s.note || []).length && s.origine === 'manuale' ? '<p class="muted">' + esc(s.note.join(' · ')) + '</p>' : '') +
        '<div class="field"><label>Riflessione</label><textarea data-rifl-reg="' + esc(s.id) + '" placeholder="Aggiungi una riflessione…">' + esc(s.riflessione) + '</textarea></div>' +
        '<div class="field"><span class="label">Fatica</span><div class="seg">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<button data-action="fatica-reg" data-id="' + esc(s.id) + '" data-val="' + n + '" aria-pressed="' + (s.fatica === n) + '">' + n + '</button>';
        }).join('') + '</div></div>' +
        '<button class="btn small danger" data-action="elimina" data-id="' + esc(s.id) + '">Elimina</button></div></details>';
    });
    return h;
  }

  function mseg(key, opzioni, valore) {
    return '<div class="seg">' + opzioni.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<button data-action="mset" data-key="' + key + '" data-val="' + esc(v) + '" aria-pressed="' + (String(valore) === String(v)) + '">' + esc(l) + '</button>';
    }).join('') + '</div>';
  }

  function formManuale() {
    var m = ui.manuale, p = profilo();
    var h = '<p class="muted">Registra una seduta fatta senza l\'app: conta per progressione, passo, settimane di test e riflessioni.</p>';
    h += '<div class="row"><div class="field grow"><label for="m-data">Data</label><input type="date" id="m-data" data-m="data" value="' + esc(m.data) + '"></div>' +
      '<div class="field grow"><label for="m-durata">Durata (min)</label><input type="number" id="m-durata" data-m="durata" min="5" max="300" inputmode="numeric" value="' + esc(m.durata) + '"></div></div>';
    h += '<div class="field"><span class="label">Tipo</span>' + mseg('tipo', [['vasca', 'Vasca'], ['secco', 'Secco']], m.tipo) + '</div>';
    if (m.tipo === 'vasca') {
      h += '<div class="row"><div class="field grow"><label for="m-metri">Metri totali</label><input type="number" id="m-metri" data-m="metri" min="0" step="25" inputmode="numeric" placeholder="es. 1500" value="' + esc(m.metri) + '"></div>' +
        '<div class="field grow"><label for="m-test">Test ' + p.test.distanza + ' m <span class="muted">(se fatto)</span></label><input type="text" id="m-test" data-m="tempoTest" inputmode="decimal" placeholder="mm:ss" value="' + esc(m.tempoTest) + '"></div></div>';
      h += '<div class="field"><label for="m-blocchi">Blocchi <span class="muted">(opzionale, uno per riga)</span></label>' +
        '<textarea id="m-blocchi" data-m="blocchi" rows="5" placeholder="300 riscaldamento\n6x100 crawl rec 20\n4x50 pull rec 15\n8x25 veloci rec 30">' + esc(m.blocchi) + '</textarea>' +
        '<p class="muted small">Se scrivi i blocchi, i metri si calcolano da lì.</p></div>';
      h += '<div class="field"><span class="label">Focus</span>' + mseg('focus', FOCUS, m.focus) + '</div>';
    } else {
      h += '<div class="field"><label for="m-blocchi">Esercizi <span class="muted">(opzionale: nome | dose)</span></label>' +
        '<textarea id="m-blocchi" data-m="blocchi" rows="4" placeholder="Squat | 3x15\nPlank | 3x30&quot;">' + esc(m.blocchi) + '</textarea></div>';
    }
    h += '<div class="field"><span class="label">Hai completato tutto?</span>' + mseg('completata', [['si', 'Sì'], ['no', 'No, ho saltato qualcosa']], m.completata) + '</div>';
    h += '<div class="field"><span class="label">Energia prima</span>' + mseg('energia', [1, 2, 3, 4, 5], m.energia) + '</div>';
    h += '<div class="field"><span class="label">Fatica a fine seduta</span>' + mseg('fatica', [1, 2, 3, 4, 5], m.fatica) + '</div>';
    h += '<div class="field"><label for="m-rifl">Riflessione <span class="muted">(opzionale)</span></label>' +
      '<textarea id="m-rifl" data-m="riflessione" placeholder="Com\'è andata? Fastidi, respiro, sensazioni…">' + esc(m.riflessione) + '</textarea></div>';
    h += '<button class="btn primary big" data-action="salva-manuale">Salva nel registro</button>' +
      '<button class="btn big" style="margin-top:8px" data-action="annulla-manuale">Annulla</button>';
    return h;
  }

  function salvaManuale() {
    var m = ui.manuale;
    var r = G.creaSedutaManuale(profilo(), {
      data: m.data, tipo: m.tipo, durata: m.durata, energia: m.energia, fatica: m.fatica, focus: m.focus,
      metri: m.metri, tempoTest: m.tipo === 'vasca' ? m.tempoTest : '', blocchi: m.blocchi,
      completata: m.completata !== 'no', riflessione: m.riflessione, creataIl: new Date().toISOString()
    }, stato.registro);
    if (r.errori.length) { alert(r.errori.join('\n')); return false; }
    var sed = r.seduta;
    if (sed.note.length && sed.tipo === 'vasca' &&
      !confirm('Queste righe non sono state riconosciute come blocchi e verranno salvate come note:\n' + sed.note.join('\n') + '\n\nSalvo comunque?')) return false;
    sed.completataIl = new Date().toISOString();
    stato.registro.push(sed);
    ui.manuale = null;
    return true;
  }

  function vistaImpostazioni() {
    return '<h1>Impostazioni</h1>' +
      '<div class="info">I dati (registro e sedute in corso) sono salvati solo in questo browser. Esporta un backup ogni tanto.</div>' +
      '<div class="field"><span class="label">Backup</span><div class="row">' +
      '<button class="btn" data-action="esporta">Esporta JSON</button>' +
      '<label class="btn" for="importa">Importa JSON</label><input type="file" id="importa" accept="application/json,.json" hidden></div></div>' +
      '<div class="field"><span class="label">Parametri</span><p class="muted small">Partenza ' + dataIt(G.CONFIG.dataPartenza) +
      ', test nelle settimane ' + G.CONFIG.settimaneTest.join('/') + ', vasca ' + G.CONFIG.vasca + ' m. ' +
      'Profili, volumi e regole si modificano in <code>generator.js</code>.</p></div>' +
      '<div class="field"><span class="label">Azzera</span><button class="btn danger" data-action="reset">Cancella tutti i dati</button></div>';
  }

  function render() {
    document.querySelectorAll('[data-action="profilo"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.val === stato.profilo));
    });
    document.querySelectorAll('[data-action="vista"]').forEach(function (b) {
      if (b.closest('.tabs')) {
        if (b.dataset.val === stato.vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
    });
    var v = { genera: vistaGenera, seduta: vistaSeduta, registro: vistaRegistro, impostazioni: vistaImpostazioni }[stato.vista] || vistaGenera;
    app.innerHTML = v();
  }

  // --------------------------------------------------------------------------
  // Azioni
  // --------------------------------------------------------------------------
  function genera(seed) {
    var inp = input();
    var s = G.generaSeduta(profilo(), {
      data: ui.data, durata: inp.durata, tipo: inp.tipo, energia: inp.energia,
      attrezzi: inp.attrezzi, focus: inp.focus, seed: seed == null ? nuovoSeed() : seed
    }, stato.registro);
    ui.modifica = null;
    setCorrente(s);
    stato.vista = 'seduta';
  }

  function aggiornaCorrente(fn) {
    var s = JSON.parse(JSON.stringify(corrente()));
    fn(s);
    setCorrente(G.ricalcola(s));
  }

  function secDaDose(dose, vecchio) {
    var m = String(dose).match(/(\d+)/);
    if (!m) return vecchio || 30;
    var n = Number(m[1]);
    var sec = /rip/i.test(dose) ? n * 3 : n;
    return /lato/i.test(dose) ? sec * 2 : sec;
  }

  function salvaBlocco(i) {
    var s = corrente(), b = s.blocchi[i];
    var nota = document.getElementById('e-nota').value.trim();
    var rec = Math.max(0, Number(document.getElementById('e-rec').value) || 0);
    if (s.tipo === 'vasca') {
      var serie = G.leggiSerie(document.getElementById('e-serie').value);
      if (!serie) { alert('Serie non valida. Esempi: 4x50, 25-50-75, 200 + 2x50'); return; }
      if (serie.some(function (d) { return d % G.CONFIG.vasca; })) { alert('Le distanze devono essere multipli di ' + G.CONFIG.vasca + ' m.'); return; }
      var desc = document.getElementById('e-desc').value.trim();
      aggiornaCorrente(function (x) { var y = x.blocchi[i]; y.serie = serie; y.rec = rec; y.descrizione = desc; y.nota = nota; });
    } else {
      var giri = Math.max(1, Math.round(Number(document.getElementById('e-giri').value) || 1));
      var righe = document.getElementById('e-es').value.split('\n').map(function (r) { return r.trim(); }).filter(Boolean);
      if (!righe.length) { alert('Inserisci almeno un esercizio.'); return; }
      var vecchi = {};
      b.esercizi.forEach(function (e) { vecchi[e.nome] = e; });
      var es = righe.map(function (r) {
        var parti = r.split('|'), nome = parti[0].trim(), dose = (parti[1] || '').trim() || '10 rip';
        var v = vecchi[nome];
        return { nome: nome, dose: dose, sec: v && v.dose === dose ? v.sec : secDaDose(dose, v && v.sec) };
      });
      aggiornaCorrente(function (x) { var y = x.blocchi[i]; y.giri = giri; y.rec = rec; y.esercizi = es; y.nota = nota; });
    }
    ui.modifica = null;
  }

  function registra() {
    var s = corrente();
    if (!s.fatica) { alert('Indica la fatica (1-5) prima di salvare.'); return; }
    var fatti = s.blocchi.filter(function (b) { return b.completato; }).length;
    if (fatti < s.blocchi.length &&
      !confirm('Blocchi non spuntati: ' + (s.blocchi.length - fatti) + '. Verranno considerati saltati. Salvo comunque?')) return;
    var test = s.blocchi.filter(function (b) { return b.tipo === 'test'; })[0];
    if (test && test.completato && !test.tempoSec &&
      !confirm('Non hai inserito il tempo del test: il passo di riferimento non verrà aggiornato. Salvo comunque?')) return;
    var r = JSON.parse(JSON.stringify(s));
    r.stato = 'completata';
    r.completataIl = new Date().toISOString();
    // evita doppioni se rigenerata con lo stesso id
    stato.registro = stato.registro.filter(function (x) { return x.id !== r.id; }).concat(r);
    stato.correnti[stato.profilo] = null;
    stato.vista = 'registro';
    salva();
  }

  function esporta() {
    var blob = new Blob([JSON.stringify({ app: 'nuoto', versione: 1, registro: stato.registro }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nuoto-registro-' + oggi() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importa(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        var reg = Array.isArray(d) ? d : d.registro;
        if (!Array.isArray(reg)) throw new Error('formato non riconosciuto');
        var valide = reg.filter(function (s) { return G.validaSeduta(s).ok; });
        var ids = {};
        stato.registro.forEach(function (s) { ids[s.id] = true; });
        var nuove = valide.filter(function (s) { return !ids[s.id]; });
        stato.registro = stato.registro.concat(nuove);
        salva(); render();
        alert('Importate ' + nuove.length + ' sedute' + (reg.length - valide.length ? ' (' + (reg.length - valide.length) + ' scartate perché non valide)' : '') + '.');
      } catch (e) { alert('Import non riuscito: ' + e.message); }
    };
    fr.readAsText(file);
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action, v = el.dataset.val, i = el.dataset.i != null ? Number(el.dataset.i) : null;
    switch (a) {
      case 'profilo': stato.profilo = v; ui.modifica = null; ui.manuale = null; break;
      case 'vista': stato.vista = v; ui.modifica = null; ui.manuale = null; break;
      case 'set':
        if (el.dataset.key === 'fatica') { aggiornaCorrente(function (s) { s.fatica = Number(v); }); break; }
        input()[el.dataset.key] = ['durata', 'energia'].indexOf(el.dataset.key) >= 0 ? Number(v) : v;
        break;
      case 'attrezzo': input().attrezzi[v] = !input().attrezzi[v]; break;
      case 'genera': genera(); break;
      case 'rigenera-tutto':
        if (corrente().blocchi.some(function (b) { return b.completato; }) && !confirm('Hai già spuntato dei blocchi. Rigenerare tutto?')) return;
        var s0 = corrente();
        stato.input[stato.profilo] = { durata: s0.durata, tipo: s0.tipo, energia: s0.energia, focus: s0.focus, attrezzi: s0.attrezzi };
        ui.data = s0.data;
        genera();
        break;
      case 'scarta':
        if (!confirm('Scartare la seduta in corso?')) return;
        setCorrente(null); stato.vista = 'genera'; break;
      case 'spunta': aggiornaCorrente(function (s) { s.blocchi[i].completato = !s.blocchi[i].completato; }); break;
      case 'modifica': ui.modifica = i; break;
      case 'annulla': ui.modifica = null; break;
      case 'salva-blocco': salvaBlocco(i); break;
      case 'rigenera-blocco':
        setCorrente(G.rigeneraBlocco(profilo(), corrente(), i, stato.registro, nuovoSeed()));
        break;
      case 'registra': registra(); break;
      case 'nuova-manuale': ui.manuale = manualeDefault(); window.scrollTo(0, 0); break;
      case 'annulla-manuale': ui.manuale = null; break;
      case 'mset': ui.manuale[el.dataset.key] = ['energia', 'fatica'].indexOf(el.dataset.key) >= 0 ? Number(v) : v; break;
      case 'salva-manuale': if (salvaManuale()) window.scrollTo(0, 0); break;
      case 'fatica-reg':
        stato.registro.forEach(function (s) { if (s.id === el.dataset.id) s.fatica = Number(v); });
        ui.apri[el.dataset.id] = true;
        break;
      case 'elimina':
        if (!confirm('Eliminare questa seduta dal registro?')) return;
        stato.registro = stato.registro.filter(function (s) { return s.id !== el.dataset.id; });
        break;
      case 'esporta': esporta(); return;
      case 'reset':
        if (!confirm('Cancellare registro e sedute in corso per entrambi i profili?')) return;
        stato = { profilo: stato.profilo, vista: 'genera', input: { emanuele: inputDefault(), beatrice: inputDefault() }, correnti: { emanuele: null, beatrice: null }, registro: [] };
        break;
    }
    salva();
    render();
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset.input === 'data' && el.value) { ui.data = el.value; render(); return; }
    if (el.id === 'importa' && el.files[0]) { importa(el.files[0]); el.value = ''; return; }
    if (el.dataset.tempo != null) {
      var i = Number(el.dataset.tempo), val = el.value.trim();
      aggiornaCorrente(function (s) {
        var b = s.blocchi[i];
        b.tempo = val;
        if (b.tipo === 'test') {
          var t = G.leggiTempo(val);
          if (t) b.tempoSec = t; else delete b.tempoSec;
          if (t && !b.completato) b.completato = true;
        }
      });
      render();
    }
  });

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.dataset.m != null && ui.manuale) ui.manuale[el.dataset.m] = el.value;
    if (el.dataset.rifl != null && corrente()) {
      var s = corrente(); s.riflessione = el.value; salva();
    }
    if (el.dataset.riflReg != null) {
      stato.registro.forEach(function (s) { if (s.id === el.dataset.riflReg) s.riflessione = el.value; });
      salva();
    }
  });

  document.addEventListener('toggle', function (ev) {
    if (ev.target.matches && ev.target.matches('details.log')) ui.apri[ev.target.dataset.id] = ev.target.open;
  }, true);

  render();
})();
