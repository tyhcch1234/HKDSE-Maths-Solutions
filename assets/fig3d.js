/* =========================================================================
   fig3d.js — small hand-rolled 3-D figure engine for the HKDSE solution pages.

   Usage:
     <script src="assets/fig3d.js"></script>
     <div class="stage"><canvas id="cv3d"></canvas></div>
     <div id="figui"></div>
     <script>
       var fig = Fig3D.mount('#cv3d', {
         v: { A:[0,0,0], B:[90,0,0], ... },        // cm, y is up
         faces: [['V','A','B'], ...],               // convex-ish shells for occlusion
         edges: [['A','B'], ...],                   // main wireframe
         ground: {x0:-110, x1:150, z0:-85, z1:70},
         view: {yaw:0.95, pitch:-0.32, zoom:1.04},
         presets: {front:{yaw:0,pitch:-0.1}, ...},
         labels: {A:'A', B:'B', Dp:'D′'},
         steps: { 1:[{t:'seg', a:'A', b:'C', c:'#8b5cf6', w:2.4, dash:[6,5]}], ... }
       });
     </script>

   No external library: perspective projection + orbit camera on a 2-D canvas.
   ========================================================================= */
(function () {
  'use strict';

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  var DEFAULT_VIEW = { yaw: 0.95, pitch: -0.30, zoom: 1.02 };
  var STEP_COLORS = {
    seg: '#f59e0b', angle: '#b45309', aux: '#8b5cf6', alt: '#10b981', grey: '#94a3b8'
  };

  function mount(target, scene) {
    var canvas = typeof target === 'string' ? document.querySelector(target) : target;
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');

    /* ---------- normalise the scene ---------- */
    var V = scene.v || {};
    var names = Object.keys(V);
    var pts = names.map(function (k) { return V[k]; });
    var CENTER = mul(pts.reduce(function (s, p) { return add(s, p); }, [0, 0, 0]), 1 / pts.length);
    var RADIUS = pts.reduce(function (m, p) { return Math.max(m, len(sub(p, CENTER))); }, 1);

    var faces = (scene.faces || []).map(function (f) {
      var keys = f.v || f;
      var n = [0, 0, 0], i, a, b;
      for (i = 0; i < keys.length; i++) {
        a = V[keys[i]]; b = V[keys[(i + 1) % keys.length]];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      n = unit(n);
      var c = mul(keys.reduce(function (s, k) { return add(s, V[k]); }, [0, 0, 0]), 1 / keys.length);
      if (dot(n, sub(c, CENTER)) < 0) n = mul(n, -1);
      var cfg = Array.isArray(f) ? {} : f;
      return { keys: keys, n: n, fill: cfg.fill || null, alpha: cfg.alpha };
    });

    function ref(x) {                       /* name or raw point */
      if (typeof x === 'string') return V[x];
      return x;
    }
    function edgeFaces(a, b) {
      var out = [];
      for (var i = 0; i < faces.length; i++) {
        var k = faces[i].keys;
        if (k.indexOf(a) >= 0 && k.indexOf(b) >= 0) out.push(i);
      }
      return out;
    }

    var edges = (scene.edges || []).map(function (e) {
      var a, b, cfg;
      if (typeof e === 'string') { var p = e.split('-'); a = p[0]; b = p[1]; cfg = {}; }
      else if (Array.isArray(e)) { a = e[0]; b = e[1]; cfg = {}; }
      else { a = e.a; b = e.b; cfg = e; }
      return {
        a: a, b: b, c: cfg.c || '#1e3a8a', w: cfg.w || 2.2, dash: cfg.dash || null,
        hidden: cfg.hidden, faces: edgeFaces(a, b)
      };
    });

    var st = {
      yaw: (scene.view || DEFAULT_VIEW).yaw, pitch: (scene.view || DEFAULT_VIEW).pitch,
      zoom: (scene.view || DEFAULT_VIEW).zoom, mode: scene.startStep || 0,
      ground: scene.ground !== false, spin: false, dpr: 1, w: 600, h: 560
    };
    var PRESETS = scene.presets || {
      front: { yaw: 0, pitch: -0.10, zoom: 1.04 },
      top: { yaw: 0.3, pitch: -1.18, zoom: 0.96 },
      side: { yaw: Math.PI / 2, pitch: -0.14, zoom: 1.06 }
    };
    var HOME = { yaw: st.yaw, pitch: st.pitch, zoom: st.zoom };

    /* ---------- sizing ---------- */
    function resize() {
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var cssW = Math.max(240, (rect && rect.width) || 600);
      var vh = (typeof window !== 'undefined' && window.innerHeight) || 900;
      var phone = ((typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200) <= 600;
      var ratio = scene.aspect || 0.9;
      var cssH = phone
        ? Math.min(Math.round(cssW * ratio), Math.max(200, Math.round(vh * 0.30)))
        : Math.min(Math.round(cssW * ratio), Math.max(240, vh - 250));
      var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
      st.w = cssW; st.h = cssH; st.dpr = dpr;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      draw();
    }

    function ts() { return Math.max(0.78, Math.min(1, st.w / 440)); }

    /* ---------- camera ---------- */
    function makeCam() {
      var dist = 3.6 * RADIUS / st.zoom;
      var baseF = 0.425 * Math.min(st.w, st.h) * 3.6;
      var cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      var cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
      function rot(v) {
        var x1 = v[0] * cy + v[2] * sy;
        var z1 = -v[0] * sy + v[2] * cy;
        return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
      }
      function raw(p) {
        var v = rot(sub(p, CENTER));
        var d = v[2] + dist;
        var s = baseF / Math.max(d, 1);
        return { x: st.w / 2 + v[0] * s, y: st.h / 2 - v[1] * s, d: d };
      }
      /* auto-fit: scale about the projected centre so the solid fills the frame,
         while st.zoom keeps working as a multiplier on top of that */
      var k = 1, bcx = st.w / 2, bcy = st.h / 2;
      if (scene.fit !== false) {
        var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, i, q;
        for (i = 0; i < pts.length; i++) {
          q = raw(pts[i]);
          minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
          miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
        }
        var bw = Math.max(maxx - minx, 1), bh = Math.max(maxy - miny, 1);
        k = clamp(Math.min(0.90 * st.w / bw, 0.86 * st.h / bh), 0.2, 4) * st.zoom;
        bcx = (minx + maxx) / 2; bcy = (miny + maxy) / 2;
      }
      function project(p) {
        var v = raw(p);
        return { x: st.w / 2 + (v.x - bcx) * k, y: st.h / 2 + (v.y - bcy) * k, d: v.d };
      }
      return { project: project, rot: rot, dist: dist, f: baseF * k };
    }

    /* ---------- primitives ---------- */
    function line3(cam, a, b, color, width, dash, alpha) {
      var p = cam.project(a), q = cam.project(b);
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.restore();
    }

    function poly3(cam, list, fill, stroke, width, dash) {
      var i, sp = [];
      for (i = 0; i < list.length; i++) sp.push(cam.project(list[i]));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sp[0].x, sp[0].y);
      for (i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) {
        ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.4; ctx.setLineDash(dash || []); ctx.stroke();
      }
      ctx.restore();
    }

    function path3(cam, list, color, width, dash, alpha) {
      if (!list || list.length < 2) return;
      var i, sp = cam.project(list[0]);
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
      for (i = 1; i < list.length; i++) { sp = cam.project(list[i]); ctx.lineTo(sp.x, sp.y); }
      ctx.stroke();
      ctx.restore();
    }

    function dot2(sp, color, r) {
      ctx.save();
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r * ts(), 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      ctx.restore();
    }

    function text2(x, y, str, color, size) {
      ctx.save();
      ctx.font = 'bold ' + ((size || 14) * ts()) + 'px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(255,255,255,0.96)'; ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color || '#0f172a';
      ctx.fillText(str, x, y);
      ctx.restore();
    }

    var NUDGE = {};   /* per-label angular twist, scene.labelsNudge */
    var nudgeIn = scene.labelsNudge || {};

    function labelPos(cam, key, dist) {
      var sp = cam.project(V[key]); var c = cam.project(CENTER);
      var ang = Math.atan2(sp.y - c.y, sp.x - c.x) + (nudgeIn[key] || 0);
      var d = (dist || 17) * ts();
      return { x: sp.x + Math.cos(ang) * d, y: sp.y + Math.sin(ang) * d };
    }

    function arcPoints(center, p1, p2, radius, steps) {
      var u = unit(sub(p1, center));
      var w = sub(p2, center);
      var perp = sub(w, mul(u, dot(w, u)));
      if (len(perp) < 1e-9) return [];
      perp = unit(perp);
      var total = Math.acos(clamp(dot(unit(w), u), -1, 1));
      var out = [], i, t;
      for (i = 0; i <= (steps || 28); i++) {
        t = total * i / (steps || 28);
        out.push(add(center, add(mul(u, radius * Math.cos(t)), mul(perp, radius * Math.sin(t)))));
      }
      return out;
    }

    function angleMark(cam, center, p1, p2, radius, color, label, labelGap) {
      var arc = arcPoints(center, p1, p2, radius, 30);
      if (!arc.length) return;
      path3(cam, arc, color, 1.9);
      if (label) {
        var mid = arc[Math.floor(arc.length / 2)];
        var c = cam.project(center), m = cam.project(mid);
        var dx = m.x - c.x, dy = m.y - c.y, l = Math.hypot(dx, dy) || 1;
        var gap = labelGap || 17;
        text2(m.x + dx / l * gap, m.y + dy / l * (gap - 4), label, color, 12.5);
      }
    }

    /* ---------- ground ---------- */
    function drawGround(cam) {
      var g = scene.groundOpt || {};
      var x0 = g.x0 == null ? -110 : g.x0, x1 = g.x1 == null ? 150 : g.x1;
      var z0 = g.z0 == null ? -85 : g.z0, z1 = g.z1 == null ? 70 : g.z1;
      poly3(cam, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 'rgba(148,163,184,0.08)');
      var i;
      for (i = x0 + 10; i < x1; i += (g.gx || 30)) line3(cam, [i, 0, z0], [i, 0, z1], 'rgba(148,163,184,0.20)', 1);
      for (i = z0 + 10; i < z1; i += (g.gz || 25)) line3(cam, [x0, 0, i], [x1, 0, i], 'rgba(148,163,184,0.20)', 1);
      poly3(cam, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], null, 'rgba(148,163,184,0.45)', 1.4, [8, 7]);
    }

    function drawFootprint(cam) {
      var list = (scene.footprint || names).map(function (k) { return [V[k][0], 0, V[k][2]]; });
      list.sort(function (a, b) { return a[0] - b[0] || a[2] - b[2]; });
      function cr(o, a, b) { return (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]); }
      var lower = [], upper = [], i;
      for (i = 0; i < list.length; i++) {
        while (lower.length > 1 && cr(lower[lower.length - 2], lower[lower.length - 1], list[i]) <= 0) lower.pop();
        lower.push(list[i]);
      }
      for (i = list.length - 1; i >= 0; i--) {
        while (upper.length > 1 && cr(upper[upper.length - 2], upper[upper.length - 1], list[i]) <= 0) upper.pop();
        upper.push(list[i]);
      }
      poly3(cam, lower.slice(0, -1).concat(upper.slice(0, -1)), 'rgba(15,23,42,0.07)');
    }

    /* ---------- frame ---------- */
    function draw() {
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      var bg = ctx.createLinearGradient(0, 0, 0, st.h);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#edf2fa');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, st.w, st.h);

      var cam = makeCam();
      var i;

      if (st.ground) { drawGround(cam); drawFootprint(cam); }

      var front = faces.map(function (f) { return cam.rot(f.n)[2] < 0; });
      function visible(e) {
        if (e.hidden === true) return false;
        if (e.hidden === false) return true;
        if (!e.faces.length) return true;
        for (var j = 0; j < e.faces.length; j++) if (front[e.faces[j]]) return true;
        return false;
      }

      for (i = 0; i < edges.length; i++) {
        if (!visible(edges[i])) line3(cam, V[edges[i].a], V[edges[i].b], '#ef4444', 1.6, [6, 5], 0.7);
      }

      var order = faces.map(function (f, idx) {
        var d = f.keys.reduce(function (s, k) { return s + cam.project(V[k]).d; }, 0) / f.keys.length;
        return { idx: idx, d: d };
      }).sort(function (a, b) { return b.d - a.d; });

      for (i = 0; i < order.length; i++) {
        var f = faces[order[i].idx];
        var nz = Math.abs(cam.rot(f.n)[2]);
        var a = f.alpha == null ? (0.045 + 0.13 * nz) : f.alpha;
        poly3(cam, f.keys.map(function (k) { return V[k]; }),
          f.fill || 'rgba(30,58,138,' + a.toFixed(3) + ')');
      }

      for (i = 0; i < edges.length; i++) {
        if (visible(edges[i])) line3(cam, V[edges[i].a], V[edges[i].b], edges[i].c, edges[i].w, edges[i].dash);
      }

      /* ---------- step annotations ---------- */
      var ops = (scene.steps && scene.steps[st.mode]) || [];
      for (i = 0; i < ops.length; i++) drawOp(cam, ops[i]);

      /* ---------- vertex labels ---------- */
      var labels = scene.labels || {};
      Object.keys(labels).forEach(function (k) {
        if (!V[k]) return;
        if (scene.labelSteps && scene.labelSteps[k] && st.mode < scene.labelSteps[k]) return;
        var col = scene.labelColor && scene.labelColor[k] || '#f59e0b';
        dot2(cam.project(V[k]), col, 4.4);
        var lp = labelPos(cam, k, scene.labelDist && scene.labelDist[k] || 17);
        text2(lp.x, lp.y, labels[k], '#0f172a', 15);
      });
    }

    function drawOp(cam, op) {
      var i;
      if (op.t === 'seg') {
        line3(cam, ref(op.a), ref(op.b), op.c || STEP_COLORS.seg, op.w || 2.6, op.dash, op.alpha);
      } else if (op.t === 'poly') {
        var list = (op.v || op.pts).map(ref);
        poly3(cam, list, op.fill, op.stroke, op.w, op.dash);
      } else if (op.t === 'path') {
        path3(cam, op.pts.map(ref), op.c || STEP_COLORS.seg, op.w || 2, op.dash);
      } else if (op.t === 'angle') {
        angleMark(cam, ref(op.at), ref(op.a), ref(op.b), op.r || 26,
          op.c || STEP_COLORS.angle, op.label, op.gap);
      } else if (op.t === 'ra') {
        var p = ref(op.at);
        var d1 = unit(sub(ref(op.a), p)), d2 = unit(sub(ref(op.b), p));
        var s = op.s || 8;
        path3(cam, [add(p, mul(d1, s)), add(p, add(mul(d1, s), mul(d2, s))), add(p, mul(d2, s))],
          op.c || STEP_COLORS.angle, 1.5);
      } else if (op.t === 'text') {
        var at = ref(op.at);
        var sp = cam.project(at);
        text2(sp.x + (op.dx || 0), sp.y + (op.dy || 0), op.text, op.c || STEP_COLORS.angle, op.size || 13);
      } else if (op.t === 'dot') {
        dot2(cam.project(ref(op.at)), op.c || '#f59e0b', op.r || 3.6);
      } else if (op.t === 'vlabel') {
        var lp = labelPos(cam, op.at, op.dist || 15);
        text2(lp.x, lp.y, op.text, op.c || STEP_COLORS.angle, op.size || 13);
      }
    }

    /* ---------- interaction ---------- */
    var drag = null, pointers = {};

    function onDown(e) {
      if (canvas.setPointerCapture && e.pointerId != null) canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      drag = { x: e.clientX, y: e.clientY };
      st.spin = false;
      if (canvas.style) canvas.style.cursor = 'grabbing';
      var b = document.getElementById('figspin'); if (b) b.classList.remove('on');
    }
    function onMove(e) {
      if (!pointers[e.pointerId]) return;
      var ids = Object.keys(pointers);
      if (ids.length > 1) {
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag && drag.pinch) { st.zoom = clamp(st.zoom * (d / drag.pinch), 0.55, 2.2); draw(); }
        drag = { x: e.clientX, y: e.clientY, pinch: d };
        return;
      }
      if (!drag) return;
      st.yaw -= (e.clientX - drag.x) * 0.0095;
      st.pitch = clamp(st.pitch + (e.clientY - drag.y) * 0.0075, -1.35, 1.35);
      drag = { x: e.clientX, y: e.clientY };
      draw();
    }
    function onUp(e) {
      delete pointers[e.pointerId];
      drag = null;
      if (canvas.style) canvas.style.cursor = 'grab';
    }
    function onWheel(e) {
      e.preventDefault();
      st.zoom = clamp(st.zoom * (e.deltaY > 0 ? 0.93 : 1.075), 0.55, 2.2);
      draw();
    }
    if (canvas.addEventListener) {
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('pointerleave', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('dblclick', function () { setView('home'); });
      if (canvas.style) { canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab'; }
    }

    var raf = null;
    function spinLoop() {
      if (!st.spin) { raf = null; return; }
      st.yaw += 0.006; draw();
      raf = requestAnimationFrame(spinLoop);
    }

    function setView(name) {
      var v = name === 'home' ? HOME : (PRESETS[name] || HOME);
      st.yaw = v.yaw; st.pitch = v.pitch; st.zoom = v.zoom || 1;
      draw();
    }
    function setMode(m) { if (st.mode !== m) { st.mode = m; draw(); } }
    function toggleSpin(on) {
      st.spin = on == null ? !st.spin : !!on;
      if (st.spin && !raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(spinLoop);
    }

    resize();
    var api = {
      faces: faces, edges: edges, center: CENTER, radius: RADIUS,
      state: st, draw: draw, resize: resize, setView: setView, setMode: setMode,
      toggleSpin: toggleSpin, scene: scene
    };

    /* ---------- small UI (toolbar + legend row) ---------- */
    var ui = document.getElementById('figui');
    if (ui && !ui.dataset.built) {
      ui.dataset.built = '1';
      ui.className = 'vbar';
      var views = [['home', 'Reset'], ['front', 'Front'], ['top', 'Top'], ['side', 'Side']];
      views.forEach(function (v) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = v[1];
        if (v[0] === 'home') b.className = 'on';
        b.addEventListener('click', function () {
          api.setView(v[0]);
          Array.prototype.forEach.call(ui.querySelectorAll('button[data-view]'), function (x) {
            x.classList.toggle('on', x === b);
          });
          document.getElementById('figspin') && document.getElementById('figspin').classList.remove('on');
          api.toggleSpin(false);
        });
        b.setAttribute('data-view', v[0]);
        ui.appendChild(b);
      });
      var sp = document.createElement('button');
      sp.type = 'button'; sp.id = 'figspin'; sp.textContent = 'Auto-spin';
      sp.addEventListener('click', function () {
        var on = !sp.classList.contains('on');
        sp.classList.toggle('on', on);
        api.toggleSpin(on);
      });
      ui.appendChild(sp);
      var gb = document.createElement('button');
      gb.type = 'button'; gb.id = 'figground'; gb.textContent = 'Ground';
      gb.className = st.ground ? 'on' : '';
      gb.addEventListener('click', function () {
        st.ground = !st.ground;
        gb.classList.toggle('on', st.ground);
        draw();
      });
      ui.appendChild(gb);
    }

    /* ---------- step sync ---------- */
    var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
    if (steps.length && 'IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var idx = steps.indexOf(en.target) + 1;
          var ds = en.target.getAttribute('data-step');
          api.setMode(ds ? parseInt(ds, 10) : idx);
          steps.forEach(function (s) { s.classList.toggle('active', s === en.target); });
        });
      }, { rootMargin: '-15% 0px -55% 0px', threshold: 0 });
      steps.forEach(function (s) { obs.observe(s); });
    }

    var rt = null;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(function () { api.resize(); }, 120);
      });
    }

    if (typeof window !== 'undefined') window.__fig = api;
    return api;
  }

  window.Fig3D = { mount: mount };
})();
