/**
 * Shared Sound Module — Web Audio API synthesis
 * Used by both phone.html and tv.html
 * TV mode has richer sounds (harmony layers, sparkle effects)
 */
const GameSounds = (() => {
  let audioCtx = null;
  let mode = 'phone'; // 'phone' or 'tv'
  let isMutedFn = () => false;

  function init(options = {}) {
    mode = options.mode || 'phone';
    if (options.isMuted) isMutedFn = options.isMuted;
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playTone(freqs, duration, type) {
    freqs.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime + i * duration);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * duration + duration + 0.1);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * duration);
      osc.stop(audioCtx.currentTime + i * duration + duration + 0.15);
    });
  }

  function playChord(freqs, duration, type, vol) {
    freqs.forEach(freq => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration + 0.05);
    });
  }

  function playFanfare() {
    const melody = [523, 659, 784, 1047, 784, 1047];
    const durations = [0.15, 0.15, 0.15, 0.3, 0.1, 0.4];
    let time = audioCtx.currentTime;

    melody.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + durations[i]);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(time);
      osc.stop(time + durations[i] + 0.05);

      // TV: harmony layer (lower octave, softer)
      if (mode === 'tv') {
        const harmony = [262, 330, 392, 523, 392, 523];
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = harmony[i];
        gain2.gain.setValueAtTime(0.06, time);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + durations[i]);
        osc2.connect(gain2).connect(audioCtx.destination);
        osc2.start(time);
        osc2.stop(time + durations[i] + 0.05);
      }

      time += durations[i];
    });

    // TV: final sustain chord
    if (mode === 'tv') {
      setTimeout(() => playChord([523, 659, 784, 1047], 0.8, 'triangle', 0.06), 1200);
    }
  }

  function playReveal() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);

    // TV: sparkle layer
    if (mode === 'tv') {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(400, audioCtx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1600, audioCtx.currentTime + 0.3);
      gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc2.connect(gain2).connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.4);
    }
  }

  function playTick() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06);
  }

  function playNFHowl() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const vibrato = audioCtx.createOscillator();
    const vibratoGain = audioCtx.createGain();
    vibrato.frequency.value = 6;
    vibratoGain.gain.value = 15;
    vibrato.connect(vibratoGain).connect(osc.frequency);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(400, audioCtx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(350, audioCtx.currentTime + 1.2);
    osc.frequency.linearRampToValueAtTime(180, audioCtx.currentTime + 1.8);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.0);
    osc.connect(gain).connect(audioCtx.destination);
    vibrato.start();
    osc.start();
    osc.stop(audioCtx.currentTime + 2.1);
    vibrato.stop(audioCtx.currentTime + 2.1);
  }

  function playSound(type) {
    if (isMutedFn()) return;
    ensureAudio();
    if (!audioCtx) return;

    switch (type) {
      case 'join':
        playTone([440, 554, 659], 0.08, 'sine');
        playChord([880], 0.1, 'triangle', mode === 'tv' ? 0.05 : 0.04);
        break;
      case 'round-start':
        playTone([330, 440, 554, 659], 0.12, 'square');
        setTimeout(() => playChord([659, 880], 0.2, 'sine', mode === 'tv' ? 0.08 : 0.06), 500);
        break;
      case 'submit':
        playTone([500, 700], 0.06, 'sine');
        break;
      case 'vote-open':
        playTone([600, 700, 800], 0.12, 'sine');
        playChord([1200], 0.08, 'triangle', mode === 'tv' ? 0.04 : 0.03);
        break;
      case 'vote-cast':
        playTone([600, 800], 0.06, 'sine');
        break;
      case 'vote-close':
        playTone([800, 600, 400], 0.15, 'sine');
        if (mode === 'tv') playChord([200], 0.3, 'triangle', 0.06);
        break;
      case 'times-up':
        playTone([440, 330, 220], 0.2, 'sawtooth');
        if (mode === 'tv') playChord([880, 660], 0.15, 'square', 0.06);
        break;
      case 'results':
        playTone([330, 440, 554, 659, 880], 0.15, 'sine');
        if (mode === 'tv') setTimeout(() => playChord([880, 1100, 1320], 0.25, 'triangle', 0.06), 700);
        break;
      case 'reveal': playReveal(); break;
      case 'tick': playTick(); break;
      case 'gameover': playFanfare(); break;
      case 'countdown-warning':
        if (mode === 'tv') {
          playChord([150], 0.15, 'sine', 0.12);
          setTimeout(() => playChord([150], 0.1, 'sine', 0.08), 200);
        }
        break;
      // Night Falls sounds
      case 'nf-role-reveal':
        playChord([110, 165, 220], mode === 'tv' ? 0.8 : 0.6, 'sine', mode === 'tv' ? 0.1 : 0.08);
        if (mode === 'tv') setTimeout(() => playChord([138, 207, 277], 0.6, 'triangle', 0.06), 600);
        break;
      case 'nf-night':
        if (mode === 'tv') {
          playNFHowl();
        } else {
          playChord([150, 200], 0.5, 'sine', 0.06);
        }
        break;
      case 'nf-day':
        playChord([330, 415, 523], 0.3, 'sine', mode === 'tv' ? 0.1 : 0.08);
        if (mode === 'tv') setTimeout(() => playChord([523, 659, 784], 0.4, 'triangle', 0.08), 300);
        break;
      case 'nf-eliminate':
        playChord([110, 139, 165], mode === 'tv' ? 0.5 : 0.4, 'sawtooth', mode === 'tv' ? 0.08 : 0.06);
        if (mode === 'tv') setTimeout(() => playChord([98, 123, 147], 0.8, 'sine', 0.06), 300);
        break;
      case 'nf-survived':
        playChord([330, 415, 523], mode === 'tv' ? 0.4 : 0.3, 'sine', mode === 'tv' ? 0.08 : 0.06);
        setTimeout(() => playChord([784], 0.2, 'triangle', mode === 'tv' ? 0.05 : 0.04), mode === 'tv' ? 400 : 300);
        if (mode === 'tv') setTimeout(() => playChord([784, 988], 0.2, 'triangle', 0.05), 400);
        break;
      case 'nf-village-wins': playFanfare(); break;
      case 'nf-wolves-win':
        playChord([110, 138, 165], 0.4, 'sawtooth', mode === 'tv' ? 0.1 : 0.08);
        if (mode === 'tv') {
          setTimeout(() => playChord([82, 110, 138, 165], 0.8, 'sine', 0.08), 400);
          setTimeout(() => playChord([55, 82, 110], 1.2, 'triangle', 0.06), 900);
        }
        break;
      case 'nf-jester-wins':
        playChord([523, 659, 784], mode === 'tv' ? 0.12 : 0.1, 'square', mode === 'tv' ? 0.08 : 0.06);
        setTimeout(() => playChord([784, 988, 1175], mode === 'tv' ? 0.3 : 0.2, 'sine', mode === 'tv' ? 0.1 : 0.08), mode === 'tv' ? 200 : 200);
        if (mode === 'tv') setTimeout(() => playChord([659, 784, 988], 0.12, 'square', 0.08), 150);
        break;
    }
  }

  return { init, ensureAudio, playSound, playTone, playChord, playTick };
})();
