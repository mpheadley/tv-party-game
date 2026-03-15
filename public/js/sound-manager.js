/**
 * Sound Manager
 * Handles all audio playback for game events
 * Uses Web Audio API with graceful fallback to HTML5 audio
 */

class SoundManager {
  constructor() {
    this.enabled = true;
    this.volume = 1.0;
    this.audioContext = null;
    this.audioBuffers = {};
    this.sounds = {
      'round-start': { freq: 800, duration: 0.2, type: 'sine' },
      'times-up': { freq: 1200, duration: 0.5, type: 'sine' },
      'vote-open': { freq: 600, duration: 0.3, type: 'sine' },
      'vote-close': { freq: 900, duration: 0.3, type: 'sine' },
      'vote-success': { freq: 1000, duration: 0.15, type: 'square' },
      'winner': { freq: 1500, duration: 0.4, type: 'sine' },
      'correct': { freq: 1200, duration: 0.2, type: 'sine' },
      'error': { freq: 400, duration: 0.3, type: 'sine' },
      'click': { freq: 700, duration: 0.1, type: 'sine' },
    };

    this.init();
  }

  init() {
    try {
      const audioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new audioContextClass();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }

    this.loadMutePreference();
    this.setupMuteButton();
  }

  loadMutePreference() {
    const saved = localStorage.getItem('sound-enabled');
    if (saved !== null) {
      this.enabled = saved === 'true';
    }
  }

  saveMutePreference() {
    localStorage.setItem('sound-enabled', this.enabled);
  }

  setupMuteButton() {
    // Create mute button if it doesn't exist
    if (!document.getElementById('mute-button')) {
      const button = document.createElement('button');
      button.id = 'mute-button';
      button.className = 'mute-button';
      button.textContent = this.enabled ? '🔊' : '🔇';
      button.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        background: rgba(102, 126, 234, 0.2);
        border: 2px solid #506be6;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        cursor: pointer;
        font-size: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        transition: background 0.2s ease;
      `;
      button.addEventListener('click', () => this.toggle());
      button.addEventListener('mouseover', () => {
        button.style.background = 'rgba(102, 126, 234, 0.4)';
      });
      button.addEventListener('mouseout', () => {
        button.style.background = this.enabled ? 'rgba(102, 126, 234, 0.2)' : 'rgba(200, 50, 50, 0.2)';
      });
      document.body.appendChild(button);
      this.muteButton = button;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    this.saveMutePreference();
    if (this.muteButton) {
      this.muteButton.textContent = this.enabled ? '🔊' : '🔇';
      this.muteButton.style.borderColor = this.enabled ? '#506be6' : '#c83232';
      this.muteButton.style.background = this.enabled ? 'rgba(102, 126, 234, 0.2)' : 'rgba(200, 50, 50, 0.2)';
    }
  }

  /**
   * Play a sound effect by name
   * @param {string} soundName - Key of sound to play
   */
  play(soundName) {
    if (!this.enabled || !this.audioContext) return;

    const soundConfig = this.sounds[soundName];
    if (!soundConfig) {
      console.warn(`Unknown sound: ${soundName}`);
      return;
    }

    try {
      this.playTone(soundConfig);
    } catch (e) {
      console.error('Error playing sound:', e);
    }
  }

  /**
   * Play a tone using Web Audio API
   */
  playTone(config) {
    const { freq, duration, type } = config;
    const now = this.audioContext.currentTime;
    const endTime = now + duration;

    // Create oscillator
    const osc = this.audioContext.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    // Create gain for volume control
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.2 * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, endTime);

    // Connect and play
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    osc.start(now);
    osc.stop(endTime);
  }

  /**
   * Play celebration sound (series of beeps)
   */
  playCelebration() {
    if (!this.enabled || !this.audioContext) return;

    const beeps = [
      { freq: 1200, delay: 0, duration: 0.1 },
      { freq: 1500, delay: 0.15, duration: 0.1 },
      { freq: 1800, delay: 0.3, duration: 0.15 },
    ];

    beeps.forEach(({ freq, delay, duration }) => {
      setTimeout(() => this.playTone({ freq, duration, type: 'sine' }), delay * 1000);
    });
  }

  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, level));
  }
}

// Create global sound manager instance
const soundManager = new SoundManager();

// Export for use in modules (if using ES6 modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SoundManager;
}
