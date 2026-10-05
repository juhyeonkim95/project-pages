(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = window.DopplerModel, TAU = 2 * Math.PI;
  const blue = '#315d98', orange = '#ad652c', gray = '#4b515c';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const surfaceState = { wavelength: 1.55, height: 2, correlation: 3, seed: 9157 };
  let heights = M.surface(3, 9157);
  const motion = { angle: 45, normal: 2, tangent: 0, time: 0, playing: false };
  let visible = true, animation = null, lastTime = null;
  let spectrumData = null, spectrumBusy = false, spectrumStarted = false;
  if (window.renderMathInElement) renderMathInElement(document.querySelector('main'), {
    delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false, strict: 'warn',
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
  });
  function signed(value, digits = 3) {
    if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
    return (value < 0 ? '−' : '+') + Math.abs(value).toFixed(digits);
  }
  function frequency(value) {
    const n = Math.abs(value);
    if (n < 1e-10) return '0 Hz';
    const scale = n >= 1e6 ? 1e6 : n >= 1e3 ? 1e3 : 1;
    return signed(value / scale) + ' ' + (scale === 1e6 ? 'MHz' : scale === 1e3 ? 'kHz' : 'Hz');
  }
  function wavelength(value) {
    if (value >= 1e6) return +(value / 1e6).toFixed(3) + ' m';
    if (value >= 1e3) return +(value / 1e3).toFixed(3) + ' mm';
    return value.toFixed(2) + ' μm';
  }
  const tick = value => Math.abs(value) < 1e-9 ? '0' : String(+value.toPrecision(3)).replace('-', '−');
  function canvas(id) {
    const element = $(id), w = element.clientWidth, h = element.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) {
      element.width = Math.round(w * dpr); element.height = Math.round(h * dpr);
    }
    const ctx = element.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function line(ctx, x1, y1, x2, y2, color = '#d9dde4', width = 1, dash = []) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function dot(ctx, x, y, radius, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.3; ctx.stroke(); }
  }
  function text(ctx, value, x, y, color = gray, size = 11, align = 'left') {
    ctx.font = size + 'px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function arrow(ctx, x1, y1, x2, y2, color, width = 1.5) {
    if (Math.hypot(x2 - x1, y2 - y1) < 0.1) return;
    line(ctx, x1, y1, x2, y2, color, width);
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 6 * Math.cos(a - 0.45), y2 - 6 * Math.sin(a - 0.45));
    ctx.lineTo(x2 - 6 * Math.cos(a + 0.45), y2 - 6 * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function axes(ctx, w, h, xmin, xmax, ymin, ymax, xlabel, ylabel) {
    const left = w < 330 ? 42 : 49, right = w - 15, top = 24, bottom = h - 37;
    const X = v => left + (v - xmin) / (xmax - xmin) * (right - left);
    const Y = v => bottom - (v - ymin) / (ymax - ymin) * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const y = ymin + (ymax - ymin) * i / 4;
      line(ctx, left, Y(y), right, Y(y), '#e1e4e9', 0.7);
      text(ctx, tick(y), left - 7, Y(y), '#606873', 10, 'right');
      const x = xmin + (xmax - xmin) * i / 4;
      line(ctx, X(x), top, X(x), bottom, '#edf0f3', 0.7);
      text(ctx, tick(x), X(x), bottom + 13, '#606873', 10, 'center');
    }
    line(ctx, left, top, left, bottom, '#7d8795'); line(ctx, left, bottom, right, bottom, '#7d8795');
    text(ctx, ylabel, left, 10, gray, 10); text(ctx, xlabel, (left + right) / 2, h - 7, gray, 10, 'center');
    return { X, Y, left, right, top, bottom };
  }
  function clipPlot(ctx, p) {
    ctx.save(); ctx.beginPath(); ctx.rect(p.left, p.top, p.right - p.left, p.bottom - p.top); ctx.clip();
  }
  function drawSingle() {
    const range = Number($('single-range').value), velocity = Number($('single-velocity').value), wave = Number($('single-wave').value);
    const model = M.singleReflector(range, velocity, wave), scale = wave > 1 ? 1 : 1e6, units = wave > 1 ? 's' : 'μs';
    $('single-range-value').textContent = range.toFixed(1) + ' m';
    $('single-velocity-value').textContent = signed(velocity, 1) + ' m/s';
    let view = canvas('single-phase');
    const limit = Math.max(0.1, Math.abs(model.cycles) * 1.05);
    const p = axes(view.ctx, view.w, view.h, 0, model.duration * scale, velocity < 0 ? -limit : 0, velocity < 0 ? 0 : limit, 'Time (' + units + ')', 'Phase change (cycles)');
    line(view.ctx, p.X(0), p.Y(0), p.X(model.duration * scale), p.Y(model.cycles), blue, 2);
    view = canvas('single-signal');
    const q = axes(view.ctx, view.w, view.h, 0, model.duration * scale, -1.2, 1.2, 'Time (' + units + ')', 'Re { r_bb(t) }');
    clipPlot(view.ctx, q); view.ctx.beginPath();
    for (let i = 0; i <= 700; i++) {
      const t = model.duration * i / 700, x = q.X(t * scale), y = q.Y(Math.cos(model.initialPhase + TAU * model.shift * t));
      if (i === 0) view.ctx.moveTo(x, y); else view.ctx.lineTo(x, y);
    }
    view.ctx.strokeStyle = blue; view.ctx.lineWidth = 1.7; view.ctx.stroke(); view.ctx.restore();
    $('single-result').textContent = 'Δf = ' + frequency(model.shift) + '; accumulated phase = ' + signed(model.cycles) + ' cycles over ' + (model.duration * scale).toFixed(2) + ' ' + units + '. Final range = ' + model.finalRange.toFixed(wave > 1 ? 3 : 7) + ' m.';
    $('single-phase').setAttribute('aria-label', 'Baseband phase changes by ' + model.cycles.toPrecision(4) + ' cycles; frequency shift ' + frequency(model.shift) + '.');
  }
  function phaseColor(phase, alpha = 1) {
    return 'hsla(' + (((phase / TAU % 1) + 1) % 1 * 360) + ',55%,42%,' + alpha + ')';
  }
  function drawStatic() {
    const wave = surfaceState.wavelength, sigma = surfaceState.height;
    $('static-wave-value').textContent = wavelength(wave);
    $('static-height-value').textContent = sigma.toFixed(2) + ' μm';
    $('static-correlation-value').textContent = surfaceState.correlation.toFixed(1) + ' μm';
    document.querySelectorAll('[data-static-wave]').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(Math.log10(Number(b.dataset.staticWave) / wave)) < 0.002)));
    let view = canvas('static-surface');
    const ys = Array.from({ length: 513 }, (_, i) => sigma * M.heightAt(heights, -50 + 100 * i / 512));
    const extent = Math.max(1, Math.ceil(Math.max(...ys.map(Math.abs)) * 1.1));
    const p = axes(view.ctx, view.w, view.h, -50, 50, -extent, extent, 'Position x (μm)', 'Height h(x) (μm)');
    clipPlot(view.ctx, p); view.ctx.beginPath();
    ys.forEach((y, i) => { const x = p.X(-50 + 100 * i / 512); if (!i) view.ctx.moveTo(x, p.Y(y)); else view.ctx.lineTo(x, p.Y(y)); });
    view.ctx.strokeStyle = '#939aa3'; view.ctx.lineWidth = 1.3; view.ctx.stroke();
    const phases = [];
    for (let i = 0; i < 64; i++) {
      const x = -50 + i / 63 * 100, y = sigma * M.heightAt(heights, x), phase = M.phaseAt(x, y, wave);
      phases.push(phase); dot(view.ctx, p.X(x), p.Y(y), 2.5, phaseColor(phase));
    }
    view.ctx.restore(); view = canvas('static-phasors');
    const cx = view.w / 2, cy = view.h / 2, r = Math.min(view.w / 2 - 32, view.h / 2 - 35);
    line(view.ctx, cx - r - 9, cy, cx + r + 9, cy, '#c4cbd6'); line(view.ctx, cx, cy - r - 9, cx, cy + r + 9, '#c4cbd6');
    dot(view.ctx, cx, cy, r, null, '#c4cbd6');
    text(view.ctx, '0', cx + r + 19, cy, gray, 11, 'center'); text(view.ctx, 'π', cx - r - 18, cy, gray, 11, 'center');
    text(view.ctx, 'π/2', cx, cy - r - 20, gray, 11, 'center'); text(view.ctx, '3π/2', cx, cy + r + 20, gray, 11, 'center');
    phases.forEach(phase => {
      const x = cx + r * Math.cos(phase), y = cy - r * Math.sin(phase);
      line(view.ctx, cx, cy, x, y, phaseColor(phase, 0.3), 0.9); dot(view.ctx, x, y, 2.4, phaseColor(phase));
    });
    const spread = M.phaseRms(sigma, wave), value = spread > 0 && spread < 0.001 ? spread.toExponential(2) : spread.toFixed(2);
    $('static-result').textContent = 'Height-dependent RMS phase σΦ = ' + value + ' rad. ' + (spread < 0.1 ? 'Microscopic heights scarcely change the phase at this wavelength.' : 'Height differences significantly affect phase; the full phasors also include the position-dependent term.');
    $('static-phasors').setAttribute('aria-label', '64 unit phasors at wavelength ' + wavelength(wave) + '. Height-dependent RMS phase: ' + value + ' radians.');
  }
  function drawMotion() {
    const { ctx, w, h } = canvas('motion-geometry');
    const small = w < 460, theta = motion.angle * Math.PI / 180, ox = w * .57, oy = h * .63;
    const drop = Math.min(h * .40, (ox - 38) / Math.max(.01, Math.tan(theta))), sx = ox - drop * Math.tan(theta), sy = oy - drop;
    const scale = Math.min(w * .18, 125), dy = motion.normal * motion.time * scale, dx = motion.tangent * motion.time * scale;
    const py = oy - dy, spot = ox - dy * Math.tan(theta), target = ox - dx, half = small ? 24 : 40;
    ctx.beginPath(); ctx.moveTo(sx - 3, sy); ctx.lineTo(spot - half, py); ctx.lineTo(spot + half, py); ctx.lineTo(sx + 3, sy); ctx.closePath(); ctx.fillStyle = '#ad652c0c'; ctx.fill();
    line(ctx, 12, oy, w - 12, oy, '#b9c0ca', 1, [4, 4]);
    if (Math.abs(dy) > 12) text(ctx, 'initial plane', w - 15, oy + 12, '#8b929c', small ? 9 : 10, 'right');
    const rough = x => 2 * Math.sin((x - target) * .12) + Math.sin((x - target) * .31);
    ctx.beginPath();
    for (let x = 12; x <= w - 12; x++) { if (x === 12) ctx.moveTo(x, py - rough(x)); else ctx.lineTo(x, py - rough(x)); }
    ctx.lineTo(w - 12, py + 20); ctx.lineTo(12, py + 20); ctx.closePath(); ctx.fillStyle = '#f0f1f3'; ctx.fill();
    ctx.beginPath();
    for (let x = 12; x <= w - 12; x++) { if (x === 12) ctx.moveTo(x, py - rough(x)); else ctx.lineTo(x, py - rough(x)); }
    ctx.strokeStyle = '#7a828d'; ctx.lineWidth = 1; ctx.stroke();
    for (let x = 22 - (dx % 22); x < w - 20; x += 22) line(ctx, x, py + 17, x + 7, py + 10, '#c6cbd3');
    line(ctx, ox, oy, ox, oy - 68, '#9ea6b4', 1, [3, 4]); text(ctx, 'n', ox + 8, oy - 65, gray, 12);
    if (motion.angle > 0) {
      ctx.beginPath(); ctx.arc(ox, oy, 29, -Math.PI / 2 - theta, -Math.PI / 2); ctx.strokeStyle = '#8b94a2'; ctx.stroke();
      text(ctx, motion.angle + '°', ox - 43 * Math.sin(theta / 2), oy - 44 * Math.cos(theta / 2), gray, 10, 'center');
    }
    arrow(ctx, sx, sy, spot, py, orange); dot(ctx, sx, sy, 13, '#f0f3f8', blue); dot(ctx, sx, sy, 4, blue);
    text(ctx, small ? 'Sensor' : 'Colocated source / receiver', sx, sy - 25, gray, small ? 10 : 12, 'center');
    line(ctx, ox, oy, target, py, '#315d9860', 1.5, [3, 3]); dot(ctx, target, py, 7, '#fff', blue); dot(ctx, target, py, 3.5, blue); dot(ctx, spot, py, 5, orange, '#fff');
    const labelX = Math.min(w - 30, spot + (small ? 25 : 45));
    line(ctx, spot + 4, py - 4, labelX, py - 25, orange); text(ctx, 'spot', labelX, py - 34, orange, small ? 10 : 12, 'center');
    line(ctx, target - 4, py + 6, target - 23, py + 36, blue); text(ctx, 'target', target - 23, py + 47, blue, small ? 10 : 12, 'center');
    if (Math.hypot(motion.normal, motion.tangent) > .001) { const x = w * .85, y = h * .21; arrow(ctx, x, y, x - motion.tangent * 18, y - motion.normal * 18, blue); text(ctx, 'v', x + 13, y + 10, blue, 12); }
    dot(ctx, w * .23 - 7, h - 12, 3, orange); text(ctx, 'Beam intersection', w * .23, h - 12, gray, small ? 9 : 11);
    dot(ctx, w * .65 - 7, h - 12, 3, blue); text(ctx, 'Material point', w * .65, h - 12, gray, small ? 9 : 11);
  }
  function updateMotion() {
    const v = M.velocities(motion.angle, motion.normal, motion.tangent);
    $('motion-angle-value').textContent = motion.angle + '°';
    $('motion-normal-value').textContent = signed(motion.normal) + ' m/s'; $('motion-tangent-value').textContent = signed(motion.tangent) + ' m/s';
    $('motion-spot-paper').textContent = signed(2 * v.spot) + ' m/s'; $('motion-target-paper').textContent = signed(2 * v.target) + ' m/s';
    $('motion-spot-radial').textContent = signed(v.spot) + ' m/s'; $('motion-target-radial').textContent = signed(v.target) + ' m/s';
    $('motion-spot-frequency').textContent = frequency(M.frequency(v.spot, 10)); $('motion-target-frequency').textContent = frequency(M.frequency(v.target, 1.55e-6));
    let message;
    if (Math.hypot(motion.normal, motion.tangent) < 1e-8) message = 'The surface is stationary; both frequency shifts vanish.';
    else if (!motion.angle) message = 'Normal incidence: both equivalent radial velocities equal v_N. Transverse motion has no line-of-sight component.';
    else if (Math.abs(motion.normal) < 1e-8) message = 'Transverse motion: the macroscopic spot is stationary, while the material has a nonzero velocity projection toward the oblique sensor.';
    else if (Math.abs(v.spot - v.target) < 1e-8) message = 'The material follows the beam intersection. The velocity predictions agree, although the measured frequencies differ with wavelength.';
    else if (Math.abs(motion.tangent) < 1e-8) message = 'Normal motion: the spot’s equivalent radial speed is ' + (1 / Math.cos(motion.angle * Math.PI / 180) ** 2).toFixed(3) + ' times the target’s.';
    else message = 'The spot depends on normal motion; the target depends on the line-of-sight projection of both velocity components.';
    $('motion-result').textContent = message; drawMotion();
  }
  function updateTime() { $('motion-time').value = Math.round(motion.time * 1000); $('motion-time-value').textContent = Math.round(motion.time * 1000) + ' ms'; }
  function setPreset(name) {
    motion.angle = 45; motion.normal = name === 'normal' ? 2 : name === 'beam' ? Math.SQRT1_2 : 0; motion.tangent = name === 'transverse' ? 1 : name === 'beam' ? Math.SQRT1_2 : 0;
    for (const key of ['angle', 'normal', 'tangent']) { const el = $('motion-' + key); if (key !== 'angle') el.step = name === 'beam' ? 'any' : '.1'; el.value = motion[key]; }
    document.querySelectorAll('[data-motion]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.motion === name)));
    motion.time = 0; updateTime(); updateMotion();
  }
  function animate(timestamp) {
    animation = null;
    if (!motion.playing || !visible || document.hidden) { lastTime = null; return; }
    if (lastTime !== null) motion.time = (motion.time + Math.min(timestamp - lastTime, 60) / 24000) % .25;
    lastTime = timestamp; updateTime(); drawMotion(); animation = requestAnimationFrame(animate);
  }
  function scheduleMotion() { if (motion.playing && visible && !document.hidden && animation === null) { lastTime = null; animation = requestAnimationFrame(animate); } }
  function setPlaying(value) {
    motion.playing = value; if (animation !== null) cancelAnimationFrame(animation); animation = null; lastTime = null;
    $('motion-play').textContent = value ? 'Pause' : 'Play'; $('motion-play').setAttribute('aria-label', value ? 'Pause motion replay' : 'Play motion replay'); scheduleMotion();
  }
  function spectrumParameters() { return { wavelength: Number($('spectrum-wave').value), height: Number($('spectrum-height').value), correlation: Number($('spectrum-correlation').value), ensemble: Number($('spectrum-ensemble').value) }; }
  function spectrumControls(dirty = true) {
    const p = spectrumParameters();
    $('spectrum-wave-value').textContent = p.wavelength.toFixed(2) + ' μm'; $('spectrum-height-value').textContent = p.height.toFixed(2) + ' μm'; $('spectrum-correlation-value').textContent = p.correlation.toFixed(1) + ' μm';
    if (dirty) $('spectrum-status').textContent = 'Parameters changed. Select “Run simulation” to update the spectrum below.';
  }
  function drawSpectrum() {
    const { ctx, w, h } = canvas('spectrum-plot');
    if (!spectrumData) { const p = axes(ctx, w, h, -6, 6, -90, 0, 'Signed frequency (MHz)', 'Power (dB)'); text(ctx, 'Run the simulation to compute a spectrum.', (p.left + p.right) / 2, (p.top + p.bottom) / 2, '#6a7382', w < 400 ? 10 : 12, 'center'); return; }
    const d = spectrumData, span = Math.ceil(Math.max(6, d.spot * 1.2)), p = axes(ctx, w, h, -span, span, -90, 0, 'Signed frequency (MHz)', w < 460 ? 'Relative power (dB)' : 'Power relative to coherent aperture (dB)');
    clipPlot(ctx, p);
    for (const [f, color] of [[d.target, blue], [d.spot, orange]]) line(ctx, p.X(f), p.top, p.X(f), p.bottom, color, 1.2, [5, 4]);
    ctx.beginPath(); let started = false;
    for (let i = 0; i < d.frequencies.length; i++) {
      const f = d.frequencies[i]; if (f < -span || f > span) continue;
      const x = p.X(f), y = p.Y(Math.max(-95, 10 * Math.log10(Math.max(1e-16, d.power[i]))));
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#333b49'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
    text(ctx, 'target', p.X(d.target) - 4, p.top + 11, blue, 10, 'right'); text(ctx, 'spot', p.X(d.spot) + 4, p.top + 25, orange, 10);
    $('spectrum-plot').setAttribute('aria-label', 'Computed spectrum of ' + d.ensemble + ' surfaces. Peak FFT bin ' + d.peak.toFixed(4) + ' MHz; target limit ' + d.target.toFixed(4) + ', spot limit ' + d.spot.toFixed(4) + ' MHz.');
  }
  function runSpectrum() {
    if (spectrumBusy) return;
    spectrumStarted = true; spectrumBusy = true; const p = spectrumParameters();
    $('spectrum-run').disabled = true; $('spectrum-demo').setAttribute('aria-busy', 'true'); $('spectrum-status').textContent = 'Computing ' + p.ensemble + ' surface realization(s)…';
    // Let the status paint before running the bounded numerical calculation.
    requestAnimationFrame(() => setTimeout(() => {
      try {
        spectrumData = M.spectrum(p); drawSpectrum();
        $('spectrum-result').textContent = 'Shown: λ = ' + p.wavelength.toFixed(2) + ' μm, σ_h = ' + p.height.toFixed(2) + ' μm, ℓ = ' + p.correlation.toFixed(1) + ' μm; ' + p.ensemble + ' realization(s). Peak FFT bin: ' + signed(spectrumData.peak, 4) + ' MHz; peak power: ' + (10 * Math.log10(Math.max(spectrumData.peakPower, 1e-16))).toFixed(1) + ' dB.';
        $('spectrum-status').textContent = 'Simulation complete. Dashed lines show the analytic limiting frequencies.';
      } catch (error) { $('spectrum-status').textContent = 'Simulation could not be completed: ' + error.message; console.error(error); }
      finally { spectrumBusy = false; $('spectrum-run').disabled = false; $('spectrum-demo').setAttribute('aria-busy', 'false'); }
    }, 0));
  }
  ['single-range', 'single-velocity', 'single-wave'].forEach(id => $(id).addEventListener('input', drawSingle));
  $('static-wave').addEventListener('input', e => { surfaceState.wavelength = 10 ** Number(e.target.value); drawStatic(); });
  $('static-height').addEventListener('input', e => { surfaceState.height = Number(e.target.value); drawStatic(); });
  $('static-correlation').addEventListener('input', e => { surfaceState.correlation = Number(e.target.value); heights = M.surface(surfaceState.correlation, surfaceState.seed); drawStatic(); });
  $('static-reseed').addEventListener('click', () => { surfaceState.seed += 7919; heights = M.surface(surfaceState.correlation, surfaceState.seed); drawStatic(); });
  document.querySelectorAll('[data-static-wave]').forEach(b => b.addEventListener('click', () => { surfaceState.wavelength = Number(b.dataset.staticWave); $('static-wave').value = Math.log10(surfaceState.wavelength); drawStatic(); }));
  document.querySelectorAll('[data-motion]').forEach(b => b.addEventListener('click', () => setPreset(b.dataset.motion)));
  ['angle', 'normal', 'tangent'].forEach(key => $('motion-' + key).addEventListener('input', e => {
    motion[key] = Number(e.target.value);
    if (e.target.step === 'any') { motion[key] = Math.round(motion[key] * 10) / 10; e.target.step = '.1'; e.target.value = motion[key]; }
    document.querySelectorAll('[data-motion]').forEach(b => b.setAttribute('aria-pressed', 'false')); updateMotion();
  }));
  $('motion-play').addEventListener('click', () => setPlaying(!motion.playing));
  $('motion-reset').addEventListener('click', () => { motion.time = 0; updateTime(); drawMotion(); });
  $('motion-time').addEventListener('input', e => { setPlaying(false); motion.time = Number(e.target.value) / 1000; updateTime(); drawMotion(); });
  ['spectrum-wave', 'spectrum-height', 'spectrum-correlation', 'spectrum-ensemble'].forEach(id => $(id).addEventListener('input', () => spectrumControls()));
  $('spectrum-run').addEventListener('click', runSpectrum);
  $('spectrum-smooth').addEventListener('click', () => { $('spectrum-height').value = 0; spectrumControls(); });
  $('spectrum-rough').addEventListener('click', () => { $('spectrum-wave').value = 1.55; $('spectrum-height').value = 3.1; $('spectrum-correlation').value = 3; spectrumControls(); });
  document.addEventListener('visibilitychange', scheduleMotion);
  reducedMotion.addEventListener('change', e => { if (e.matches) setPlaying(false); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; scheduleMotion(); }, { rootMargin: '100px' }).observe($('motion-geometry'));
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting && !spectrumStarted) { runSpectrum(); observer.disconnect(); } }, { rootMargin: '250px' });
    observer.observe($('spectrum-demo'));
  } else runSpectrum();
  let queued = false;
  function redraw() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; drawSingle(); drawStatic(); drawMotion(); drawSpectrum(); }); }
  window.addEventListener('resize', redraw);
  if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(document.querySelector('.document'));
  drawSingle(); drawStatic(); updateMotion(); updateTime(); spectrumControls(false); drawSpectrum(); setPlaying(false);
})();
