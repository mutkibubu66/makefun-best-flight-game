// All sound is synthesised with WebAudio — no audio files, no network. The engine is
// a sawtooth pair through a low-pass filter whose pitch follows throttle and speed,
// the wind is looped filtered noise whose gain follows airspeed, and the events
// (ring chime, drop thump, landing fanfare, crash, stall warning) are short envelopes.
export function createSoundEngine() {
  let context = null;
  let engineOscA = null;
  let engineOscB = null;
  let engineFilter = null;
  let engineGain = null;
  let windGain = null;
  let windSource = null;
  let muted = false;
  let started = false;

  /** Build the graph on the first user gesture; browsers forbid audio before one. */
  function ensureStarted() {
    if (started) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext();
      engineOscA = context.createOscillator();
      engineOscA.type = 'sawtooth';
      engineOscB = context.createOscillator();
      engineOscB.type = 'square';
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineFilter.Q.value = 2;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOscA.connect(engineFilter);
      engineOscB.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(context.destination);
      engineOscA.start();
      engineOscB.start();

      const length = context.sampleRate;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
      windSource = context.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      const windFilter = context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.6;
      windGain = context.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(context.destination);
      windSource.start();
      started = true;
    } catch {
      context = null;
    }
  }

  function tone(frequency, duration, type, volume, when) {
    if (!context || muted) return;
    const start = context.currentTime + (when || 0);
    const osc = context.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  function noiseBurst(duration, volume, filterFrequency) {
    if (!context || muted) return;
    const start = context.currentTime;
    const length = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFrequency || 900;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
  }

  return {
    ensureStarted,
    /** The continuous engine + wind bed, called every frame while flying. */
    update(throttle, speedKts, flying) {
      if (!context || !started || muted) return;
      if (context.state === 'suspended') context.resume();
      const rpm = 42 + throttle * 58 + speedKts * 0.12;
      engineOscA.frequency.setTargetAtTime(rpm, context.currentTime, 0.08);
      engineOscB.frequency.setTargetAtTime(rpm * 0.5 + 3, context.currentTime, 0.08);
      engineFilter.frequency.setTargetAtTime(320 + throttle * 900, context.currentTime, 0.1);
      engineGain.gain.setTargetAtTime(flying ? 0.045 + throttle * 0.05 : 0, context.currentTime, 0.1);
      windGain.gain.setTargetAtTime(flying ? Math.min(0.12, speedKts * 0.0009) : 0, context.currentTime, 0.15);
    },
    ringChime() {
      tone(880, 0.35, 'sine', 0.22, 0);
      tone(1318, 0.45, 'sine', 0.18, 0.07);
    },
    dropThump() {
      noiseBurst(0.25, 0.3, 300);
      tone(196, 0.4, 'sine', 0.25, 0);
    },
    landingFanfare() {
      tone(523, 0.22, 'triangle', 0.22, 0);
      tone(659, 0.22, 'triangle', 0.22, 0.14);
      tone(784, 0.4, 'triangle', 0.24, 0.28);
    },
    missionComplete() {
      tone(523, 0.25, 'triangle', 0.22, 0);
      tone(659, 0.25, 'triangle', 0.22, 0.16);
      tone(784, 0.25, 'triangle', 0.22, 0.32);
      tone(1046, 0.55, 'triangle', 0.24, 0.48);
    },
    crash() {
      noiseBurst(0.7, 0.5, 500);
      tone(70, 0.6, 'sine', 0.35, 0);
    },
    stallWarning() {
      tone(1180, 0.12, 'square', 0.08, 0);
    },
    balloonPop() {
      noiseBurst(0.3, 0.35, 1400);
      tone(300, 0.3, 'sine', 0.15, 0);
    },
    toggleMute() {
      muted = !muted;
      if (context && engineGain) engineGain.gain.value = 0;
      return muted;
    },
  };
}
