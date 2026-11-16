// Synthesised engine sound.
//
// One full four-stroke cycle (two crank revolutions) is rendered into a short
// looping buffer: every cylinder fires once, each firing being a damped
// resonant pulse with a little noise. Playing that loop faster or slower
// follows the engine speed, so the pitch, the firing rhythm and the "burble"
// all scale with rpm. A soft-clipper, a throttle-dependent low-pass filter
// and band-passed exhaust noise make on-throttle sound harder than coasting.

const BASE_RPM = 1000;

function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function cycleBuffer(ctx, cyl, layout) {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * 2 * 60 / BASE_RPM);           // two revolutions
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rand = rng(cyl * 977 + 13);
  const interval = len / cyl;
  // cross-plane V8s fire unevenly, which gives them their burble
  const uneven = layout === 'v' && cyl === 8 ? [0, 0.12, -0.08, 0.1, -0.12, 0.06, -0.04, 0.09] : [];
  const f0 = (sr / interval) * 2.6;                          // pulse resonance, ~2.6× firing frequency
  for (let k = 0; k < cyl; k++) {
    const start = Math.round((k + (uneven[k] || 0)) * interval);
    const amp = 0.75 + rand() * 0.25 + (uneven[k] ? Math.abs(uneven[k]) * 1.5 : 0);
    const tau = interval * 0.32;
    const n = Math.round(interval * 1.6);
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-i / tau);
      const s = Math.sin(2 * Math.PI * f0 * i / sr) * 0.8
        + Math.sin(2 * Math.PI * f0 * 0.5 * i / sr) * 0.5
        + (rand() * 2 - 1) * 0.35 * Math.exp(-i / (tau * 0.4));
      d[(start + i) % len] += amp * env * s;
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  return buf;
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  const rand = rng(4242);
  let last = 0;
  for (let i = 0; i < len; i++) { last = last * 0.6 + (rand() * 2 - 1) * 0.4; d[i] = last; }
  return buf;
}

function softClip(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return curve;
}

// cyl: 4, 6, 8 …  layout: 'v' or 'inline'.  ctx: an (Offline)AudioContext.
export function createEngineSound({ cyl = 6, layout = 'inline', ctx } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!ctx) { if (!Ctx) return null; ctx = new Ctx(); }

  const master = ctx.createGain(); master.gain.value = 0;
  master.connect(ctx.destination);

  const src = ctx.createBufferSource();
  src.buffer = cycleBuffer(ctx, cyl, layout);
  src.loop = true;
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.2); shaper.oversample = '2x';
  const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.Q.value = 0.9;
  const bodyGain = ctx.createGain(); bodyGain.gain.value = 0.9;
  src.connect(shaper); shaper.connect(body); body.connect(bodyGain); bodyGain.connect(master);

  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx); noise.loop = true;
  const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 0.8;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  noise.connect(band); band.connect(noiseGain); noiseGain.connect(master);

  // tyre squeal: narrow band of noise, wobbling a little
  const sq = ctx.createBufferSource(); sq.buffer = noise.buffer; sq.loop = true;
  const sqBand = ctx.createBiquadFilter(); sqBand.type = 'bandpass'; sqBand.frequency.value = 2100; sqBand.Q.value = 7;
  const sqGain = ctx.createGain(); sqGain.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 180;
  lfo.connect(lfoAmt); lfoAmt.connect(sqBand.frequency);
  sq.connect(sqBand); sqBand.connect(sqGain); sqGain.connect(master);
  // impacts: a low thud of filtered noise
  const thudLow = ctx.createBiquadFilter(); thudLow.type = 'lowpass'; thudLow.frequency.value = 260;
  const thudGain = ctx.createGain(); thudGain.gain.value = 0;
  thudLow.connect(thudGain); thudGain.connect(master);
  const thudSrc = ctx.createBufferSource(); thudSrc.buffer = noise.buffer; thudSrc.loop = true; thudSrc.connect(thudLow);

  // exhaust pops (backfire): short, punchy bursts of band-passed noise
  const popBand = ctx.createBiquadFilter(); popBand.type = 'bandpass'; popBand.frequency.value = 320; popBand.Q.value = 1.4;
  const popGain = ctx.createGain(); popGain.gain.value = 0;
  const popSrc = ctx.createBufferSource(); popSrc.buffer = noise.buffer; popSrc.loop = true;
  popSrc.connect(popBand); popBand.connect(popGain); popGain.connect(master);

  src.start(); noise.start(); sq.start(); lfo.start(); thudSrc.start(); popSrc.start();

  const fire = rpm => (rpm / 60) * (cyl / 2);
  return {
    ctx,
    // rpm: engine speed; load: 0 (coasting) … 1 (full throttle); on: audible
    set(rpm, load, on, t = ctx.currentTime) {
      const T = 0.04;
      src.playbackRate.setTargetAtTime(rpm / BASE_RPM, t, T);
      body.frequency.setTargetAtTime(Math.min(9000, 300 + fire(rpm) * (2 + load * 3.5)), t, T);
      bodyGain.gain.setTargetAtTime(0.55 + load * 0.45, t, 0.06);
      band.frequency.setTargetAtTime(400 + rpm * 0.35, t, T);
      noiseGain.gain.setTargetAtTime(0.03 + load * 0.12 * (rpm / 7000), t, 0.06);
      master.gain.setTargetAtTime(on ? 0.32 : 0, t, 0.08);
    },
    // 0 … 1: how hard the tyres are sliding
    squeal(level, t = ctx.currentTime) {
      sqGain.gain.setTargetAtTime(Math.min(1, level) * 0.5, t, 0.05);
      sqBand.frequency.setTargetAtTime(1800 + level * 700, t, 0.1);
    },
    // a hit against the barrier; strength 0 … 1
    thud(strength, t = ctx.currentTime) {
      thudGain.gain.cancelScheduledValues(t);
      thudGain.gain.setValueAtTime(Math.min(1, strength) * 3, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    },
    // one exhaust pop; strength 0 … 1
    pop(strength = 1, t = ctx.currentTime) {
      popBand.frequency.setValueAtTime(220 + Math.random() * 260, t);
      popGain.gain.cancelScheduledValues(t);
      popGain.gain.setValueAtTime(Math.min(1, strength) * 2.2, t);
      popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07 + Math.random() * 0.05);
    },
    close() { if (ctx.close) ctx.close(); },
  };
}

// Reads cylinder count and layout from a catalog entry's engine text.
export function engineSpec(model) {
  const e = (model.specs && model.specs.engine) || '';
  const v = e.match(/V\s?(\d+)/);
  if (v) return { cyl: +v[1], layout: 'v' };
  const inl = e.match(/(\d+)\s*$/) || e.match(/რიგითი\s+(\d+)/);
  return { cyl: inl ? +inl[1] : 6, layout: 'inline' };
}
