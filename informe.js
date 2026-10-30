/* «Què no ha anat bé?»: l'informe de les pàgines de Ginga a l'entrenador, en beta (en Joan, 30/10/2026).

   Cada pàgina (força, estiraments, ioga, tècnica, apnea, àrea) el carrega al <head>, perquè el registre ho reculli
   tot des del principi, i el munta on vulgui:

     <script src="informe.js"></script>               (o ../informe.js)
     GingaInforme.munta({ modul: "força", on: element, clau: () => ({ k, g }) | null, context: () => ({ ... }) });

   L'atleta escriu què no ha anat bé (sense això no s'envia) i s'envia al Worker de formularis (config.json, POST
   /informe) amb el registre de la pàgina i el context que doni la pàgina. El Worker el desa i el workflow informes
   l'envia a l'entrenador (coach/informes.py). Si la pàgina té la clau signada de l'atleta (força, apnea, àrea), hi va
   perquè el Worker en desi el pseudònim; si no, és anònim.

   El registre: la pàgina, el navegador, els errors (també els vídeos i les imatges que no carreguen), els avisos i
   cada petició (el servei i el camí, l'estat i quant triga). Res del que va darrere del # ni del ?, que és on hi ha
   la sessió i les claus. Només a la memòria de la pàgina: no s'envia enlloc sol. Sota «Mostra el registre» es pot
   veure i copiar. La pàgina de rutes en té un de propi (web/rutes/), amb el seu Worker. */
(function (arrel) {
  "use strict";
  var MAX = 400, linies = [], t0 = Date.now(), cap = 0;
  var opcions = null, el = {};                       // les opcions de la pàgina i el formulari, quan es munta
  var script = document.currentScript, base = script ? script.src : location.href;
  var en = function () { return opcions && opcions.en != null ? !!opcions.en : /^en/.test(document.documentElement.lang || ""); };
  var T = {
    ca: { obre: "Alguna cosa no ha anat bé?", que: "Què no ha anat bé?",
      exemple: "P. ex.: el vídeo de la planxa no carrega, o el compte enrere s'ha aturat",
      envia: "Envia-ho a l'entrenador", enviant: "Enviant…", fet: "Enviat a l'entrenador. Gràcies, així ho arreglem!",
      falta: "Explica en una frase què no ha anat bé, i torna-hi.", error: "No s'ha pogut enviar. Torna-ho a provar d'aquí a una estona.",
      massa: "Avui ja n'has enviat molts: torna-hi demà.", registre: "Mostra el registre", copia: "Copia", copiat: "Copiat",
      ajuda: "Amb el teu text hi va aquest registre de la pàgina, perquè vegi què ha passat. No hi ha el teu nom." },
    en: { obre: "Something not working?", que: "What went wrong?",
      exemple: "E.g. the plank video doesn't load, or the countdown stopped",
      envia: "Send it to my coach", enviant: "Sending…", fet: "Sent to your coach. Thanks, this helps us fix it!",
      falta: "Tell us in a sentence what went wrong, then send it again.", error: "Couldn't send it. Please try again in a while.",
      massa: "You've sent a lot today: try again tomorrow.", registre: "Show the log", copia: "Copy", copiat: "Copied",
      ajuda: "Your text goes with this log of the page, so your coach can see what happened. Your name isn't in it." },
  };
  var t = function () { return en() ? T.en : T.ca; };

  // ---- el registre ----
  function reg() {
    var parts = Array.prototype.map.call(arguments, function (x) {
      return typeof x === "string" ? x : (function () { try { return JSON.stringify(x); } catch (e) { return String(x); } })();
    });
    linies.push(((Date.now() - t0) / 1000).toFixed(1) + "s " + parts.join(" "));
    if (linies.length > MAX) linies.splice(cap, linies.length - MAX);
    pinta();
  }
  /** Una URL sense el que va darrere del ? i del # (la sessió, les claus): el servei i el camí. */
  function net(url) {
    try { var u = new URL(String(url), location.href); return (u.host === location.host ? "" : u.host) + u.pathname; }
    catch (e) { return String(url).split(/[?#]/)[0]; }
  }
  reg("Ginga · " + net(location.href) + " · " + new Date().toISOString());
  reg("navegador: " + navigator.userAgent);
  reg("pantalla: " + innerWidth + "x" + innerHeight + " · idioma: " + (navigator.language || "?") +
      " · connexió: " + ((navigator.connection && navigator.connection.effectiveType) || "?"));
  cap = linies.length;

  if (arrel.fetch) {
    var fetchReal = arrel.fetch.bind(arrel);
    arrel.fetch = function (url, opts) {
      var que = (opts && opts.method || "GET") + " " + net(url && url.url ? url.url : url), ti = Date.now();
      return fetchReal(url, opts).then(function (r) {
        reg("←", que, r.status, (Date.now() - ti) + "ms");
        return r;
      }, function (e) {
        reg("✗", que, e && e.name === "AbortError" ? "temps esgotat" : String(e && e.message || e), (Date.now() - ti) + "ms");
        throw e;
      });
    };
  }
  ["error", "warn"].forEach(function (n) {
    var abans = console[n] && console[n].bind(console);
    if (!abans) return;
    console[n] = function () {
      reg.apply(null, [n].concat(Array.prototype.map.call(arguments, function (x) {
        return x instanceof Error ? x.name + ": " + x.message : String(x);
      })));
      abans.apply(null, arguments);
    };
  });
  // els errors de la pàgina, i (en captura) els vídeos, àudios i imatges que no carreguen
  arrel.addEventListener("error", function (e) {
    var el = e.target;
    if (el && el !== arrel && el.tagName) reg("no carrega:", el.tagName.toLowerCase(), net(el.currentSrc || el.src || ""));
    else reg("error de la pàgina:", e.message || "?", "línia " + (e.lineno || "?"));
  }, true);
  arrel.addEventListener("unhandledrejection", function (e) {
    reg("error sense recollir:", String(e.reason && e.reason.message || e.reason));
  });

  // ---- el formulari ----
  function pinta() {
    if (el.pre && el.registre && el.registre.open) el.pre.textContent = linies.join("\n");
  }
  var CSS = ".gi{margin:16px 0;padding:14px 16px;border:1px solid var(--line,#E3E4E1);border-radius:16px;" +
    "background:var(--card,transparent);color:var(--fg,inherit);text-align:left}" +
    ".gi summary{cursor:pointer;font-weight:700}.gi[open]>summary{margin-bottom:10px}" +
    ".gi label{display:block;font-weight:700;margin-bottom:6px}" +
    ".gi textarea{display:block;width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px 12px;border-radius:12px;" +
    "border:1px solid var(--line,#ccc);background:var(--bg,#fff);color:var(--fg,inherit);font:inherit;resize:vertical}" +
    ".gi textarea:focus{outline:2px solid var(--accent,#FF6A2B);outline-offset:1px}" +
    ".gi button{font:inherit;font-weight:700;padding:10px 16px;border-radius:999px;border:1px solid var(--line,#ccc);" +
    "background:var(--card,#fff);color:var(--fg,inherit);cursor:pointer}.gi button:disabled{opacity:.6}" +
    ".gi .gi-estat{margin:8px 0 0;color:var(--muted,#666)}.gi .gi-parany{position:absolute;left:-9999px}" +
    ".gi details{margin-top:12px}.gi details summary{font-weight:600;color:var(--muted,#666)}" +
    ".gi .gi-ajuda{color:var(--muted,#666);margin:0 0 8px}" +
    ".gi pre{margin:8px 0 0;max-height:40vh;overflow:auto;padding:8px;border-radius:8px;border:1px solid var(--line,#ccc);" +
    "font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}";

  function crea(tag, atributs, text) {
    var x = document.createElement(tag);
    Object.keys(atributs || {}).forEach(function (k) { x.setAttribute(k, atributs[k]); });
    if (text != null) x.textContent = text;
    return x;
  }

  function munta(o) {
    opcions = o || {};
    reg("mòdul: " + opcions.modul);
    if (!document.getElementById("gi-estil")) {
      var estil = crea("style", { id: "gi-estil" }); estil.textContent = CSS; document.head.appendChild(estil);
    }
    var tx = t(), caixa = crea("details", { "class": "gi", id: "gi" });
    caixa.appendChild(crea("summary", {}, tx.obre));
    el.label = crea("label", { "for": "gi-nota" }, tx.que);
    el.nota = crea("textarea", { id: "gi-nota", rows: "3", maxlength: "1000", placeholder: tx.exemple });
    el.parany = crea("input", { "class": "gi-parany", tabindex: "-1", autocomplete: "off", "aria-hidden": "true", name: "web" });
    el.boto = crea("button", { type: "button", id: "gi-envia" }, tx.envia);
    el.estat = crea("p", { "class": "gi-estat", id: "gi-estat", "aria-live": "polite", hidden: "" });
    el.registre = crea("details", {});
    el.registre.appendChild(crea("summary", {}, tx.registre));
    el.registre.appendChild(crea("p", { "class": "gi-ajuda" }, tx.ajuda));
    el.copia = crea("button", { type: "button" }, tx.copia);
    el.pre = crea("pre", { id: "gi-registre" });
    el.registre.appendChild(el.copia); el.registre.appendChild(el.pre);
    [el.label, el.nota, el.parany, el.boto, el.estat, el.registre].forEach(function (x) { caixa.appendChild(x); });
    (opcions.on || document.querySelector("main") || document.body).appendChild(caixa);
    el.registre.addEventListener("toggle", pinta);
    el.boto.addEventListener("click", envia);
    el.copia.addEventListener("click", function () {
      var fet = function () { el.copia.textContent = t().copiat; setTimeout(function () { el.copia.textContent = t().copia; }, 2000); };
      try { navigator.clipboard.writeText(linies.join("\n")).then(fet, function () {}); } catch (e) {}
    });
    return caixa;
  }

  function diu(text) { el.estat.textContent = text; el.estat.hidden = false; }

  function worker() {
    if (opcions.worker) return Promise.resolve(opcions.worker);
    return fetch(new URL("config.json", base).href, { cache: "no-store" })
      .then(function (r) { return r.json(); }).then(function (c) { return c.worker; });
  }

  function envia() {
    var tx = t(), nota = el.nota.value.trim();
    if (!nota) { el.nota.focus(); return diu(tx.falta); }
    var clau = null, context = {};
    try { clau = opcions.clau ? opcions.clau() : null; } catch (e) {}
    try { context = (opcions.context ? opcions.context() : {}) || {}; } catch (e) { reg("context:", String(e)); }
    var modul = typeof opcions.modul === "function" ? opcions.modul() : opcions.modul;
    reg("informe a l'entrenador", { modul: modul, context: context });
    el.boto.disabled = true; el.boto.textContent = tx.enviant;
    worker().then(function (w) {
      var cos = { modul: modul, nota: nota, registre: linies.join("\n"), context: context, pagina: net(location.href),
                  web: el.parany.value };
      if (clau && clau.k && clau.g) { cos.k = clau.k; cos.g = clau.g; }
      return fetch(String(w).replace(/\/$/, "") + "/informe", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(cos) });
    }).then(function (r) {
      if (r.status === 429) return diu(tx.massa);
      if (!r.ok) throw new Error("worker " + r.status);
      diu(tx.fet);
    }).catch(function (e) {
      reg("informe:", String(e && e.message || e));
      diu(tx.error);
    }).then(function () { el.boto.disabled = false; el.boto.textContent = t().envia; });
  }

  arrel.GingaInforme = { munta: munta, reg: reg, registre: function () { return linies.join("\n"); } };
})(window);
