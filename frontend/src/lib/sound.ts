// Notification sound — a short synthesized chime via the Web Audio API.
// No audio asset needed; browsers require a user gesture before audio can
// play, so the first pointer/key interaction primes (unlocks) the context.
// The user can mute it; the preference persists in localStorage.

const STORAGE_KEY = 'cn_notify_sound';

let ctx: AudioContext | null = null;
let primed = false;

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) !== 'off';
}

export function setSoundEnabled(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Unlock audio on the first user gesture (call once from a client island). */
export function primeSoundOnGesture(): void {
  if (primed || typeof window === 'undefined') return;
  primed = true;
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

/** Two-tone "ding" (~0.3s, gentle, office-friendly). */
export function playDing(): void {
  if (!isSoundEnabled()) return;
  try {
    const c = getCtx();
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    gain.connect(c.destination);
    for (const [freq, at] of [[880, 0], [1174.66, 0.12]] as const) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    }
  } catch {
    /* audio unavailable — silence is fine */
  }
}
