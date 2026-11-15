// Every sound the game makes, synthesized with WebAudio: no audio files, no
// network, nothing to load. The context is created on the first user gesture
// (the Play click); until then every call is a no-op, so the screenshot mode
// and a muted tab stay silent. One master gain, one noise buffer shared by
// every percussive sound, voices that stop themselves.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(when, duration, filterType, frequency, gainValue, decay = 0.001) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(decay, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, duration, type, from, to, gainValue) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, when);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  return {
    // Call from the Play click (a user gesture) so the context is allowed to run.
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(distant = false) {
      if (!ctx) return;
      const now = ctx.currentTime;
      const gain = distant ? 0.12 : 0.5;
      noise(now, 0.09, 'lowpass', distant ? 900 : 2400, gain);
      tone(now, 0.07, 'square', distant ? 110 : 190, 60, gain * 0.5);
    },
    dryFire() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.04, 'square', 1400, 900, 0.08);
    },
    reload() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.05, 'square', 700, 500, 0.12);
      tone(now + 0.22, 0.05, 'square', 900, 600, 0.12);
      tone(now + 0.55, 0.06, 'square', 500, 800, 0.14);
    },
    step() {
      if (!ctx) return;
      noise(ctx.currentTime, 0.05, 'lowpass', 500, 0.05);
    },
    hit() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.06, 'sine', 1250, 1250, 0.16);
    },
    kill() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.09, 'sine', 880, 880, 0.18);
      tone(now + 0.09, 0.12, 'sine', 1320, 1320, 0.18);
    },
    hurt() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.12, 'sawtooth', 180, 90, 0.2);
    },
    beep(final = false) {
      if (!ctx) return;
      tone(ctx.currentTime, final ? 0.16 : 0.07, 'sine', 1150, 1150, 0.2);
    },
    plant() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.08, 'sine', 660, 660, 0.2);
      tone(now + 0.12, 0.08, 'sine', 990, 990, 0.2);
    },
    explosion() {
      if (!ctx) return;
      const now = ctx.currentTime;
      noise(now, 1.1, 'lowpass', 320, 0.9);
      tone(now, 0.9, 'sine', 120, 28, 0.8);
    },
    flash() {
      if (!ctx) return;
      tone(ctx.currentTime, 1.4, 'sine', 3200, 2400, 0.12);
    },
    buy() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.07, 'sine', 1560, 1560, 0.14);
      tone(now + 0.08, 0.1, 'sine', 2090, 2090, 0.14);
    },
    denied() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.12, 'square', 220, 180, 0.12);
    },
    roundWin() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.14, 'sine', 523, 523, 0.2);
      tone(now + 0.14, 0.14, 'sine', 659, 659, 0.2);
      tone(now + 0.28, 0.22, 'sine', 784, 784, 0.2);
    },
    roundLose() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone(now, 0.18, 'sine', 392, 392, 0.2);
      tone(now + 0.18, 0.26, 'sine', 311, 311, 0.2);
    },
  };
}
