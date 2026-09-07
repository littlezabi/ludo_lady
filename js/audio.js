/**
 * Ludo Lady - Audio Manager
 * Web Audio API procedural sound synthesizer.
 */

(function() {
  class AudioManager {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }
    
    /** Initialize AudioContext on first user gesture */
    init() {
      if (!this.ctx) {
        // @ts-ignore
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }
    
    /** Dice roll: short noise burst with rising pitch */
    playDiceRoll() {
      if (this.muted || !this.ctx) return;
      this._playNoise(0.3, 0.15);
      this._playTone(200, 0.1, 'square', 0.1);
      setTimeout(() => this._playTone(400, 0.1, 'square', 0.1), 100);
    }
    
    /** Token move: short click */
    playTokenMove() {
      if (this.muted || !this.ctx) return;
      this._playTone(800, 0.05, 'sine', 0.2);
    }
    
    /** Capture: dramatic low thump */
    playCapture() {
      if (this.muted || !this.ctx) return;
      this._playTone(100, 0.3, 'sine', 0.4);
      this._playTone(80, 0.2, 'square', 0.15);
    }
    
    /** Token finished: ascending chime */
    playFinish() {
      if (this.muted || !this.ctx) return;
      [523, 659, 784].forEach((f, i) => {
        setTimeout(() => this._playTone(f, 0.15, 'sine', 0.25), i * 120);
      });
    }
    
    /** Win: celebration melody */
    playWin() {
      if (this.muted || !this.ctx) return;
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => this._playTone(f, 0.3, 'sine', 0.3), i * 200);
      });
    }
    
    /** Your turn notification */
    playYourTurn() {
      if (this.muted || !this.ctx) return;
      this._playTone(880, 0.1, 'sine', 0.2);
      setTimeout(() => this._playTone(1100, 0.15, 'sine', 0.2), 120);
    }
    
    /** Error buzz */
    playError() {
      if (this.muted || !this.ctx) return;
      this._playTone(150, 0.2, 'sawtooth', 0.15);
    }
    
    toggleMute() { this.muted = !this.muted; return this.muted; }
    
    _playTone(freq, duration, type = 'sine', gain = 0.3) {
      if (!this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        
        gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch(e) {}
    }
    
    _playNoise(duration, gain = 0.2) {
      if (!this.ctx) return;
      try {
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        noise.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        noise.start();
      } catch(e) {}
    }
  }

  window.AudioManager = AudioManager;
})();
