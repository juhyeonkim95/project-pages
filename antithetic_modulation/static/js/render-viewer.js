// Interactive equal-time render viewer in the "Rendering results" section.
// Images: static/renders/<modulation>/<scene>/<method>_<wavelength>_<rgb|zm>.<webp|jpg>
// Numbers: window.RENDER_STATS from render-data.js.
(function () {
  'use strict';

  var root = document.getElementById('render-viewer');
  var stats = window.RENDER_STATS;
  if (!root || !stats) return;

  var MODS = { cwtof: 'CW-ToF', sl: 'Structured light' };
  var SCENES = { 'cornell-box': 'Cornell box', bunny: 'Bunny', staircase: 'Staircase', kitchen: 'Kitchen' };
  var METHODS = { naive: 'Naive', antithetic: 'Antithetic (ours)', gt: 'Reference' };
  var KINDS = { rgb: { ext: 'webp', label: 'RGB' }, zm: { ext: 'jpg', label: 'zero-mean' } };

  var imgs = Array.prototype.slice.call(root.querySelectorAll('img[data-method]'));
  var status = root.querySelector('[data-status]');
  var requested = {};
  var token = 0;

  function current() {
    function pick(name) { return root.querySelector('input[name="' + name + '"]:checked').value; }
    return { mod: pick('rv-mod'), scene: pick('rv-scene'), wl: pick('rv-wl') };
  }

  function url(s, img) {
    var kind = img.dataset.kind;
    return 'static/renders/' + s.mod + '/' + s.scene + '/' + img.dataset.method + '_' + s.wl + '_' + kind + '.' + KINDS[kind].ext;
  }

  // 0.000241 -> "2.41 × 10<sup>−4</sup>"
  function sci(x) {
    var e = Math.floor(Math.log10(x));
    var m = x / Math.pow(10, e);
    if (m >= 9.995) { m /= 10; e += 1; }
    return m.toFixed(2) + ' × 10<sup>' + (e < 0 ? '−' + (-e) : e) + '</sup>';
  }

  function gain(naive, ours) {
    var r = naive / ours;
    if (r >= 1.1) return { text: r.toFixed(1) + '× lower', better: true, said: 'antithetic MSE ' + r.toFixed(1) + ' times lower than naive' };
    if (r <= 1 / 1.1) return { text: (1 / r).toFixed(1) + '× higher', better: false, said: 'antithetic MSE ' + (1 / r).toFixed(1) + ' times higher than naive' };
    return { text: 'about equal', better: false, said: 'antithetic and naive MSE about equal' };
  }

  function renderText(s) {
    var d = stats[s.mod + '/' + s.scene + '/' + s.wl];
    Object.keys(METHODS).forEach(function (m) {
      root.querySelector('[data-spp="' + m + '"]').textContent = d[m].spp.toLocaleString('en-US') + ' spp';
    });
    var g = gain(d.naive.mse, d.antithetic.mse);
    root.querySelector('[data-mse="naive"]').innerHTML = 'MSE ' + sci(d.naive.mse);
    root.querySelector('[data-mse="antithetic"]').innerHTML = 'MSE ' + sci(d.antithetic.mse) +
      '<span class="viewer-gain' + (g.better ? ' is-better' : '') + '">' + g.text + '</span>';
    return g;
  }

  function show(s) {
    imgs.forEach(function (img) {
      img.src = url(s, img);
      img.alt = METHODS[img.dataset.method] + ', ' + KINDS[img.dataset.kind].label + ': ' +
        MODS[s.mod] + ', ' + SCENES[s.scene] + ', λ = ' + s.wl;
    });
    var g = renderText(s);
    status.textContent = MODS[s.mod] + ', ' + SCENES[s.scene] + ', wavelength ' + s.wl + ': ' + g.said + '.';
  }

  // Resolves once all six images of a selection are decoded, so they swap in together.
  function load(s) {
    return Promise.all(imgs.map(function (img) {
      var im = new Image();
      im.src = url(s, img);
      if (im.decode) return im.decode().catch(function () {});
      return new Promise(function (done) { im.onload = im.onerror = done; });
    }));
  }

  function prefetch(s) {
    imgs.forEach(function (img) {
      var u = url(s, img);
      if (!requested[u]) { requested[u] = true; new Image().src = u; }
    });
  }

  // Neighboring wavelengths, so stepping through λ with the arrow keys feels instant.
  function prefetchNeighbors(s) {
    var wls = Array.prototype.map.call(root.querySelectorAll('input[name="rv-wl"]'), function (i) { return i.value; });
    var i = wls.indexOf(s.wl);
    [wls[i - 1], wls[i + 1]].forEach(function (wl) {
      if (wl) prefetch({ mod: s.mod, scene: s.scene, wl: wl });
    });
  }

  function update() {
    var s = current();
    var t = ++token;
    root.classList.add('is-loading');
    load(s).then(function () {
      if (t !== token) return;
      show(s);
      root.classList.remove('is-loading');
      prefetchNeighbors(s);
    });
  }

  root.addEventListener('change', update);

  // Hovering an option fetches what it would show.
  root.addEventListener('pointerover', function (e) {
    var input = e.target.closest && e.target.closest('label') && e.target.closest('label').querySelector('input');
    if (!input || input.checked) return;
    var s = current();
    s[{ 'rv-mod': 'mod', 'rv-scene': 'scene', 'rv-wl': 'wl' }[input.name]] = input.value;
    prefetch(s);
  });

  // A browser may restore an earlier selection on reload; resync the images if it did.
  var s0 = current();
  if (imgs[0].getAttribute('src') !== url(s0, imgs[0])) update();
  else renderText(s0);
})();
