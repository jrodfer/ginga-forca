/* La porta dels mòduls de Ginga: només hi entra qui té accés (en Joan, 30/10/2026: «no hauria de poder entrar als
   mòduls si no estic logat ni donat d'alta»).

   Cada pàgina d'atletes (força, ioga, apnea, tècnica, rutes) la carrega la primera cosa del <head>:

     <script src="../porta.js"></script>               (o porta.js, a l'arrel)

   i la pàgina queda amagada fins que es comprova que qui l'obre té una clau signada per Ginga, que el Worker
   verifica (mai només que n'hi hagi una):
     - la sessió de l'àrea de l'atleta (gingacoach.com/atleta/, entrar amb el correu i un codi), que el navegador
       recorda (localStorage «ginga-area») i val per a tots els mòduls;
     - o la clau de l'enllaç que obre: l'apnea personal (#k=<pseudònim>.apnea&g=...), una sessió de força amb la clau
       de la valoració (f.k, f.g dins del #) o una ruta signada (#<codi>.<signatura>, al Worker de rutes);
     - o una d'aquestes que ja s'hagi comprovat en aquest navegador (la preparació de l'apnea obre el reproductor
       sense clau: hi entra amb la de l'apnea).
   Sense cap clau bona, cap a l'àrea de l'atleta per entrar-hi, i en entrar torna aquí (?torna=).

   Sense connexió (al gimnàs, a mitja ruta): una clau comprovada els últims 30 dies obre la pàgina, i es torna a
   comprovar quan hi ha connexió. Només un «no» del Worker (400, 403) la tanca; un error de xarxa, no.

   Els fitxers de dades (sessions.json, els vídeos) són a GitHub Pages i es poden baixar igualment: la porta tanca
   les pàgines, no les dades. */
(function () {
  "use strict";
  if (!/^https?:$/.test(location.protocol)) return;   // obert com a fitxer (els tests): res
  var script = document.currentScript, base = script ? script.src : location.href;
  // La portada (gingacoach.com sense res darrere del #) porta a la web de Ginga, que és pública: aquí no es tanca.
  if (script && script.hasAttribute("data-portada") && location.hash.length < 2 && !/[?&]exemple(&|=|$)/.test(location.search)) return;
  var arrel = new URL("./", base).href;                // gingacoach.com/
  var AREA = "ginga-area", DESAT = "ginga-porta", DIES = 30, MAX = 8;
  var CLAU = /^[0-9a-f]{16}\.(area|apnea|\d{4}-\d{2}-\d{2}\.[A-Z])$/, SIG = /^[A-Za-z0-9_-]{43}$/;

  var html = document.documentElement;
  html.setAttribute("data-porta", "tancada");
  var estil = document.createElement("style");
  estil.textContent = 'html[data-porta="tancada"] body > :not(#ginga-porta) { display: none !important; }' +
    "#ginga-porta { max-width: 420px; margin: 18vh auto 0; padding: 0 16px; font: 16px/1.5 system-ui, sans-serif;" +
    " text-align: center; color: inherit; } #ginga-porta button { margin-top: 12px; font: inherit; padding: 8px 16px; }";
  (document.head || html).appendChild(estil);

  function llegeix(c) { try { return JSON.parse(localStorage.getItem(c) || "null"); } catch (e) { return null; } }
  function desa(c, v) { try { localStorage.setItem(c, JSON.stringify(v)); } catch (e) {} }
  function b64(s) { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); }
  function id(c) { return c.t === "r" ? "r:" + c.sig : c.k; }

  /** La clau que porta l'enllaç, si en porta: apnea o àrea (k, g), sessió de força (f) o ruta signada (codi.sig). */
  function delEnllac() {
    var h = (location.hash || "").slice(1);
    if (!h) return null;
    var p = new URLSearchParams(h), k = p.get("k") || "", g = p.get("g") || "";
    if (CLAU.test(k) && SIG.test(g)) return { t: "v", k: k, g: g };
    var parts = h.split(".");
    if (parts.length === 2 && SIG.test(parts[1])) return { t: "r", codi: parts[0], sig: parts[1] };
    try {
      var s = JSON.parse(b64(h)), f = s && s.f;
      if (f && CLAU.test(f.k || "") && SIG.test(f.g || "")) return { t: "v", k: f.k, g: f.g };
    } catch (e) {}
    return null;
  }

  var desades = (llegeix(DESAT) || []).filter(function (c) { return c && (c.t === "v" || c.t === "r"); });
  var area = llegeix(AREA), candidates = [];
  var propia = delEnllac();
  if (propia) candidates.push(propia);
  if (area && CLAU.test(area.k || "") && SIG.test(area.g || "")) candidates.push({ t: "v", k: area.k, g: area.g });
  desades.forEach(function (c) { candidates.push(c); });
  var vist = {};
  candidates = candidates.filter(function (c) { var i = id(c); if (vist[i]) return false; vist[i] = 1; return true; });

  function recorda(c) {               // la clau bona, la primera; les rutes llargues (rutes fixes) no es desen
    var llista = desades.filter(function (d) { return id(d) !== id(c); });
    if (c.t === "v" || c.codi.length <= 4000) llista.unshift({ t: c.t, k: c.k, g: c.g, codi: c.codi, sig: c.sig, ts: Date.now() });
    desades = llista.slice(0, MAX);
    desa(DESAT, desades);
  }
  function oblida(c) {
    desades = desades.filter(function (d) { return id(d) !== id(c); });
    desa(DESAT, desades);
  }
  function recent(c) {
    var d = desades.filter(function (x) { return id(x) === id(c); })[0];
    return d && Date.now() - (d.ts || 0) < DIES * 864e5;
  }

  var config = null;
  function workers() {
    if (!config) config = fetch(arrel + "config.json", { cache: "no-store" }).then(function (r) { return r.json(); });
    return config;
  }
  /** "si", "no" (el Worker diu que no és bona) o "?" (no s'ha pogut saber). */
  function comprova(c) {
    return workers().then(function (w) {
      if (c.t === "r") {
        if (!w.rutes) throw new Error("rutes");
        return fetch(w.rutes.replace(/\/?$/, "/"), { method: "POST", headers: { "content-type": "application/json" },
                                                     body: JSON.stringify({ porta: true, codi: c.codi, sig: c.sig }) });
      }
      return fetch(w.worker + "/porta?k=" + encodeURIComponent(c.k) + "&g=" + encodeURIComponent(c.g), { cache: "no-store" });
    }).then(function (r) {
      return r.ok ? "si" : r.status === 400 || r.status === 403 ? "no" : "?";
    }).catch(function () { return "?"; });
  }

  function obre() { html.removeAttribute("data-porta"); var e = document.getElementById("ginga-porta"); if (e) e.remove(); }
  function aEntrar() {
    location.replace(arrel + "atleta/?torna=" + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  function avis(text, torna) {
    var pinta = function () {
      var e = document.getElementById("ginga-porta");
      if (!e) { e = document.createElement("div"); e.id = "ginga-porta"; document.body.insertBefore(e, document.body.firstChild); }
      e.textContent = text;
      if (torna) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = "Torna-ho a provar";
        b.addEventListener("click", function () { location.reload(); });
        e.appendChild(document.createElement("br")); e.appendChild(b);
      }
    };
    if (document.body) pinta(); else document.addEventListener("DOMContentLoaded", pinta);
  }

  if (!candidates.length) return aEntrar();

  // Una clau comprovada fa poc obre de seguida (també sense connexió), i es torna a comprovar per darrere.
  var rapida = candidates.filter(recent)[0];
  if (rapida) {
    obre();
    comprova(rapida).then(function (r) {
      if (r === "si") recorda(rapida);
      else if (r === "no") { oblida(rapida); html.setAttribute("data-porta", "tancada"); aEntrar(); }
    });
    return;
  }

  avis("Un moment…");
  (function prova(i, dubte) {
    if (i >= candidates.length) {
      if (dubte) return avis("No s'ha pogut comprovar que hi tens accés. Mira la connexió i torna-ho a provar.", true);
      return aEntrar();
    }
    comprova(candidates[i]).then(function (r) {
      if (r === "si") { recorda(candidates[i]); return obre(); }
      if (r === "no") oblida(candidates[i]);
      prova(i + 1, dubte || r === "?");
    });
  })(0, false);
})();
