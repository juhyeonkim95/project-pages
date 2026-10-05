/* SI units except the rough-surface model, which uses micrometres and
 * microseconds. Thus 1 m/s = 1 µm/µs and its FFT frequencies are in MHz.
 * Positive frequency is approach. q = k_out - k_in.
 */
(() => {
  'use strict';
  const TAU = 2 * Math.PI;
  const DOMAIN = 512;
  const SPACE_SAMPLES = 16384;
  const TIME_SAMPLES = 512;
  const DURATION = 16;
  const WIDTH = 100;
  function fft(real, imaginary, inverse = false) {
    const n = real.length;
    if (n !== imaginary.length || n < 2 || (n & (n - 1))) throw new Error('FFT length must be a power of two.');
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = (inverse ? 1 : -1) * TAU / size;
      const stepR = Math.cos(angle), stepI = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let wr = 1, wi = 0;
        for (let j = 0; j < size / 2; j++) {
          const i = start + j, k = i + size / 2;
          const tr = wr * real[k] - wi * imaginary[k];
          const ti = wr * imaginary[k] + wi * real[k];
          real[k] = real[i] - tr; imaginary[k] = imaginary[i] - ti;
          real[i] += tr; imaginary[i] += ti;
          const next = wr * stepR - wi * stepI;
          wi = wr * stepI + wi * stepR; wr = next;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imaginary[i] /= n; }
  }
  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state + 0.5) / 4294967296;
    };
  }
  function surface(correlation = 3, seed = 9157) {
    const n = SPACE_SAMPLES, re = new Float64Array(n), im = new Float64Array(n);
    const random = randomGenerator(seed);
    for (let k = 1; k < n / 2; k++) {
      const filter = Math.exp(-0.25 * (TAU * k / DOMAIN * correlation) ** 2);
      if (filter < 1e-12) break;
      const radius = Math.sqrt(-2 * Math.log(random())) * filter;
      const phase = TAU * random();
      re[k] = radius * Math.cos(phase); im[k] = radius * Math.sin(phase);
      re[n - k] = re[k]; im[n - k] = -im[k];
    }
    fft(re, im, true);
    const mean = re.reduce((a, b) => a + b, 0) / n;
    const rms = Math.sqrt(re.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return Float64Array.from(re, x => (x - mean) / rms);
  }
  function heightAt(heights, x) {
    const position = (((x + DOMAIN / 2) / DOMAIN * heights.length) % heights.length + heights.length) % heights.length;
    const i = Math.floor(position), f = position - i;
    return heights[i] * (1 - f) + heights[(i + 1) % heights.length] * f;
  }
  function velocities(angle, normal, tangent) {
    const theta = angle * Math.PI / 180;
    return { spot: normal / Math.cos(theta), target: normal * Math.cos(theta) + tangent * Math.sin(theta) };
  }
  function frequency(radial, wavelength) { return 2 * radial / wavelength; }
  function phaseRms(height, wavelength, angle = 45) {
    return 2 * TAU * height * Math.cos(angle * Math.PI / 180) / wavelength;
  }
  function phaseAt(x, height, wavelength, angle = 45) {
    const theta = angle * Math.PI / 180;
    return 2 * TAU / wavelength * (-Math.sin(theta) * x + Math.cos(theta) * height);
  }
  function singleReflector(range, velocity, wavelength) {
    const duration = wavelength > 1 ? Math.min(2, velocity > 0 ? 0.8 * range / velocity : 2) : 2e-6;
    const shift = frequency(velocity, wavelength);
    return { duration, shift, cycles: shift * duration, finalRange: range - velocity * duration, initialPhase: -2 * TAU * range / wavelength };
  }
  function integralTable(heights, sigma, wavelength) {
    const n = heights.length, dx = DOMAIN / n;
    const real = new Float64Array(n + 1), imaginary = new Float64Array(n + 1);
    const fr = new Float64Array(n + 1), fi = new Float64Array(n + 1);
    for (let j = 0; j <= n; j++) {
      const phase = phaseAt(-DOMAIN / 2 + j * dx, sigma * heights[j % n], wavelength);
      fr[j] = Math.cos(phase); fi[j] = Math.sin(phase);
      if (j > 0) {
        real[j] = real[j - 1] + 0.5 * (fr[j - 1] + fr[j]) * dx;
        imaginary[j] = imaginary[j - 1] + 0.5 * (fi[j - 1] + fi[j]) * dx;
      }
    }
    return { real, imaginary, fr, fi, dx };
  }
  function integralAt(table, x) {
    const coordinate = (x + DOMAIN / 2) / table.dx;
    const index = Math.floor(coordinate);
    if (index < 0 || index >= table.real.length - 1) throw new Error('Footprint exceeds the sampled material domain.');
    const f = coordinate - index, delta = f * table.dx;
    return [
      table.real[index] + delta * (table.fr[index] + 0.5 * f * (table.fr[index + 1] - table.fr[index])),
      table.imaginary[index] + delta * (table.fi[index] + 0.5 * f * (table.fi[index + 1] - table.fi[index]))
    ];
  }
  function spectrum({ wavelength = 1.55, height = 3.1, correlation = 3, ensemble = 8, seed = 9157 } = {}) {
    const v = velocities(45, 2, 0);
    // Frequencies below are cycles/µs (MHz); a is µm/µs.
    const target = frequency(v.target, wavelength), spot = frequency(v.spot, wavelength);
    const a = -2, n = TIME_SAMPLES, window = new Float64Array(n), power = new Float64Array(n);
    let gain = 0;
    for (let i = 0; i < n; i++) { window[i] = 0.5 - 0.5 * Math.cos(TAU * i / (n - 1)); gain += window[i]; }
    for (let realization = 0; realization < ensemble; realization++) {
      const heights = height === 0 ? new Float64Array(SPACE_SAMPLES) : surface(correlation, seed + 7919 * realization);
      const table = integralTable(heights, height, wavelength);
      const real = new Float64Array(n), imaginary = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const time = i * DURATION / n;
        const lower = integralAt(table, a * time - WIDTH / 2);
        const upper = integralAt(table, a * time + WIDTH / 2);
        const r = (upper[0] - lower[0]) / WIDTH, im = (upper[1] - lower[1]) / WIDTH;
        const phase = TAU * target * time, c = Math.cos(phase), s = Math.sin(phase);
        real[i] = (r * c - im * s) * window[i];
        imaginary[i] = (r * s + im * c) * window[i];
      }
      fft(real, imaginary);
      for (let i = 0; i < n; i++) power[i] += (real[i] ** 2 + imaginary[i] ** 2) / (gain ** 2 * ensemble);
    }
    const frequencies = new Float64Array(n), shifted = new Float64Array(n);
    let peakIndex = 0;
    for (let i = 0; i < n; i++) {
      frequencies[i] = (i - n / 2) / DURATION;
      shifted[i] = power[(i + n / 2) % n];
      if (shifted[i] > shifted[peakIndex]) peakIndex = i;
    }
    return { frequencies, power: shifted, target, spot, peak: frequencies[peakIndex], peakPower: shifted[peakIndex], wavelength, height, correlation, ensemble };
  }
  window.DopplerModel = Object.freeze({ fft, surface, heightAt, velocities, frequency, phaseRms, phaseAt, singleReflector, spectrum, DOMAIN, SPACE_SAMPLES, TIME_SAMPLES, DURATION });
})();
