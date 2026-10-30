/* Generador per popularitat Ginga: voltes noves pels trams per on més passa la gent, al navegador.

   La xarxa de cada regió i esport la prepara coach/voltes/web.py (web/rutes/voltes/<regió>-<esport>.json): els
   trams de l'esport (la carretera, només asfalt) amb la longitud, el desnivell i la popularitat (0-100, el percentil
   dels propietaris diferents de rutes de Garmin que hi passen). Aquí no hi arriba cap ruta ni cap propietari.

   Com es fa una volta (criteris propis, vegeu coach/voltes/README.md):
     - el cost d'un tram és la longitud x (1 + ALFA x (1 - popularitat)): un tram gens popular costa 1+ALFA vegades
       més que un de molt popular; un tram que la volta ja ha fet costa REPETIR vegades més (no es repeteix si hi ha
       una altra manera);
     - volta tancada: dos punts de pas en triangle amb la sortida, cap a una direcció (INTENTS direccions), ancorats
       a la cruïlla més popular del voltant; s'ajusta la mida fins que fa els km (com a molt AJUSTOS vegades);
     - anada i tornada: un punt de girada a mig camí, i tornar pel mateix lloc;
     - el trànsit (Motor.transitRef: 1 les N- i les C- de dues xifres, 0,15 les veïnals) encareix el tram x
       (1 + PES_TRANSIT x trànsit): no es descarta cap carretera, però una de petita guanya si n'hi ha (en Joan,
       30/10/2026: «que els hi doni menys punts»);
     - de totes les candidates, les millors per popularitat mitjana menys PES_TRANSIT_ORDRE x trànsit mitjà, prou
       diferents entre elles (DIFERENTS).
   El resum diu el % de km per trams populars (popularitat >= el llindar del fitxer) i si arriba a LLINDAR_QUALITAT. */

(function (arrel) {
  "use strict";
  const Motor = arrel.Motor || (typeof require !== "undefined" ? require("./motor.js") : null);

  const ALFA = 2;
  const PES_TRANSIT = 2;
  const PES_TRANSIT_ORDRE = 0.5;
  // sense referència al nom, pel tipus de via, com el waytype de Motor (TRANSIT_WAYTYPE): principal 1, carretera 0,15,
  // carrer 0,2, carril bici 0
  const TRANSIT_VIA = { trunk: 1, primary: 1, secondary: 0.15, tertiary: 0.15, unclassified: 0.15, road: 0.15,
    residential: 0.2, living_street: 0.2, service: 0.2, cycleway: 0 };
  const REPETIR = 20;
  const INTENTS = 16;
  const AJUSTOS = 4;
  const FACTOR_RUTA = 1.3;          // km per carretera / km en línia recta, per començar
  const DIFERENTS = 0.5;            // dues voltes amb més d'aquesta part de km en comú són la mateixa
  const REPETIT_MAX = 0.05;         // una volta tancada pot repetir com a molt aquesta part dels km
  const LLINDAR_QUALITAT = 0.5;     // part dels km per trams populars perquè la volta sigui "bona"
  const CEL = 0.01;                 // graus: cel·les de l'índex de nodes
  const R = 6371008.8;

  function metres(lat1, lon1, lat2, lon2) {
    const x = (lon2 - lon1) * Math.PI / 180 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return R * Math.hypot(x, (lat2 - lat1) * Math.PI / 180);
  }

  function desplaca(lat, lon, m, angle) {
    const dlat = m * Math.cos(angle) / R * 180 / Math.PI;
    const dlon = m * Math.sin(angle) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    return [lat + dlat, lon + dlon];
  }

  /** La xarxa del fitxer, a punt per buscar-hi camins. */
  function carrega(d) {
    const nn = d.n.length / 2, nt = d.t.length;
    const lat = new Float64Array(nn), lon = new Float64Array(nn);
    for (let k = 0; k < nn; k++) { lat[k] = d.n[2 * k] / 1e5; lon[k] = d.n[2 * k + 1] / 1e5; }
    const adj = Array.from({ length: nn }, () => []);
    const maxPop = new Float64Array(nn);
    d.t.forEach((t, i) => {
      adj[t[0]].push(i); adj[t[1]].push(i);
      maxPop[t[0]] = Math.max(maxPop[t[0]], t[5] / 100); maxPop[t[1]] = Math.max(maxPop[t[1]], t[5] / 100);
    });
    const transit = Float64Array.from(d.t, (t) => Motor.transitRef(t[8]) ?? TRANSIT_VIA[d.vies[t[7]]] ?? 0.15);
    const cel = new Map();
    for (let k = 0; k < nn; k++) {
      const c = `${Math.floor(lat[k] / CEL)},${Math.floor(lon[k] / CEL)}`;
      if (!cel.has(c)) cel.set(c, []);
      cel.get(c).push(k);
    }
    return { d, nn, nt, lat, lon, adj, maxPop, cel, transit, popular: (d.popular ?? 70) / 100, geoms: new Array(nt) };
  }

  /** Els nodes a menys de radi metres d'un punt. */
  function aprop(x, lat, lon, radi) {
    const out = [];
    const di = Math.ceil(radi / 111000 / CEL), dj = Math.ceil(radi / (111000 * Math.cos(lat * Math.PI / 180)) / CEL);
    const ci = Math.floor(lat / CEL), cj = Math.floor(lon / CEL);
    for (let i = ci - di; i <= ci + di; i++) for (let j = cj - dj; j <= cj + dj; j++)
      for (const k of x.cel.get(`${i},${j}`) || []) {
        const m = metres(lat, lon, x.lat[k], x.lon[k]);
        if (m <= radi) out.push([k, m]);
      }
    return out;
  }

  /** El node més proper (fins a 2 km), o null. */
  function mesProper(x, lat, lon) {
    let millor = null;
    for (const [k, m] of aprop(x, lat, lon, 2000)) if (!millor || m < millor[1]) millor = [k, m];
    return millor ? millor[0] : null;
  }

  /** La cruïlla més popular a prop d'un punt (si n'hi ha cap a menys de radi; si no, la més propera). */
  function ancora(x, lat, lon, radi) {
    let millor = null, valor = -1;
    for (const [k, m] of aprop(x, lat, lon, radi)) {
      const v = (x.maxPop[k] + 0.2) * (1 - 0.5 * m / radi);
      if (v > valor) { valor = v; millor = k; }
    }
    return millor ?? mesProper(x, lat, lon);
  }

  function pot(x, i, desDe) {
    const s = x.d.t[i][6];
    return !s || (s === 1) === (x.d.t[i][0] === desDe);
  }

  function cost(x, i, usats, evita) {
    if (evita.has(i)) return Infinity;
    const t = x.d.t[i];
    return t[2] * (1 + ALFA * (1 - t[5] / 100)) * (1 + PES_TRANSIT * x.transit[i]) * (usats.has(i) ? REPETIR : 1);
  }

  /** El camí més barat d'a a b (A*): [[tram, endavant], ...], o null. */
  function cami(x, a, b, usats, evita) {
    if (a === b) return [];
    const g = new Map([[a, 0]]), d_on = new Map(), tancats = new Set();
    const h = (k) => metres(x.lat[k], x.lon[k], x.lat[b], x.lon[b]);
    const cua = [[h(a), a]];
    const puja = (e) => { cua.push(e); let i = cua.length - 1; while (i) { const p = (i - 1) >> 1; if (cua[p][0] <= cua[i][0]) break; [cua[p], cua[i]] = [cua[i], cua[p]]; i = p; } };
    const treu = () => { const top = cua[0], fi = cua.pop(); if (cua.length) { cua[0] = fi; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < cua.length && cua[l][0] < cua[m][0]) m = l; if (r < cua.length && cua[r][0] < cua[m][0]) m = r; if (m === i) break; [cua[m], cua[i]] = [cua[i], cua[m]]; i = m; } } return top; };
    while (cua.length) {
      const [, n] = treu();
      if (tancats.has(n)) continue;
      if (n === b) break;
      tancats.add(n);
      for (const i of x.adj[n]) {
        if (!pot(x, i, n)) continue;
        const c = cost(x, i, usats, evita);
        if (c === Infinity) continue;
        const t = x.d.t[i], altre = t[0] === n ? t[1] : t[0];
        const nou = g.get(n) + c;
        if (nou < (g.get(altre) ?? Infinity)) { g.set(altre, nou); d_on.set(altre, [i, n]); puja([nou + h(altre), altre]); }
      }
    }
    if (!d_on.has(b)) return null;
    const out = [];
    for (let n = b; n !== a;) { const [i, p] = d_on.get(n); out.push([i, x.d.t[i][0] === p]); n = p; }
    return out.reverse();
  }

  /** Una volta que passa pels nodes en ordre (i torna al primer si tancada). */
  function perPunts(x, nodes, evita) {
    const usats = new Set(), trams = [];
    for (let k = 1; k < nodes.length; k++) {
      const c = cami(x, nodes[k - 1], nodes[k], usats, evita);
      if (!c) return null;
      c.forEach(([i]) => usats.add(i));
      trams.push(...c);
    }
    return trams;
  }

  function geom(x, i) {
    if (!x.geoms[i]) x.geoms[i] = Motor.llegeixPolilinia(x.d.t[i][9]);
    return x.geoms[i];
  }

  /** km, desnivell, popularitat i el traçat [lon, lat] d'una volta. */
  function resum(x, trams) {
    let m = 0, puja = 0, mPop = 0, popM = 0, rep = 0, trM = 0, mPrinc = 0;
    const vist = new Map(), noms = new Map(), coords = [];
    for (const [i, endavant] of trams) {
      const t = x.d.t[i];
      m += t[2]; puja += endavant ? t[3] : t[4]; popM += t[2] * t[5] / 100;
      if (t[5] / 100 >= x.popular) mPop += t[2];
      trM += t[2] * x.transit[i];
      if (x.transit[i] >= Motor.NIVELL_PRINCIPAL) mPrinc += t[2];
      if (vist.has(i)) rep += t[2];
      vist.set(i, true);
      if (t[8]) noms.set(t[8], (noms.get(t[8]) || 0) + t[2]);
      const g = endavant ? geom(x, i) : geom(x, i).slice().reverse();
      coords.push(...(coords.length ? g.slice(1) : g));
    }
    const principals = [...noms].filter(([, v]) => v >= 2000).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
    return { trams, coords, km: m / 1000, desnivell: Math.round(puja), popular: m ? mPop / m : 0,
      pop: m ? popM / m : 0, repetit: m ? rep / m : 0, transit: m ? trM / m : 0, principal: m ? mPrinc / m : 0,
      principals, bona: m > 0 && mPop / m >= LLINDAR_QUALITAT };
  }

  function comuns(x, a, b) {
    const sa = new Set(a.trams.map(([i]) => i));
    let m = 0, tot = 0;
    const sb = new Set(b.trams.map(([i]) => i));
    for (const i of new Set([...sa, ...sb])) { const l = x.d.t[i][2]; tot += l; if (sa.has(i) && sb.has(i)) m += l; }
    return tot ? m / tot : 0;
  }

  function llavor(n) {
    let s = n >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  /** Les voltes candidates. opcions: {sortida: [lat, lon], km, tolerancia (0.1), tipus ("volta" | "anada"),
   *  desnivell: [min, max] o null, passaPer: [[lat, lon]], evita: [[lat, lon]] (el tram més proper de cada punt),
   *  n (3), llavor, exclou: voltes ja ensenyades (no se'n torna cap de semblant)}. Torna {voltes, motiu}: motiu "fora" (la sortida no és a la xarxa), "cap" o null. */
  function genera(x, o) {
    const objectiu = o.km * 1000, tol = o.tolerancia ?? 0.1, aleat = llavor(o.llavor ?? 1);
    const s = mesProper(x, o.sortida[0], o.sortida[1]);
    if (s === null) return { voltes: [], motiu: "fora" };
    const evita = new Set();
    for (const p of o.evita || []) {
      const k = mesProper(x, p[0], p[1]);
      if (k !== null) for (const i of x.adj[k]) evita.add(i);
    }
    const pas = (o.passaPer || []).map((p) => mesProper(x, p[0], p[1])).filter((k) => k !== null);
    const cands = [];
    for (let k = 0; k < INTENTS; k++) {
      const angle = 2 * Math.PI * (k + aleat() * 0.5) / INTENTS;
      let costat = o.tipus === "anada" ? objectiu / 2 / FACTOR_RUTA : objectiu / 3 / FACTOR_RUTA;
      for (let ajust = 0; ajust < AJUSTOS; ajust++) {
        const p = (a) => { const q = desplaca(x.lat[s], x.lon[s], costat, a); return ancora(x, q[0], q[1], Math.max(300, costat / 4)); };
        const nodes = o.tipus === "anada" ? [s, ...pas, p(angle)] : [s, ...pas, p(angle - Math.PI / 6), p(angle + Math.PI / 6), s];
        let trams = perPunts(x, nodes, evita);
        if (!trams) break;
        if (o.tipus === "anada") trams = trams.concat(trams.slice().reverse().map(([i, e]) => [i, !e]));
        const r = resum(x, trams);
        if (!r.km) break;
        const ok = Math.abs(r.km * 1000 - objectiu) <= tol * objectiu;
        if (ok) {
          const dins = !o.desnivell || (r.desnivell >= (o.desnivell[0] ?? 0) && r.desnivell <= (o.desnivell[1] ?? Infinity));
          if (dins && (o.tipus === "anada" || r.repetit <= REPETIT_MAX)) cands.push(r);
          break;
        }
        costat *= Math.sqrt(objectiu / (r.km * 1000));
      }
    }
    const valor = (c) => c.pop - PES_TRANSIT_ORDRE * c.transit;
    cands.sort((a, b) => valor(b) - valor(a));
    const voltes = [];
    const ja = (o.exclou || []).concat(voltes);
    for (const c of cands) if (voltes.length < (o.n ?? 3) && ja.every((v) => comuns(x, v, c) < DIFERENTS)) { voltes.push(c); ja.push(c); }
    return { voltes, motiu: voltes.length ? null : "cap" };
  }

  /** La regió de l'índex (web/rutes/voltes/index.json) que cobreix un punt per a un esport, o null. */
  function regio(index, lat, lon, esport) {
    return (index.regions || []).find((r) => r.esport === esport
      && lat >= r.caixa[0] && lat <= r.caixa[2] && lon >= r.caixa[1] && lon <= r.caixa[3]) || null;
  }

  const api = { carrega, genera, resum, regio, mesProper, cami, LLINDAR_QUALITAT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  arrel.Voltes = api;
})(typeof window !== "undefined" ? window : globalThis);
