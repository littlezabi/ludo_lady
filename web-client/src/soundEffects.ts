class SoundManager {
  private ctx: AudioContext | null = null;
  public muted: boolean = false;
  public volume: number = 1.0;
  private snoreAudio: HTMLAudioElement | null = null;

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.muted) {
      this.stopSnoreLoop();
    }
  }

  public setVolume(volumeFraction: number) {
    this.volume = Math.max(0, Math.min(1, volumeFraction));
    if (this.volume <= 0 || this.muted) {
      this.stopSnoreLoop();
    } else if (this.snoreAudio) {
      this.snoreAudio.volume = Math.max(0, Math.min(1, this.volume * 0.85));
    }
  }

  private getGain(baseGain: number): number {
    if (this.muted || this.volume <= 0) return 0.00001;
    return Math.max(0.00001, baseGain * this.volume);
  }

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private playAudioFile(url: string, volumeScale = 1.0) {
    if (this.muted || this.volume <= 0) return;
    try {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, this.volume * volumeScale));
      audio.play().catch(() => {});
    } catch {
      // Ignore autoplay policy restriction
    }
  }

  public playPieceEntry() {
    const files = [
      '/sounds/piece_entry/entry_1.mp3',
      '/sounds/piece_entry/entry_2.mp3'
    ];
    const picked = files[Math.floor(Math.random() * files.length)];
    this.playAudioFile(picked, 0.85);
  }

  public playPieceHit() {
    const files = [
      '/sounds/piece_hit_piece/hit_1.mp3',
      '/sounds/piece_hit_piece/hit_2.mp3',
      '/sounds/piece_hit_piece/hit_3.mp3',
      '/sounds/piece_hit_piece/hit_4.mp3',
      '/sounds/piece_hit_piece/hit_5.mp3',
      '/sounds/piece_hit_piece/hit_6.mp3'
    ];
    const picked = files[Math.floor(Math.random() * files.length)];
    this.playAudioFile(picked, 0.95);
  }

  public playSnore() {
    this.playAudioFile('/sounds/you_are_snoring/snore_1.mp3', 0.8);
  }

  public startSnoreLoop() {
    if (this.muted || this.volume <= 0) return;
    if (this.snoreAudio) return;

    try {
      this.snoreAudio = new Audio('/sounds/you_are_snoring/snore_1.mp3');
      this.snoreAudio.loop = true;
      this.snoreAudio.volume = Math.max(0, Math.min(1, this.volume * 0.85));
      this.snoreAudio.play().catch(() => {});
    } catch {
      // Ignore autoplay error
    }
  }

  public stopSnoreLoop() {
    if (this.snoreAudio) {
      try {
        this.snoreAudio.pause();
        this.snoreAudio.currentTime = 0;
      } catch {
        // Ignore error
      }
      this.snoreAudio = null;
    }
  }

  playDiceRoll() {
    if (this.muted || this.volume <= 0) return;
    this.initCtx();
    if (!this.ctx) return;

    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        if (!this.ctx || this.muted || this.volume <= 0) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150 + Math.random() * 200, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(this.getGain(0.15), this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
      }, i * 60);
    }
  }

  playStep() {
    if (this.muted || this.volume <= 0) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, this.ctx.currentTime + 0.06);

    gain.gain.setValueAtTime(this.getGain(0.2), this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.06);
  }

  playCapture() {
    this.playPieceHit();
  }

  playWinFanfare() {
    if (this.muted || this.volume <= 0) return;
    this.initCtx();
    if (!this.ctx) return;

    const notes = [261.63, 329.63, 392.00, 523.25]; // C E G C
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        if (!this.ctx || this.muted || this.volume <= 0) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(this.getGain(0.3), this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.4);
      }, idx * 150);
    });
  }

  playClick() {
    if (this.muted || this.volume <= 0) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(this.getGain(0.15), this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }
}

export const sounds = new SoundManager();

