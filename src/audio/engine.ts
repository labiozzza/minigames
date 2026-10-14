// All sound is synthesized with Web Audio. No audio files, no network.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicOn = false;
  private chordStep = 0;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolumes(music: number, sfx: number): void {
    if (this.musicGain) this.musicGain.gain.value = music * 0.5;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
  }

  /** Must be called from a user gesture at least once. Returns false if unavailable. */
  unlock(): boolean {
    return this.ensure() !== null;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.musicGain = null;
      this.sfxGain = null;
    }
  }

  get playing(): boolean {
    return this.musicOn;
  }

  private tone(opts: {
    freq: number;
    freqEnd?: number;
    dur: number;
    type?: OscillatorType;
    vol?: number;
    delay?: number;
    music?: boolean;
  }): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const dest = opts.music ? this.musicGain : this.sfxGain;
    if (!dest) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur);
    const v = opts.vol ?? 0.5;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  select(): void {
    this.tone({ freq: 520, freqEnd: 660, dur: 0.09, type: 'triangle', vol: 0.35 });
  }
  ui(): void {
    this.tone({ freq: 440, dur: 0.06, type: 'sine', vol: 0.25 });
  }
  error(): void {
    this.tone({ freq: 180, freqEnd: 140, dur: 0.16, type: 'square', vol: 0.12 });
  }
  pour(durSec: number): void {
    const d = Math.max(0.15, Math.min(0.8, durSec));
    this.tone({ freq: 300, freqEnd: 520, dur: d, type: 'sine', vol: 0.3 });
    this.tone({ freq: 600, freqEnd: 900, dur: d * 0.8, type: 'triangle', vol: 0.12, delay: 0.03 });
  }
  reveal(): void {
    this.tone({ freq: 660, dur: 0.12, type: 'sine', vol: 0.3 });
    this.tone({ freq: 990, dur: 0.18, type: 'sine', vol: 0.3, delay: 0.09 });
  }
  complete(): void {
    this.tone({ freq: 523, dur: 0.14, type: 'triangle', vol: 0.35 });
    this.tone({ freq: 784, dur: 0.2, type: 'triangle', vol: 0.35, delay: 0.1 });
  }
  win(): void {
    const seq = [523, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) => this.tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.4, delay: i * 0.13 }));
  }

  startMusic(): void {
    if (this.musicOn) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.musicOn = true;
    this.playChord();
    this.musicTimer = setInterval(() => this.playChord(), 7000);
  }

  stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private playChord(): void {
    if (!this.musicOn) return;
    // Am – F – C – G progression, soft detuned triangles through lowpass feel.
    const chords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [130.81, 164.81, 196.0],
      [196.0, 246.94, 293.66],
    ];
    const chord = chords[this.chordStep % chords.length];
    this.chordStep++;
    chord.forEach((f, i) => {
      this.tone({ freq: f, dur: 5.5, type: 'triangle', vol: 0.10, delay: i * 0.35, music: true });
      this.tone({ freq: f * 1.003, dur: 5.5, type: 'sine', vol: 0.07, delay: i * 0.35, music: true });
    });
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* absence is normal on some devices */ }
}
