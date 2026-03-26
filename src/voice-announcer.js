/**
 * Voice Announcer for Patte Par Patta
 *
 * Handles voice announcements via Web Speech Synthesis API.
 * Supports mute toggle persisted to localStorage.
 * Follows the same pattern as Tambola's sound-manager.js.
 */

const MUTE_KEY = 'ppp_muted';

let audioCtxUnlocked = false;

/**
 * Speaks a text string via Web Speech Synthesis.
 * Returns a Promise that resolves when speech ends.
 * No-op when muted or Speech Synthesis is unavailable.
 *
 * @param {string} text - The text to speak
 * @returns {Promise<void>}
 */
function speak(text) {
  if (isMuted()) return Promise.resolve();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // 150ms delay before speaking (Safari fix from Tambola)
    setTimeout(() => {
      try {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
        // Safety timeout in case onend never fires
        setTimeout(resolve, 4000);
      } catch (_) {
        resolve();
      }
    }, 150);
  });
}

/**
 * Announces "{playerName} captures!" via Speech Synthesis.
 * @param {string} playerName
 * @returns {Promise<void>}
 */
export function announceCapture(playerName) {
  return speak(`${playerName} captures!`);
}

/**
 * Announces "{playerName} wins the game!" via Speech Synthesis.
 * @param {string} playerName
 * @returns {Promise<void>}
 */
export function announceWin(playerName) {
  return speak(`${playerName} wins the game!`);
}

/**
 * Toggles the mute state and persists it to localStorage.
 * @returns {boolean} The new mute state (true = muted)
 */
export function toggleMute() {
  const newMuted = !isMuted();
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify(newMuted));
  } catch (_) {
    // localStorage full or unavailable — continue without persistence
  }
  return newMuted;
}

/**
 * Reads the current mute state from localStorage.
 * @returns {boolean} true if muted, false otherwise (defaults to false)
 */
export function isMuted() {
  try {
    const stored = localStorage.getItem(MUTE_KEY);
    if (stored !== null) {
      return JSON.parse(stored) === true;
    }
  } catch (_) {
    // Corrupted or unavailable localStorage — default to unmuted
  }
  return false;
}

/**
 * Attaches unlock listeners for AudioContext on first user interaction.
 * Handles click, touchstart, and keydown events with { once: true }.
 */
export function initAudio() {
  if (audioCtxUnlocked) return;
  if (typeof document === 'undefined') return;

  const unlock = () => {
    audioCtxUnlocked = true;
    // Resume AudioContext if available (for future audio needs)
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      } catch (_) {
        // AudioContext not available — no-op
      }
    }
  };

  const events = ['click', 'touchstart', 'keydown'];
  for (const event of events) {
    document.addEventListener(event, unlock, { once: true });
  }
}
