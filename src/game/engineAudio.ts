export class ProceduralEngineAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private oscPrimary: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private oscHarmonic: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private tireNoiseGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private muted = false;
  private started = false;

  public init(): void {
    if (this.started || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.28;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Engine filter + gain
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      filter.Q.value = 3.2;

      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;
      filter.connect(engGain);
      engGain.connect(master);

      this.engineFilter = filter;
      this.engineGain = engGain;

      // V6 harmonic stack
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 48;
      osc1.connect(filter);
      osc1.start();

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 24;
      osc2.connect(filter);
      osc2.start();

      const osc3 = ctx.createOscillator();
      osc3.type = 'sawtooth';
      osc3.frequency.value = 96;
      const harmGain = ctx.createGain();
      harmGain.gain.value = 0.25;
      osc3.connect(harmGain);
      harmGain.connect(filter);
      osc3.start();

      this.oscPrimary = osc1;
      this.oscSub = osc2;
      this.oscHarmonic = osc3;

      // Tire screech noise loop
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer;
      noiseSrc.loop = true;

      const tFilter = ctx.createBiquadFilter();
      tFilter.type = 'bandpass';
      tFilter.frequency.value = 1150;
      tFilter.Q.value = 5.5;

      const tGain = ctx.createGain();
      tGain.gain.value = 0;

      noiseSrc.connect(tFilter);
      tFilter.connect(tGain);
      tGain.connect(master);
      noiseSrc.start();

      this.tireFilter = tFilter;
      this.tireNoiseGain = tGain;
      this.started = true;
    } catch {
      // AudioContext blocked or unavailable in headless environment
    }
  }

  public resume(): void {
    if (!this.started) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.28, this.ctx.currentTime, 0.04);
    }
  }

  public silence(): void {
    if (!this.ctx || !this.engineGain || !this.tireNoiseGain) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, now, 0.04);
    this.tireNoiseGain.gain.setTargetAtTime(0, now, 0.04);
  }

  public update(rpm: number, throttle: number, speedKmh: number, slipRatio: number, active: boolean): void {
    if (!this.ctx || !this.started) return;
    if (!active || this.muted) {
      this.silence();
      return;
    }
    if (this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    // Firing frequency for 6-cylinder 4-stroke: (RPM / 60) * 3
    const baseFreq = Math.max(28, (rpm / 60) * 2.2);
    this.oscPrimary?.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.oscSub?.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.03);
    this.oscHarmonic?.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.03);

    const filterCutoff = 190 + (rpm / 7400) * 950 + throttle * 480;
    this.engineFilter?.frequency.setTargetAtTime(filterCutoff, now, 0.04);

    const targetEngGain = 0.16 + throttle * 0.16 + (rpm / 7400) * 0.1;
    this.engineGain?.gain.setTargetAtTime(targetEngGain, now, 0.04);

    // Tire screech when drifting/sliding above 18 km/h
    const screechIntensity =
      speedKmh > 18 && slipRatio > 0.28 ? Math.min(0.22, (slipRatio - 0.28) * 0.26) : 0;
    this.tireNoiseGain?.gain.setTargetAtTime(screechIntensity, now, 0.05);
    if (this.tireFilter) {
      this.tireFilter.frequency.setTargetAtTime(980 + Math.min(700, speedKmh * 4), now, 0.05);
    }
  }

  public playShiftClunk(): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g);
    g.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playCheckpointChime(): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      g.gain.setValueAtTime(0.14, now + i * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.26);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.28);
    });
  }

  public playCollisionThud(intensity: number): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const vol = Math.min(0.42, Math.max(0.08, intensity * 0.025));
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.22);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g);
    g.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public dispose(): void {
    try {
      this.oscPrimary?.stop();
      this.oscSub?.stop();
      this.oscHarmonic?.stop();
      this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
    this.started = false;
  }
}
