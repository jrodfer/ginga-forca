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
    return {
      coords, acc, km,
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
    } else {
      pena += 0.8 * r.carretera + 2 * r.escales;        // córrer lluny del trànsit, i sense escales
    }
    if (sessio.p === "pla" || sessio.p === "pista") pena += 0.05 * r.girsPerKm;   // trams seguits, pocs girs
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

  const api = {
    llegeixHash, caducada, dist, acumulada, desnivellPositiu, fraccions, resumeix, desnivellObjectiu, penalitza,
    millorPujada, gpx, indicacio, situa, properaManiobra, consultaPistes, pistes, b64url,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  arrel.Motor = api;
})(typeof window !== "undefined" ? window : globalThis);
