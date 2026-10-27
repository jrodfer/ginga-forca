// Música ambiental de les sessions tranquil·les (la pàgina d'apnea; el reproductor, si la sessió porta `mu`). Es fa
// al navegador amb Web Audio: quatre acords lents i suaus, un soroll d'onades i alguna campaneta, amb una mica de
// reverberació. Sense fitxers ni drets d'autor. La veu guia va per sobre: atenua(true) baixa la música mentre parla.
//
//   var m = GingaMusica(audioContext);   m.engega();   m.atenua(true|false);   m.atura();
(function (global) {
  "use strict";
  var ACORDS = [                                   // Re major: Dmaj9, Bm7, Gmaj7, Asus2 (Hz)
    [146.83, 220.00, 277.18, 329.63],
    [123.47, 185.00, 220.00, 293.66],
    [98.00, 146.83, 185.00, 246.94],
    [110.00, 164.81, 246.94, 329.63]
  ];
  var CAMPANETES = [587.33, 659.25, 739.99, 880.00, 987.77];     // pentatònica de Re
  var ACORD_S = 12, ENTRA_S = 5, SURT_S = 7, ENDAVANT_S = 40;      // cada acord, i quant se'n programa per endavant
  var VOLUM = 0.32, ATENUAT = 0.14;

  function reverb(ctx) {                           // una sala gran: soroll que s'apaga en 3,5 s
    var n = Math.floor(ctx.sampleRate * 3.5), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    }
    var cv = ctx.createConvolver(); cv.buffer = buf; return cv;
  }

  function GingaMusica(ctx) {
    var m = { sona: false }, nodes = [], fonts = [], idInterval = null, proper = 0, nAcord = 0, campana = 0;
    var mestre, filtre, sala, sec;

    function munta() {
      mestre = ctx.createGain(); mestre.gain.value = 0; mestre.connect(ctx.destination);
      sec = ctx.createGain(); sec.gain.value = 0.7; sec.connect(mestre);
      sala = reverb(ctx); var mull = ctx.createGain(); mull.gain.value = 0.55; sala.connect(mull); mull.connect(mestre);
      filtre = ctx.createBiquadFilter(); filtre.type = "lowpass"; filtre.frequency.value = 1100; filtre.Q.value = 0.4;
      filtre.connect(sec); filtre.connect(sala);
      var lfo = ctx.createOscillator(), prof = ctx.createGain();          // el filtre respira, molt a poc a poc
      lfo.frequency.value = 0.04; prof.gain.value = 350; lfo.connect(prof); prof.connect(filtre.frequency); lfo.start();
      nodes.push(mestre, sec, sala, mull, filtre, lfo, prof);
      onades();
    }

    function onades() {                            // soroll marró filtrat, que puja i baixa com l'onada
      var n = ctx.sampleRate * 6, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0), ultim = 0;
      for (var i = 0; i < n; i++) { ultim = (ultim + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = ultim * 3.5; }
      var font = ctx.createBufferSource(); font.buffer = buf; font.loop = true;
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 450;
      var g = ctx.createGain(); g.gain.value = 0.05;
      var lfo = ctx.createOscillator(), prof = ctx.createGain();
      lfo.frequency.value = 0.08; prof.gain.value = 0.04; lfo.connect(prof); prof.connect(g.gain);
      font.connect(f); f.connect(g); g.connect(sec); g.connect(sala);
      font.start(); lfo.start();
      nodes.push(font, f, g, lfo, prof);
    }

    function treu(osc) { var i = fonts.indexOf(osc); if (i >= 0) fonts.splice(i, 1); }

    function acord(t) {
      var notes = ACORDS[nAcord++ % ACORDS.length], fi = t + ACORD_S + SURT_S;
      notes.forEach(function (fr, k) {
        [["sine", 1], ["triangle", 1.004]].forEach(function (o) {
          var osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = o[0]; osc.frequency.value = fr * o[1];
          var pic = (o[0] === "sine" ? 0.06 : 0.025) * (k === 0 ? 1.2 : 1);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(pic, t + ENTRA_S);
          g.gain.setValueAtTime(pic, t + ACORD_S);
          g.gain.linearRampToValueAtTime(0, fi);
          osc.connect(g); g.connect(filtre);
          osc.start(t); osc.stop(fi + 0.1);
          fonts.push(osc);
          osc.onended = function () { g.disconnect(); treu(osc); };
        });
      });
    }

    function campaneta(t) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = CAMPANETES[Math.floor(Math.random() * CAMPANETES.length)];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      osc.connect(g); g.connect(sala); g.connect(sec);
      osc.start(t); osc.stop(t + 5.1);
      fonts.push(osc);
      osc.onended = function () { g.disconnect(); treu(osc); };
    }

    function programa() {                          // el que ve, fins a ENDAVANT_S (els temporitzadors van lents en segon pla)
      var fins = ctx.currentTime + ENDAVANT_S;
      while (proper < fins) { acord(proper); proper += ACORD_S; }
      while (campana < fins) { campaneta(campana); campana += 7 + Math.random() * 9; }
    }

    m.engega = function () {
      if (m.sona) return;
      m.sona = true;
      munta();
      proper = ctx.currentTime + 0.1; campana = proper + 4;
      programa();
      idInterval = setInterval(programa, 2000);
      mestre.gain.setValueAtTime(0, ctx.currentTime);
      mestre.gain.linearRampToValueAtTime(VOLUM, ctx.currentTime + 4);
    };
    m.atenua = function (si) {
      if (!m.sona) return;
      var g = mestre.gain, ara = ctx.currentTime;
      g.cancelScheduledValues(ara); g.setValueAtTime(g.value, ara);
      g.linearRampToValueAtTime(si ? ATENUAT : VOLUM, ara + (si ? 0.4 : 1.5));
    };
    m.atura = function (segons) {
      if (!m.sona) return;
      m.sona = false;
      clearInterval(idInterval);
      var s = segons == null ? 3 : segons, ara = ctx.currentTime, vells = nodes, velles = fonts;
      mestre.gain.cancelScheduledValues(ara); mestre.gain.setValueAtTime(mestre.gain.value, ara);
      mestre.gain.linearRampToValueAtTime(0, ara + s);
      nodes = []; fonts = [];
      setTimeout(function () {
        velles.concat(vells).forEach(function (n) {
          try { if (n.stop) n.stop(); } catch (err) {}
          try { n.disconnect(); } catch (err) {}
        });
      }, s * 1000 + 200);
    };
    return m;
  }

  global.GingaMusica = GingaMusica;
})(typeof window !== "undefined" ? window : this);
