let audioCtx: AudioContext | null = null;
let soundEnabled = true;

export const setSoundEnabled = (enabled: boolean) => {
  soundEnabled = enabled;
  try {
    localStorage.setItem('project_x_sound_enabled', enabled ? 'true' : 'false');
  } catch (e) {}
};

export const getSoundEnabled = (): boolean => {
  try {
    const val = localStorage.getItem('project_x_sound_enabled');
    return val !== 'false';
  } catch (e) {
    return true;
  }
};

// Initialize soundEnabled on startup
try {
  soundEnabled = getSoundEnabled();
} catch (e) {}

const getAudioContext = (): AudioContext => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

// Play a short synth note using oscillators
const playNote = (
  freq: number,
  type: OscillatorType,
  duration: number,
  gainStart: number,
  gainEnd: number,
  delay: number = 0
) => {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

    gainNode.gain.setValueAtTime(gainStart, ctx.currentTime + delay);
    // Exponential ramp requires a positive value for gainEnd
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainEnd), ctx.currentTime + delay + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);

    // Clean up nodes after play stops to prevent memory leak
    setTimeout(() => {
      try {
        osc.disconnect();
        gainNode.disconnect();
      } catch (e) {}
    }, (delay + duration + 0.1) * 1000);
  } catch (e) {
    console.error('Audio playback failed:', e);
  }
};

// Play a tactile micro-click
export const playClick = () => {
  playNote(1000, 'sine', 0.03, 0.03, 0.0001);
};

// Ascending happy chime for swipe like
export const playSwipeLike = () => {
  const now = 0;
  playNote(523.25, 'sine', 0.08, 0.12, 0.0001, now);     // C5
  playNote(659.25, 'sine', 0.1, 0.1, 0.0001, now + 0.05);  // E5
  playNote(783.99, 'sine', 0.18, 0.08, 0.0001, now + 0.1);  // G5
};

// Softer downward sine note for swipe nope
export const playSwipeNope = () => {
  const now = 0;
  playNote(392.00, 'sine', 0.08, 0.08, 0.0001, now);       // G4
  playNote(329.63, 'sine', 0.12, 0.06, 0.0001, now + 0.04);  // E4
};

// Sparkly arpeggio for auto evolve (Gen mutation)
export const playEvolve = () => {
  const now = 0;
  playNote(523.25, 'sine', 0.12, 0.12, 0.0001, now);       // C5
  playNote(659.25, 'sine', 0.12, 0.1, 0.0001, now + 0.06);  // E5
  playNote(783.99, 'sine', 0.12, 0.08, 0.0001, now + 0.12); // G5
  playNote(1046.50, 'sine', 0.15, 0.08, 0.0001, now + 0.18); // C6
  playNote(1318.51, 'sine', 0.25, 0.06, 0.0001, now + 0.24); // E6
};

// Retro 8-bit double coin sound for purchases
export const playPurchase = () => {
  const now = 0;
  playNote(987.77, 'square', 0.06, 0.08, 0.0001, now);    // B5
  playNote(1318.51, 'square', 0.22, 0.06, 0.0001, now + 0.06); // E6
};

// Chord swell for project creation or forks
export const playCreate = () => {
  const now = 0;
  playNote(261.63, 'sine', 0.35, 0.12, 0.0001, now); // C4
  playNote(329.63, 'sine', 0.35, 0.1, 0.0001, now + 0.04); // E4
  playNote(392.00, 'sine', 0.35, 0.08, 0.0001, now + 0.08); // G4
  playNote(523.25, 'sine', 0.45, 0.08, 0.0001, now + 0.12); // C5
};

// Sawtooth buzz for stamina empty / soul empty / error
export const playError = () => {
  const now = 0;
  playNote(146.83, 'sawtooth', 0.1, 0.12, 0.001, now); // D3
  playNote(146.83, 'sawtooth', 0.15, 0.12, 0.001, now + 0.08); // D3
};
