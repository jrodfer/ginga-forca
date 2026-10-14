/* Motor d'una sessió de força: sèries, temps de feina, descansos i pas d'exercici, sense res de pantalla.
 *
 * El fan servir el mòbil (index.html) i la tele (tele.html). Mana qui té el motor en marxa: el mòbil quan
 * no s'emet, la tele quan s'emet (així el comandament de la tele funciona encara que el mòbil s'adormi).
 * Cada canvi crida hooks.canvi(foto) amb la foto de l'estat, que és el que es pinta i el que viatja.
 */
(function (global) {
  "use strict";
  var CANVI_COSTAT = 5;   // segons per canviar de costat en els exercicis de temps

  function mmss(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function quantitat(e) {
    if (e.u === "r") return { num: String(e.q), unitat: e.c ? "reps per costat" : "reps" };
    if (e.q >= 60 && e.q % 60 === 0) return { num: (e.q / 60) + "'", unitat: e.c ? "minuts per costat" : "minuts" };
    return { num: e.q + "\"", unitat: e.c ? "segons per costat" : "segons" };
  }
  function pauta(e) { var q = quantitat(e); return (e.s > 1 ? e.s + "×" : "") + q.num + (e.c ? " /costat" : ""); }
  function zeros(sessio) { return sessio.e.map(function () { return 0; }); }

  function Motor(sessio, inicial, hooks) {
    var m = this;
    m.sessio = sessio;
    m.hooks = hooks || {};
    inicial = inicial || {};
    m.fetes = inicial.fetes && inicial.fetes.length === sessio.e.length ? inicial.fetes.slice() : zeros(sessio);
    m.i = Math.min(Math.max(inicial.i || 0, 0), sessio.e.length - 1);
    m.vista = "resum"; m.fase = "serie"; m.text = ""; m.seguentTxt = "";
    m.temps = null;                       // { fi, total, avisat, enAcabar }
    m.id = setInterval(function () { m._tick(); }, 200);
  }
  var P = Motor.prototype;

  P.foto = function () {
    var t = this.temps;
    return { tipus: "estat", i: this.i, fetes: this.fetes.slice(), vista: this.vista, fase: this.fase,
             text: this.text, seguent: this.seguentTxt,
             queda: t ? Math.max(0, (t.fi - Date.now()) / 1000) : null, total: t ? t.total : null };
  };
  P._avisa = function () { if (this.hooks.canvi) this.hooks.canvi(this.foto()); };
  P._xiula = function (n) { if (this.hooks.xiulet) this.hooks.xiulet(n); };
  P.atura = function () { clearInterval(this.id); this.temps = null; };

  // ---- temps
  P._tick = function () {
    var t = this.temps;
    if (!t) return;
    var q = (t.fi - Date.now()) / 1000;
    if (q <= 3.05 && !t.avisat && t.total > 5) { t.avisat = true; this._xiula(1); }
    if (q <= 0) { this.temps = null; t.enAcabar(); }
  };
  P._compta = function (segons, enAcabar) {
    this.temps = { fi: Date.now() + segons * 1000, total: segons, avisat: false, enAcabar: enAcabar };
  };

  // ---- fases
  P.obre = function (i) {
    this.temps = null; this.i = i; this.vista = "exercici"; this._serie();
  };
  P._serie = function () {
    var e = this.sessio.e[this.i];
    if (this.fetes[this.i] >= e.s) return this._seguentExercici();
    this.fase = "serie"; this.text = ""; this.seguentTxt = "";
    this._avisa();
  };
  P._feina = function () {
    var m = this, e = m.sessio.e[m.i];
    var textos = e.c ? ["Primer costat", "Canvia de costat", "Segon costat"] : ["Ara"];
    var durades = e.c ? [e.q, CANVI_COSTAT, e.q] : [e.q];
    var pas = 0;
    (function seguent() {
      m.fase = "feina"; m.text = textos[pas];
      m._compta(durades[pas], function () {
        pas++;
        if (pas < durades.length) { m._xiula(1); seguent(); } else { m._serieFeta(); }
      });
      m._avisa();
    })();
  };
  P._serieFeta = function () {
    var m = this, e = m.sessio.e[m.i];
    m.temps = null;
    m.fetes[m.i] = Math.min(e.s, m.fetes[m.i] + 1);
    var ultimaExercici = m.fetes[m.i] >= e.s;
    if (ultimaExercici && m.fetes.every(function (f, k) { return f >= m.sessio.e[k].s; })) { m._xiula(2); return m._final(); }
    if (!e.d) { m._xiula(2); return ultimaExercici ? m._seguentExercici() : m._serie(); }
    var proper = ultimaExercici ? m._properPendent() : m.i;
    var prox = m.sessio.e[proper];
    m.fase = "descans"; m.text = "";
    m.seguentTxt = ultimaExercici ? "Després: " + prox.n + " · " + pauta(prox)
                                  : "Després: sèrie " + (m.fetes[m.i] + 1) + " de " + e.s;
    m._compta(e.d, function () { m._xiula(2); ultimaExercici ? m._seguentExercici() : m._serie(); });
    m._avisa();
  };
  P._properPendent = function () {
    var m = this;
    var k = m.sessio.e.findIndex(function (e, j) { return j > m.i && m.fetes[j] < e.s; });
    if (k < 0) k = m.sessio.e.findIndex(function (e, j) { return m.fetes[j] < e.s; });
    return k;
  };
  P._seguentExercici = function () {
    var k = this._properPendent();
    if (k < 0) return this._final();
    this.obre(k);
  };
  P._final = function () { this.temps = null; this.vista = "final"; this.fase = "serie"; this._avisa(); };

  // ---- accions (els botons del mòbil i el comandament de la tele)
  P.comenca = function () {
    var m = this, k = m.sessio.e.findIndex(function (e, j) { return m.fetes[j] < e.s; });
    if (k < 0) { m.fetes = zeros(m.sessio); k = 0; }
    m.obre(k);
  };
  P.principal = function () {
    if (this.vista === "resum") return this.comenca();
    if (this.vista !== "exercici") return;
    if (this.fase === "descans") return this.salta();
    if (this.fase === "feina") return this._serieFeta();          // "Acaba ara"
    return this.sessio.e[this.i].u === "s" ? this._feina() : this._serieFeta();
  };
  P.salta = function () {
    var t = this.temps;
    if (!t) return;
    this.temps = null; t.enAcabar();
  };
  P.mes15 = function () {
    if (!this.temps || this.fase !== "descans") return;
    this.temps.fi += 15000; this.temps.total += 15; this._avisa();
  };
  P.seguent = function () {
    if (this.vista === "resum") return this.comenca();
    if (this.vista !== "exercici") return;
    if (this.fase === "descans") return this.salta();
    if (this.i < this.sessio.e.length - 1) this.obre(this.i + 1);
  };
  P.anterior = function () {
    if (this.vista === "exercici" && this.i > 0) this.obre(this.i - 1);
  };
  P.resum = function () { this.temps = null; this.vista = "resum"; this.fase = "serie"; this._avisa(); };
  P.reinicia = function () { this.fetes = zeros(this.sessio); this.i = 0; this.resum(); };
  P.accio = function (nom, arg) {
    if (nom === "obre" && typeof arg === "number" && arg >= 0 && arg < this.sessio.e.length) return this.obre(arg);
    if (["principal", "salta", "mes15", "seguent", "anterior", "resum", "reinicia", "comenca"].indexOf(nom) >= 0) this[nom]();
  };

  global.GingaMotor = { Motor: Motor, mmss: mmss, quantitat: quantitat, pauta: pauta };
})(window);
