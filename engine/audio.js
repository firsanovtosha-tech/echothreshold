/* "Рубеж Эха" — процедурный звук на WebAudio (раздел 12 мастер-промпта).
 * Никаких внешних файлов: все звуки синтезируются. */
(function (root) {
  'use strict';

  class AudioMgr {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.musicOn = false;
      this.sfxVolume = 0.7;
      this.musicVolume = 0.5;
      this.enabled = true;
    }

    ensure() {
      if (!this.enabled) return false;
      try {
        if (!this.ctx) {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) { this.enabled = false; return false; }
          this.ctx = new AC();
          this.masterGain = this.ctx.createGain();
          this.masterGain.connect(this.ctx.destination);
          this.sfxGain = this.ctx.createGain();
          this.sfxGain.connect(this.masterGain);
          this.musicGain = this.ctx.createGain();
          this.musicGain.connect(this.masterGain);
          this.setVolumes(this.musicVolume, this.sfxVolume);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      } catch (e) { this.enabled = false; return false; }
    }

    setVolumes(music, sfx) {
      this.musicVolume = music; this.sfxVolume = sfx;
      if (this.musicGain) this.musicGain.gain.value = music * 0.35;
      if (this.sfxGain) this.sfxGain.gain.value = sfx * 0.6;
    }

    // ---------- SFX ----------
    blip(freq, dur, type, gain) {
      if (!this.ensure()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime((gain || 0.2), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
    }

    noise(dur, filterFreq, gain) {
      if (!this.ensure()) return;
      const t = this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
      const g = this.ctx.createGain(); g.gain.value = gain || 0.25;
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start(t);
    }

    play(kind) {
      switch (kind) {
        case 'ui': this.blip(660, 0.06, 'square', 0.12); break;
        case 'build': this.blip(320, 0.09, 'triangle', 0.2); setTimeout(() => this.blip(480, 0.09, 'triangle', 0.18), 70); break;
        case 'error': this.blip(160, 0.16, 'sawtooth', 0.18); break;
        case 'shoot': this.blip(880, 0.03, 'square', 0.05); break;
        case 'boom': this.noise(0.25, 400, 0.25); break;
        case 'coin': this.blip(980, 0.05, 'square', 0.1); setTimeout(() => this.blip(1320, 0.07, 'square', 0.1), 50); break;
        case 'wave': this.blip(220, 0.2, 'sawtooth', 0.15); setTimeout(() => this.blip(330, 0.25, 'sawtooth', 0.15), 160); break;
        case 'leak': this.noise(0.4, 220, 0.4); this.blip(110, 0.4, 'sine', 0.25); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'triangle', 0.2), i * 140)); break;
        case 'lose': [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'sawtooth', 0.16), i * 180)); break;
      }
    }

    // ---------- фоновая музыка: медленный арпеджированный луп ----------
    startMusic() {
      if (!this.ensure() || this.musicOn) return;
      this.musicOn = true;
      const scale = [110, 130.81, 164.81, 196, 220, 261.63, 329.63];
      let step = 0;
      this._musicTimer = setInterval(() => {
        if (!this.musicOn) return;
        const t = this.ctx.currentTime;
        const f = scale[(step * 3 + Math.floor(step / 4)) % scale.length];
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * (step % 8 < 4 ? 1 : 2);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o.connect(g); g.connect(this.musicGain);
        o.start(t); o.stop(t + 1);
        step++;
      }, 480);
    }

    stopMusic() {
      this.musicOn = false;
      if (this._musicTimer) clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  }

  root.TD = root.TD || {};
  root.TD.Audio = new AudioMgr();
})(typeof window !== 'undefined' ? window : globalThis);
