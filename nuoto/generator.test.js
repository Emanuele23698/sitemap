// Test del generatore: `node nuoto/generator.test.js`
'use strict';
const assert = require('node:assert/strict');
const G = require('./generator.js');
const { PROFILI } = G;

let passati = 0;
function test(nome, fn) {
  try { fn(); passati++; console.log('ok  -', nome); }
  catch (e) { console.error('FAIL -', nome); console.error(e); process.exitCode = 1; }
}

const base = { data: '2026-11-12', durata: 45, tipo: 'vasca', energia: 3, focus: 'misto', attrezzi: {} };
const tutte = (p, extra) => G.generaSeduta(PROFILI[p], Object.assign({}, base, extra), []);

// seduta registrata finta
function registrata(profiloId, data, fatica, opz = {}) {
  const s = G.generaSeduta(PROFILI[profiloId], Object.assign({}, base, { data }), opz.storico || []);
  s.stato = 'completata';
  s.fatica = fatica;
  s.blocchi.forEach((b, i) => { b.completato = !(opz.salta && i === 2); });
  if (opz.tempoTest) s.blocchi.forEach(b => { if (b.tipo === 'test') b.tempoSec = opz.tempoTest; });
  return s;
}

test('deterministica e pura', () => {
  const storico = [];
  const a = tutte('emanuele'); const b = tutte('emanuele');
  assert.deepEqual(a, b);
  const input = Object.assign({}, base);
  const copia = JSON.stringify(input);
  G.generaSeduta(PROFILI.emanuele, input, storico);
  assert.equal(JSON.stringify(input), copia);
});

test('struttura vasca: 7 blocchi nell\'ordine previsto, multipli di 25', () => {
  const s = tutte('emanuele');
  assert.deepEqual(s.blocchi.map(b => b.id.split('-')[0]),
    ['riscaldamento', 'base', 'pull', 'gambe', 'respirazione', 'veloce', 'defaticamento']);
  assert.ok(G.validaSeduta(s).ok, G.validaSeduta(s).errori.join(', '));
});

test('ogni durata e focus sta nel tempo disponibile', () => {
  for (const p of ['emanuele', 'beatrice']) for (const durata of [30, 45, 60])
    for (const focus of ['tecnica', 'resistenza', 'respirazione', 'misto']) for (let seed = 0; seed < 5; seed++) {
      const s = tutte(p, { durata, focus, seed });
      assert.ok(s.stimaSec <= durata * 60, `${p} ${durata} ${focus}: ${G.formattaTempo(s.stimaSec)}`);
      assert.ok(G.validaSeduta(s).ok);
    }
});

test('volumi indicativi rispettati', () => {
  const e45 = tutte('emanuele', { durata: 45 }).totaleMetri;
  const e60 = tutte('emanuele', { durata: 60 }).totaleMetri;
  const b60 = tutte('beatrice', { durata: 60 }).totaleMetri;
  assert.ok(e45 >= 1300 && e45 <= 1550, 'E45 ' + e45);
  assert.ok(e60 >= 1800 && e60 <= 2150, 'E60 ' + e60);
  assert.ok(b60 >= 1100 && b60 <= 1300, 'B60 ' + b60);
  assert.ok(tutte('beatrice', { durata: 30 }).totaleMetri < tutte('beatrice', { durata: 45 }).totaleMetri);
});

test('palette no: nessun blocco usa palette; sì: pull con palette', () => {
  for (let seed = 0; seed < 10; seed++) {
    const s = tutte('emanuele', { seed, attrezzi: { palette: false } });
    assert.ok(s.blocchi.every(b => !(b.attrezzi || []).includes('palette')));
    const pull = s.blocchi[2];
    assert.ok(/pugni chiusi|nuoto normale/i.test(pull.descrizione));
  }
  const conPalette = tutte('emanuele', { attrezzi: { palette: true } });
  assert.ok(conPalette.blocchi[2].attrezzi.includes('palette'));
  const senzaPull = tutte('emanuele', { seed: 3, attrezzi: { palette: false, pullBuoy: false } });
  assert.match(senzaPull.blocchi[2].descrizione, /pugni chiusi/);
});

test('Beatrice: soste del blocco base a 20" e base corta', () => {
  for (let seed = 0; seed < 10; seed++) {
    const s = tutte('beatrice', { seed, durata: 60, energia: 1 });
    const b = s.blocchi[1];
    assert.equal(b.rec, 20);
    assert.ok(b.metri <= 300, 'base ' + b.metri);
  }
});

test('settimana 4 (18/11/2026): test al posto della base, una sola volta', () => {
  assert.equal(G.settimanaDi('2026-10-28'), 1);
  assert.equal(G.settimanaDi('2026-11-18'), 4);
  const s = tutte('emanuele', { data: '2026-11-18' });
  assert.equal(s.blocchi[1].tipo, 'test');
  assert.deepEqual(s.blocchi[1].serie, [400]);
  assert.equal(tutte('beatrice', { data: '2026-11-19' }).blocchi[1].serie[0], 200);
  assert.notEqual(tutte('emanuele', { data: '2026-11-12' }).blocchi[1].tipo, 'test');
  // test fatto lunedì -> mercoledì niente test e passo aggiornato
  const fatto = registrata('emanuele', '2026-11-18', 3, { tempoTest: 510 });
  const dopo = G.generaSeduta(PROFILI.emanuele, Object.assign({}, base, { data: '2026-11-20' }), [fatto]);
  assert.notEqual(dopo.blocchi[1].tipo, 'test');
  assert.ok(Math.abs(dopo.passo100 - 510 / 4) <= 1, String(dopo.passo100));
});

test('progressione: aumenta dopo 2 settimane ok, mantiene/riduce se pesante', () => {
  const p = PROFILI.emanuele;
  const s1 = registrata('emanuele', '2026-10-28', 3);
  const s2 = registrata('emanuele', '2026-11-04', 2, { storico: [s1] });
  const s3 = registrata('emanuele', '2026-11-10', 3, { storico: [s1, s2] });
  const st = [s1, s2, s3];
  const pr = G.calcolaProgressione(p, st, '2026-11-12');
  assert.equal(pr.azione, 'aumenta');
  assert.equal(pr.livello, 1);
  const prima = G.calcolaProgressione(p, st, '2026-11-05');
  assert.equal(prima.azione, 'mantieni');

  const dura = registrata('emanuele', '2026-11-11', 4, { storico: st });
  assert.equal(G.calcolaProgressione(p, st.concat(dura), '2026-11-12').azione, 'mantieni');
  const saltata = registrata('emanuele', '2026-11-12', 3, { storico: st, salta: true });
  const r = G.calcolaProgressione(p, st.concat(dura, saltata), '2026-11-13');
  assert.equal(r.azione, 'riduci');
  // Beatrice più lenta: 14 giorni non bastano
  const b1 = registrata('beatrice', '2026-10-28', 2);
  const b2 = registrata('beatrice', '2026-11-04', 2, { storico: [b1] });
  assert.equal(G.calcolaProgressione(PROFILI.beatrice, [b1, b2], '2026-11-12').azione, 'mantieni');
  assert.equal(G.calcolaProgressione(PROFILI.beatrice, [b1, b2], '2026-11-18').azione, 'aumenta');
});

test('rigeneraBlocco cambia solo quel blocco e resta nel tempo', () => {
  const s = tutte('emanuele', { durata: 60 });
  let diverso = false;
  for (let seed = 1; seed < 8; seed++) {
    const n = G.rigeneraBlocco(PROFILI.emanuele, s, 2, [], seed);
    assert.deepEqual(n.blocchi.filter((_, i) => i !== 2), s.blocchi.filter((_, i) => i !== 2));
    assert.equal(n.blocchi[2].id, s.blocchi[2].id);
    assert.ok(n.blocchi[2].stimaSec <= s.blocchi[2].stimaSec * 1.05 + 1);
    if (JSON.stringify(n.blocchi[2]) !== JSON.stringify(s.blocchi[2])) diverso = true;
  }
  assert.ok(diverso);
  const sec = tutte('emanuele', { tipo: 'secco' });
  const sec2 = G.rigeneraBlocco(PROFILI.emanuele, sec, 1, [], 99);
  assert.equal(sec2.blocchi[1].esercizi.length, sec.blocchi[1].esercizi.length);
});

test('secco: circuito scalato per durata ed energia', () => {
  for (const durata of [30, 45, 60]) {
    const s = tutte('emanuele', { tipo: 'secco', durata });
    assert.ok(s.stimaSec <= durata * 60, durata + ': ' + G.formattaTempo(s.stimaSec));
    assert.ok(G.validaSeduta(s).ok);
    assert.equal(s.totaleMetri, 0);
  }
  const corto = tutte('emanuele', { tipo: 'secco', durata: 30 }).blocchi[1];
  const lungo = tutte('emanuele', { tipo: 'secco', durata: 60 }).blocchi[1];
  assert.ok(lungo.giri * lungo.esercizi.length > corto.giri * corto.esercizi.length);
  const stanco = tutte('emanuele', { tipo: 'secco', energia: 1, seed: 1 }).blocchi[1];
  assert.ok(stanco.esercizi.every(e => !/Burpee|Squat jump/.test(e.nome)));
});

test('serie e tempi: parsing e formattazione', () => {
  assert.deepEqual(G.leggiSerie('4x50'), [50, 50, 50, 50]);
  assert.deepEqual(G.leggiSerie('25-50-75'), [25, 50, 75]);
  assert.deepEqual(G.leggiSerie('200 + 2×50'), [200, 50, 50]);
  assert.equal(G.leggiSerie('abc'), null);
  assert.equal(G.formattaSerie([50, 50, 50]), '3×50');
  assert.equal(G.formattaSerie([25, 50, 25]), '25-50-25');
  assert.equal(G.formattaSerie([200, 50, 50]), '200 + 2×50');
  assert.equal(G.leggiTempo('9:00'), 540);
  assert.equal(G.leggiTempo("8'30"), 510);
  assert.equal(G.leggiTempo('x'), null);
});

test('seduta manuale: metri, blocchi, test e validazione', () => {
  const p = PROFILI.emanuele;
  let r = G.creaSedutaManuale(p, { data: '2026-11-05', tipo: 'vasca', durata: 50, fatica: 3, metri: 1610, completata: true }, []);
  assert.deepEqual(r.errori, []);
  assert.equal(r.seduta.totaleMetri, 1600);
  assert.ok(G.validaSeduta(r.seduta).ok, G.validaSeduta(r.seduta).errori.join());
  r = G.creaSedutaManuale(p, { data: '2026-11-05', tipo: 'vasca', durata: 45, fatica: 2,
    blocchi: '300 riscaldamento\n4x100 crawl rec 20\n8x25 veloci rec 30"\nchiacchiere', completata: true }, []);
  assert.equal(r.seduta.blocchi.length, 3);
  assert.deepEqual(r.seduta.blocchi[1].serie, [100, 100, 100, 100]);
  assert.equal(r.seduta.blocchi[1].rec, 20);
  assert.equal(r.seduta.blocchi[2].rec, 30);
  assert.equal(r.seduta.totaleMetri, 900);
  assert.deepEqual(r.seduta.note, ['chiacchiere']);
  assert.ok(G.creaSedutaManuale(p, { data: '2026-11-05', durata: 45 }, []).errori.length >= 2);
  const sec = G.creaSedutaManuale(p, { data: '2026-11-05', tipo: 'secco', durata: 20, fatica: 2 }, []).seduta;
  assert.ok(G.validaSeduta(sec).ok);
  // test inserito a mano: aggiorna il passo e chiude la settimana di test
  const t = G.creaSedutaManuale(p, { data: '2026-11-18', tipo: 'vasca', durata: 40, fatica: 4, metri: 1000, tempoTest: '8:40' }, []).seduta;
  const dopo = G.generaSeduta(p, Object.assign({}, base, { data: '2026-11-20' }), [t]);
  assert.equal(dopo.passo100, 130);
  assert.notEqual(dopo.blocchi[1].tipo, 'test');
});

test('sedute manuali nella progressione (incompleta = saltata, livello mantenuto)', () => {
  const p = PROFILI.emanuele;
  const s1 = registrata('emanuele', '2026-10-28', 3);
  const s2 = registrata('emanuele', '2026-11-04', 2, { storico: [s1] });
  const s3 = registrata('emanuele', '2026-11-10', 3, { storico: [s1, s2] });
  s3.progressione = { livello: 2, ultimoAumento: '2026-11-01' };
  const m = (data, fatica, completata) => G.creaSedutaManuale(p, { data, tipo: 'vasca', durata: 45, fatica, metri: 1400, completata }, []).seduta;
  const ok = G.calcolaProgressione(p, [s1, s2, s3, m('2026-11-12', 2, true)], '2026-11-13');
  assert.equal(ok.livello, 2);
  assert.equal(ok.azione, 'mantieni');
  const no = G.calcolaProgressione(p, [s1, s2, s3, m('2026-11-12', 3, false)], '2026-11-13');
  assert.equal(no.azione, 'mantieni');
  assert.match(no.motivo, /pesante/);
});

test('riflessioni: segnali, negazioni ed effetti sulla seduta', () => {
  const p = PROFILI.emanuele;
  const conRifl = (testo, data = '2026-11-10') => {
    const s = registrata('emanuele', data, 3); s.riflessione = testo; return s;
  };
  const a = (t) => Object.keys(G.analizzaRiflessioni(p, [conRifl(t)], '2026-11-12').segnali).sort();
  assert.deepEqual(a('Mi faceva male la spalla destra nel pull.'), ['spalla']);
  assert.deepEqual(a('Nessun dolore alla spalla, tutto bene.'), []);
  assert.deepEqual(a('Crampi al polpaccio, e avevo il fiato corto'), ['gambe', 'respiro']);
  assert.deepEqual(a('Respirazione ok, mi sono divertito'), []);
  assert.deepEqual(a('Ginocchio dolorante a rana'), ['ginocchio']);
  // riflessione vecchia (> 10 giorni) ignorata
  assert.deepEqual(Object.keys(G.analizzaRiflessioni(p, [conRifl('male alla spalla', '2026-10-28')], '2026-11-12').segnali), []);

  const storico = [conRifl('Fastidio alla spalla sinistra')];
  for (let seed = 0; seed < 8; seed++) {
    const s = G.generaSeduta(p, Object.assign({}, base, { seed, durata: 60, attrezzi: { palette: true } }), storico);
    assert.ok(s.blocchi.every(b => !(b.attrezzi || []).includes('palette')));
    assert.ok(s.note.some(n => /riflessione del 10\/11/.test(n)));
    const sec = G.generaSeduta(p, Object.assign({}, base, { seed, tipo: 'secco', energia: 5 }), storico);
    assert.ok(sec.blocchi.every(b => b.esercizi.every(e => !/Push-up|Burpee/.test(e.nome))));
  }
  const senza = G.generaSeduta(p, Object.assign({}, base, { durata: 60 }), [registrata('emanuele', '2026-11-10', 3)]);
  const con = G.generaSeduta(p, Object.assign({}, base, { durata: 60 }), storico);
  assert.ok(con.blocchi[2].metri < senza.blocchi[2].metri, 'pull ridotto');
});

console.log(`\n${passati} test passati`);
