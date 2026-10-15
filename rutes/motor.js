/* Motor de la pàgina de rutes de Ginga: tot el que no és pantalla, perquè es pugui provar sol (prova.html).

   La sessió arriba a l'enllaç, després del #: "<codi>.<signatura>", amb el codi en base64 d'URL del JSON que fa
   coach/rutes.py (t nom, d data, v vàlid fins, l idioma, s run|ride, o perfil d'openrouteservice, k km, m minuts,
   p perfil: suau|pla|desnivell|pujades|pista, r repeticions, a desnivell [min, max]).
   Res d'això surt del navegador fora del proxy de rutes, que només en necessita el codi i la signatura. */

(function (arrel) {
  "use strict";

  // ---------- la sessió ----------

  function b64url(text) {
    const b = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /** {sessio, codi, sig} a partir del hash de l'URL, o null si no hi ha cap sessió llegible. */
  function llegeixHash(hash) {
    const net = (hash || "").replace(/^#/, "");
    if (!net) return null;
    const [codi, sig] = net.split(".");
    try {
      const sessio = JSON.parse(b64url(codi));
      if (!sessio || typeof sessio.k !== "number" || !sessio.p) return null;
      return { sessio, codi, sig: sig || "" };
    } catch (e) {
      return null;
    }
  }

  function caducada(sessio, avui) {
    return Boolean(sessio.v) && sessio.v < avui;
  }

  // ---------- geometria ----------

  const R_TERRA = 6371008.8;
  const rad = (g) => (g * Math.PI) / 180;

  /** Distància en metres entre dos punts [lon, lat]. */
  function dist(a, b) {
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Distància acumulada (m) a cada punt de la geometria. */
  function acumulada(coords) {
    const acc = [0];
    for (let i = 1; i < coords.length; i++) acc.push(acc[i - 1] + dist(coords[i - 1], coords[i]));
    return acc;
  }

  /** Desnivell positiu (m) d'una geometria amb altitud, filtrant el soroll de menys de `llindar` metres. */
  function desnivellPositiu(coords, llindar = 3) {
    let pujada = 0;
    let ref = coords.length && coords[0][2] != null ? coords[0][2] : null;
    for (const c of coords) {
      if (c[2] == null || ref == null) continue;
      if (c[2] - ref >= llindar) { pujada += c[2] - ref; ref = c[2]; }
      else if (ref - c[2] >= llindar) ref = c[2];
    }
    return pujada;
  }

  // ---------- puntuació ----------

  // Codis d'openrouteservice (extra_info). waytype: 1 carretera principal, 2 carretera, 3 carrer, 4 camí,
  // 5 pista, 6 carril bici, 7 vorera/camí de vianants, 8 escales, 9 ferri. surface: 1 pavimentat, 2 sense
  // pavimentar, 3 asfalt, 4 formigó... 8 i més: terra, grava, sorra, herba.
  const SURFACE_SENSE_PAVIMENTAR = new Set([2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18]);
  // Bici de carretera: 100% per carretera. Ni pistes, ni camins, ni voreres, ni escales, ni res sense asfaltar.
  const WAYTYPE_NO_CARRETERA = new Set([4, 5, 7, 8]);
  const MARGE_SORTIDA = 300;       // m del principi i del final que no compten: el carrer d'on surts (pot ser de vianants)

  /** Quins punts de la geometria són fora de carretera, i quants metres en fan (sense comptar la sortida). */
  function foraCarretera(coords, acc, extras) {
    const total = acc[acc.length - 1];
    const dolents = new Array(coords.length).fill(false);
    for (const [nom, dolent] of [["surface", SURFACE_SENSE_PAVIMENTAR], ["waytype", WAYTYPE_NO_CARRETERA]]) {
      const extra = extras[nom] || (nom === "waytype" ? extras.waytypes : null);
      for (const [ini, fi, valor] of (extra && extra.values) || []) {
        if (dolent.has(valor)) for (let i = ini; i < fi; i++) dolents[i] = true;
      }
    }
    let metres = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      if (acc[i] < MARGE_SORTIDA || acc[i] > total - MARGE_SORTIDA) dolents[i] = false;
      else if (dolents[i]) metres += acc[i + 1] - acc[i];
    }
    return { dolents, metres };
  }

  // Carreteres principals (molt trànsit), que la bici de carretera evita: la referència del nom ho diu millor que
  // el waytype d'openrouteservice, que marca la C-260 com a "carretera" igual que una GIV. Estat (N-, A-, AP-, E-)
  // i xarxa bàsica de la Generalitat (C-); les de les diputacions (GI-, GIV-, BV-...) i els antics trams (C-260z),
  // no. On no hi ha referència, el waytype 1 (carretera principal) d'openrouteservice.
  const REF_PRINCIPAL = /\b(?:N|A|AP|E|C)-(?:\d+|[IVX]+)\b(?![a-z])/;
  const TRAM_PRINCIPAL = 300;      // m seguits per una principal que ja es miren d'evitar (creuar-la o un tros curt, no)
  const CADA_EVITA_PRINCIPAL = 400;  // per tallar una carretera n'hi ha prou amb un punt de tant en tant

  /** Quins punts van per carretera principal; quants metres en fan; i quins són de trams llargs (> 300 m). */
  function perPrincipal(coords, acc, passos, waytype) {
    const total = acc[acc.length - 1];
    const principal = new Array(coords.length).fill(false);
    for (const pas of passos) {
      if (pas.way_points && REF_PRINCIPAL.test(pas.name || "")) for (let i = pas.way_points[0]; i < pas.way_points[1]; i++) principal[i] = true;
    }
    for (const [ini, fi, valor] of (waytype && waytype.values) || []) if (valor === 1) for (let i = ini; i < fi; i++) principal[i] = true;
    let metres = 0;
    const llarg = new Array(coords.length).fill(false);
    for (let i = 0; i < coords.length - 1;) {
      if (!principal[i]) { i++; continue; }
      let j = i;
      while (j < coords.length - 1 && principal[j]) j++;
      metres += acc[j] - acc[i];
      if (acc[j] - acc[i] > TRAM_PRINCIPAL) {
        for (let k = i; k < j; k++) if (acc[k] >= MARGE_SORTIDA && acc[k] <= total - MARGE_SORTIDA) llarg[k] = true;
      }
      i = j;
    }
    return { principal, metres, llarg };
  }

  /** Punts de pas per tornar a fer el circuit per on anava, sempre sobre trams bons (per a la reparació). */
  function puntsDePas(r, n = 5) {
    const total = r.acc[r.acc.length - 1];
    const via = [];
    for (let k = 1; k <= n; k++) {
      const objectiu = (total * k) / (n + 1);
      let millor = -1;
      for (let i = 0; i < r.coords.length; i++) {
        if (r.dolents[i] || r.principalLlarg[i]) continue;
        if (millor < 0 || Math.abs(r.acc[i] - objectiu) < Math.abs(r.acc[millor] - objectiu)) millor = i;
      }
      if (millor >= 0) via.push([r.coords[millor][0], r.coords[millor][1]]);
    }
    return via;
  }

  /**
   * Punts on el proxy posa una zona a evitar: un cada `cada` metres sobre els trams fora de carretera, i un cada
   * 400 m sobre els trams llargs per carretera principal. Primer els de terra, que són obligatoris.
   */
  function puntsAEvitar(r, cada = 60, ambPrincipals = true) {
    const punts = [];
    const mascares = [[r.dolents, cada]].concat(ambPrincipals ? [[r.principalLlarg || [], CADA_EVITA_PRINCIPAL]] : []);
    for (const [mascara, pas] of mascares) {
      let ultim = -Infinity;
      for (let i = 0; i < r.coords.length; i++) {
        if (mascara[i] && r.acc[i] - ultim >= pas) { punts.push([r.coords[i][0], r.coords[i][1]]); ultim = r.acc[i]; }
      }
    }
    return punts;
  }

  /** La sessió és de bici de carretera (i, per tant, el circuit ha de ser 100% per carretera). */
  function esCarretera(sessio) {
    return sessio.s === "ride" && sessio.o === "cycling-road";
  }

  /** Fracció de la ruta (0-1) amb cada valor d'un extra d'openrouteservice. */
  function fraccions(extra, acc) {
    const total = acc[acc.length - 1] || 1;
    const f = {};
    for (const [ini, fi, valor] of (extra && extra.values) || []) {
      f[valor] = (f[valor] || 0) + (acc[fi] - acc[ini]) / total;
    }
    return f;
  }

  /** Resum d'una ruta d'openrouteservice (una Feature de GeoJSON), en les unitats que ensenyem. */
  function resumeix(feature) {
    const coords = feature.geometry.coordinates;
    const acc = acumulada(coords);
    const p = feature.properties || {};
    const extras = p.extras || {};
    const km = (p.summary && p.summary.distance ? p.summary.distance : acc[acc.length - 1]) / 1000;
    const surface = fraccions(extras.surface, acc);
    const waytype = fraccions(extras.waytype || extras.waytypes, acc);   // el nom va canviar a ORS 9
    const passos = ((p.segments || [])[0] || {}).steps || [];
    let senseAsfalt = 0;
    for (const [v, x] of Object.entries(surface)) if (SURFACE_SENSE_PAVIMENTAR.has(Number(v))) senseAsfalt += x;
    const fora = foraCarretera(coords, acc, extras);
    const princ = perPrincipal(coords, acc, passos, extras.waytype || extras.waytypes);
    return {
      coords, acc, km,
      dolents: fora.dolents, foraCarretera: fora.metres,
      principal: princ.metres / (acc[acc.length - 1] || 1), principalLlarg: princ.llarg,
      tramsPrincipals: princ.llarg.some(Boolean),
      desnivell: p.ascent != null ? p.ascent : desnivellPositiu(coords),
      senseAsfalt,
      carretera: (waytype[1] || 0) + (waytype[2] || 0),
      camins: (waytype[4] || 0) + (waytype[5] || 0) + (waytype[7] || 0) + (waytype[8] || 0),
      escales: waytype[8] || 0,
      girsPerKm: passos.filter((s) => s.type <= 9 && s.type !== 6).length / Math.max(km, 0.1),
      passos,
    };
  }

  /** Desnivell que busquem (m), segons la sessió. */
  function desnivellObjectiu(sessio) {
    if (sessio.a) return [sessio.a[0], sessio.a[1]];
    const perKm = { suau: [0, 10], pla: [0, 5], pista: [0, 5], desnivell: [15, 30], pujades: [8, 30] }[sessio.p];
    const bici = sessio.s === "ride" ? 0.6 : 1;          // en bici, el mateix desnivell pesa menys per km
    return [perKm[0] * sessio.k * bici, perKm[1] * sessio.k * bici];
  }

  /** Penalització (més baixa, millor) d'una ruta per a la sessió. */
  function penalitza(r, sessio) {
    const errKm = Math.abs(r.km - sessio.k) / sessio.k;
    const [dMin, dMax] = desnivellObjectiu(sessio);
    const fora = r.desnivell < dMin ? dMin - r.desnivell : r.desnivell > dMax ? r.desnivell - dMax : 0;
    let pena = 3 * errKm + fora / Math.max(dMax, 50);
    if (sessio.s === "ride") {
      pena += (sessio.o === "cycling-road" ? 3 : 0.5) * r.senseAsfalt + (sessio.o === "cycling-road" ? 1.5 : 0) * r.camins;
      if (sessio.o === "cycling-road") pena += 4 * (r.principal || 0);   // millor per carreteres locals que per una C- o N-
    } else {
      pena += 0.8 * r.carretera + 2 * r.escales;        // córrer lluny del trànsit, i sense escales
    }
    if (sessio.p === "pla" || sessio.p === "pista") pena += 0.05 * r.girsPerKm;   // trams seguits, pocs girs
    // per on va la gent: a peu, cada 10% més de circuit per rutes, parcs i passejos compensa un 3% de desviació
    // dels km; en bici de carretera, un 2% (allà mana més no anar per carreteres principals)
    if (r.gent != null) pena += (sessio.s === "run" ? 1 : sessio.o === "cycling-road" ? 0.6 : 0.8) * (1 - r.gent);
    return pena;
  }

  // ---------- pujades ----------

  /** El tram en pujada que millor encaixa amb les repeticions: llargada r.m metres i pendent r.g [min, max] %. */
  function millorPujada(coords, acc, rep) {
    if (!rep || !rep.m || coords.length < 2 || coords[0][2] == null) return null;
    const objectiu = Math.max(rep.m, 80);
    const [gMin, gMax] = rep.g || [5, 8];
    let millor = null;
    for (let i = 0, j = 0; i < coords.length; i++) {
      while (j < coords.length - 1 && acc[j] - acc[i] < objectiu) j++;
      const llarg = acc[j] - acc[i];
      if (llarg < objectiu * 0.7) break;
      const pendent = (100 * (coords[j][2] - coords[i][2])) / llarg;
      if (pendent <= 2) continue;
      const fora = pendent < gMin ? gMin - pendent : pendent > gMax ? pendent - gMax : 0;
      const pena = fora + Math.abs(llarg - objectiu) / objectiu;
      if (!millor || pena < millor.pena) millor = { ini: i, fi: j, llarg, pendent, aKm: acc[i] / 1000, pena };
    }
    return millor;
  }

  // ---------- GPX ----------

  const esc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

  /** Un GPX de traça (el que importen Garmin Connect, Coros, Suunto, Polar, Wahoo, WorkOutDoors...). */
  function gpx(nom, coords) {
    const punts = coords.map((c) =>
      `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ""}</trkpt>`
    ).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ginga" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(nom)}</name></metadata>
<trk><name>${esc(nom)}</name><trkseg>
${punts}
</trkseg></trk>
</gpx>
`;
  }

  // ---------- indicacions ----------

  // Tipus de pas d'openrouteservice -> text. Les fem nosaltres perquè openrouteservice no parla català.
  const GIRS = {
    ca: ["Gira a l'esquerra", "Gira a la dreta", "Gira tancat a l'esquerra", "Gira tancat a la dreta",
      "Gira lleugerament a l'esquerra", "Gira lleugerament a la dreta", "Continua recte", "A la rotonda, pren la sortida {n}",
      "Surt de la rotonda", "Fes mitja volta", "Ja hi ets: final del recorregut", "Surt", "Mantén-te a l'esquerra", "Mantén-te a la dreta"],
    en: ["Turn left", "Turn right", "Turn sharp left", "Turn sharp right", "Turn slightly left", "Turn slightly right",
      "Continue straight", "At the roundabout, take exit {n}", "Exit the roundabout", "Make a U-turn",
      "You're there: end of the route", "Head out", "Keep left", "Keep right"],
  };

  function indicacio(pas, idioma) {
    const textos = GIRS[idioma] || GIRS.ca;
    let t = (textos[pas.type] || textos[6]).replace("{n}", pas.exit_number || "");
    const via = pas.name && pas.name !== "-" ? pas.name : "";
    if (via && pas.type <= 9 && pas.type !== 8) t += (idioma === "en" ? " onto " : " per ") + via;
    return t;
  }

  // ---------- seguiment ----------

  /** Projecció d'un punt [lon, lat] sobre el segment a-b, en metres aproximats al voltant de la latitud. */
  function projecta(p, a, b) {
    const kx = 111320 * Math.cos(rad(p[1]));
    const ky = 110540;
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    return { t, d: Math.hypot(x, y) };
  }

  /**
   * On és l'atleta sobre la ruta: el segment més proper, buscant endavant des de l'últim (un circuit es pot
   * creuar amb ell mateix i no volem saltar al tros de tornada). {i, fet (m), fora (m)}.
   */
  function situa(pos, coords, acc, darrer = 0, finestra = 1500) {
    let millor = null;
    const des = Math.max(0, darrer - 2);
    for (let i = des; i < coords.length - 1 && acc[i] - acc[des] <= finestra; i++) {
      const pr = projecta(pos, coords[i], coords[i + 1]);
      if (!millor || pr.d < millor.fora) millor = { i, fet: acc[i] + pr.t * (acc[i + 1] - acc[i]), fora: pr.d };
    }
    if (!millor || millor.fora > 150) {               // perdut: busca a tota la ruta
      for (let i = 0; i < coords.length - 1; i++) {
        const pr = projecta(pos, coords[i], coords[i + 1]);
        if (!millor || pr.d < millor.fora) millor = { i, fet: acc[i] + pr.t * (acc[i + 1] - acc[i]), fora: pr.d };
      }
    }
    return millor;
  }

  /** La pròxima maniobra després del punt i: {pas, falten (m)}, o null si no en queda cap. */
  function properaManiobra(passos, acc, i, fet) {
    for (const pas of passos) {
      const ini = pas.way_points ? pas.way_points[0] : 0;
      if (ini > i && pas.type !== 11 && pas.type !== 6) return { pas, falten: acc[ini] - fet };
    }
    return null;
  }

  // ---------- pistes d'atletisme (Overpass) ----------

  function consultaPistes(lat, lon, radi = 20000) {
    return `[out:json][timeout:25];
(
  way["leisure"="track"]["sport"~"athletics|running"](around:${radi},${lat},${lon});
  relation["leisure"="track"]["sport"~"athletics|running"](around:${radi},${lat},${lon});
  way["leisure"~"sports_centre|stadium"]["sport"~"athletics"](around:${radi},${lat},${lon});
);
out center tags;`;
  }

  /** Les pistes d'una resposta d'Overpass, de la més propera a la més llunyana. */
  function pistes(resposta, lat, lon, idioma) {
    const vistes = [];
    for (const el of (resposta && resposta.elements) || []) {
      const c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
      if (!c) continue;
      const t = el.tags || {};
      // una pista de 400 m és un oval; molts estadis tenen el centre i la pista com a elements separats
      if (vistes.some((v) => dist([v.lon, v.lat], [c.lon, c.lat]) < 250)) continue;
      vistes.push({
        lat: c.lat, lon: c.lon,
        nom: t.name || t["name:" + idioma] || (t.leisure === "track" ? (idioma === "en" ? "Athletics track" : "Pista d'atletisme")
          : (idioma === "en" ? "Athletics stadium" : "Estadi d'atletisme")),
        acces: t.access || "",
        m: dist([lon, lat], [c.lon, c.lat]),
      });
    }
    return vistes.sort((a, b) => a.m - b.m);
  }

  // ---------- per on va la gent (Overpass) ----------
  // Strava i Garmin no deixen fer servir els seus mapes de calor. El més semblant en dades obertes: rutes
  // senyalitzades (vies verdes, rutes ciclistes, senders), i per córrer, també parcs i passejos. Els carrers de
  // vianants i els carrils bici de ciutat no: a Barcelona en són milers (8 MB) i no és on es corre.

  /** Radi (m) on buscar per on va la gent: fins on s'allunya un circuit de k km (~k/π), amb un límit. */
  function radiGent(sessio) {
    return Math.round(Math.min(sessio.k * 1000 / 3, sessio.s === "ride" ? 25000 : 8000));
  }

  function consultaGent(lat, lon, radi, sessio) {
    const a = `(around:${radi},${lat},${lon})`;
    if (sessio.s === "ride") {
      const rutes = sessio.o === "cycling-road" ? "bicycle" : "bicycle|mtb";
      return `[out:json][timeout:25];
relation["route"~"^(${rutes})$"]${a}->.rutes;
way(r.rutes)${a};
out ids geom qt;`;
    }
    // A peu, de les rutes ciclistes només els trams que no són carrer (vies verdes, Pirinexus), i dels carrers
    // només els que es diuen passeig, rambla... sense les voreres. Barcelona passa de 4,5 MB a menys de la meitat.
    return `[out:json][timeout:25];
relation["route"~"^(foot|hiking|running|fitness_trail)$"]${a}->.senders;
relation["route"="bicycle"]["network"~"^(icn|ncn|rcn)$"]${a}->.bici;
(
  way(r.senders)${a};
  way(r.bici)["highway"~"^(path|track|cycleway|footway)$"]${a};
  way["highway"~"^(pedestrian|footway|path|cycleway)$"]["name"~"^(Passeig|Rambla|Via Verda|Ruta|Sender|Paseo|Senda)",i]["footway"!~"^(sidewalk|crossing)$"]${a};
  way["leisure"="track"]${a};
);
out ids geom qt;
way["leisure"="park"]${a};
out tags geom qt;`;
  }

  /** {l: línies, p: parcs}, cadascun una llista de [lon, lat, lon, lat...] (compacte, per desar-lo). */
  function llegeixGent(resposta) {
    const gent = { l: [], p: [] };
    for (const el of (resposta && resposta.elements) || []) {
      if (!el.geometry || el.geometry.length < 2) continue;
      const pla = [];
      for (const g of el.geometry) if (g) pla.push(Math.round(g.lon * 1e5) / 1e5, Math.round(g.lat * 1e5) / 1e5);
      (el.tags && el.tags.leisure === "park" && el.geometry.length >= 4 ? gent.p : gent.l).push(pla);
    }
    return gent;
  }

  const CEL = 0.002;               // graus: cel·les d'uns 200 m per trobar ràpid els trams a prop d'un punt

  /** Índex per cel·les dels trams i parcs, per a perOnVaLaGent. */
  function indexGent(gent) {
    const cel = new Map();
    for (const l of gent.l) {
      for (let i = 0; i + 3 < l.length; i += 2) {
        const tram = [l[i], l[i + 1], l[i + 2], l[i + 3]];
        const x0 = Math.floor(Math.min(tram[0], tram[2]) / CEL), x1 = Math.floor(Math.max(tram[0], tram[2]) / CEL);
        const y0 = Math.floor(Math.min(tram[1], tram[3]) / CEL), y1 = Math.floor(Math.max(tram[1], tram[3]) / CEL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = x + "," + y;
          if (!cel.has(k)) cel.set(k, []);
          cel.get(k).push(tram);
        }
      }
    }
    const parcs = gent.p.map((p) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      return { p, x0, x1, y0, y1 };
    });
    return { cel, parcs, buit: !gent.l.length && !gent.p.length };
  }

  function dinsParc(pt, parc) {
    if (pt[0] < parc.x0 || pt[0] > parc.x1 || pt[1] < parc.y0 || pt[1] > parc.y1) return false;
    let dins = false;
    const p = parc.p;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      if ((p[i + 1] > pt[1]) !== (p[j + 1] > pt[1]) && pt[0] < ((p[j] - p[i]) * (pt[1] - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) dins = !dins;
    }
    return dins;
  }

  const A_PROP_GENT = 15;          // m: la ruta i el tram surten del mateix mapa, o sigui que coincideixen
  const CADA_GENT = 25;            // m entre punts de mostra

  /** Fracció de la ruta (0-1) que passa per on va la gent, o null si no hi ha dades. */
  function perOnVaLaGent(coords, acc, idx) {
    if (!idx || coords.length < 2) return null;
    const total = acc[acc.length - 1];
    if (!total) return null;
    let mostres = 0, si = 0;
    for (let i = 0, m = 0; m <= total; m += CADA_GENT) {
      while (i < coords.length - 2 && acc[i + 1] < m) i++;
      const f = acc[i + 1] > acc[i] ? (m - acc[i]) / (acc[i + 1] - acc[i]) : 0;
      const pt = [coords[i][0] + f * (coords[i + 1][0] - coords[i][0]), coords[i][1] + f * (coords[i + 1][1] - coords[i][1])];
      mostres++;
      if (aPropDeGent(pt, idx)) si++;
    }
    return si / mostres;
  }

  function aPropDeGent(pt, idx) {
    const cx = Math.floor(pt[0] / CEL), cy = Math.floor(pt[1] / CEL);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const t of idx.cel.get(x + "," + y) || []) {
        if (projecta(pt, [t[0], t[1]], [t[2], t[3]]).d <= A_PROP_GENT) return true;
      }
    }
    return idx.parcs.some((parc) => dinsParc(pt, parc));
  }

  const api = {
    llegeixHash, caducada, dist, acumulada, desnivellPositiu, fraccions, resumeix, desnivellObjectiu, penalitza,
    millorPujada, gpx, indicacio, situa, properaManiobra, consultaPistes, pistes, b64url,
    foraCarretera, perPrincipal, puntsDePas, puntsAEvitar, esCarretera,
    radiGent, consultaGent, llegeixGent, indexGent, perOnVaLaGent,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  arrel.Motor = api;
})(typeof window !== "undefined" ? window : globalThis);
