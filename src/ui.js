/**
 * UI Module for Patte Par Patta
 *
 * Handles all DOM rendering: screen management, player setup,
 * gameplay rendering, turn transitions, results, lobby, and toasts.
 * Imports card-renderer.js for card face/back elements.
 */

import { renderCardFace, renderCardBack } from './card-renderer.js';

// =========================================================
// 6.1 — Screen management
// =========================================================

/**
 * Hides all `.screen` elements, then shows the one matching screenId.
 * @param {string} screenId - The id of the screen to show
 */
export function showScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach((s) => s.setAttribute('hidden', ''));

  const target = document.getElementById(screenId);
  if (target) {
    target.removeAttribute('hidden');
  }
}

/**
 * Creates a temporary toast element, auto-removes after duration.
 * @param {string} message - Toast message text
 * @param {number} [duration=1500] - Duration in ms before auto-removal
 */
export function showToast(message, duration = 1500) {
  const toast = document.createElement('div');
  toast.className = 'game-toast';
  toast.textContent = message;
  toast.setAttribute('role', 'alert');

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

// =========================================================
// 6.2 — Player setup screen
// =========================================================

/** Default emoji set for avatar selection */
const DEFAULT_EMOJIS = ['👲', '🧑‍💼', '👩‍💼', '🥷', '🧙', '🧝‍♀️'];

/**
 * Dynamically creates name input + emoji picker rows in #player-inputs.
 * Each row has an emoji button that opens a picker, and a name input.
 * @param {number} count - Number of players (2–4)
 * @param {string[]} [emojis] - Available emojis (defaults to DEFAULT_EMOJIS)
 */
export function renderPlayerInputs(count, emojis = DEFAULT_EMOJIS) {
  const container = document.getElementById('player-inputs');
  if (!container) return;

  container.innerHTML = '';

  // Get the shared emoji options panel
  const emojiOptions = document.querySelector('.emoji-options');

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'player-input-row';
    row.dataset.playerIndex = i;

    // Emoji button — shows selected emoji, opens picker on click
    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'player-emoji-btn';
    emojiBtn.type = 'button';
    emojiBtn.textContent = emojis[i % emojis.length];
    emojiBtn.dataset.selectedEmoji = emojis[i % emojis.length];
    emojiBtn.setAttribute('aria-label', `Select emoji for Player ${i + 1}`);

    emojiBtn.addEventListener('click', () => {
      _openEmojiPicker(emojiBtn, emojiOptions, emojis);
    });

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 12;
    nameInput.placeholder = `Player ${i + 1}`;
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('aria-label', `Name for Player ${i + 1}`);

    row.appendChild(emojiBtn);
    row.appendChild(nameInput);
    container.appendChild(row);
  }
}

/**
 * Opens the shared emoji picker panel positioned for a specific emoji button.
 * @param {HTMLElement} triggerBtn - The emoji button that was clicked
 * @param {HTMLElement|null} emojiOptions - The shared .emoji-options panel
 * @param {string[]} emojis - Available emojis
 */
function _openEmojiPicker(triggerBtn, emojiOptions, emojis) {
  if (!emojiOptions) return;

  // Toggle visibility
  const isVisible = !emojiOptions.hidden;
  if (isVisible && emojiOptions._activeTrigger === triggerBtn) {
    emojiOptions.hidden = true;
    emojiOptions._activeTrigger = null;
    return;
  }

  emojiOptions.hidden = false;
  emojiOptions._activeTrigger = triggerBtn;

  // Update selected state on emoji buttons
  const emojiButtons = emojiOptions.querySelectorAll('.emoji-btn');
  emojiButtons.forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.emoji === triggerBtn.dataset.selectedEmoji);
  });

  // Clone and replace to remove old listeners
  emojiButtons.forEach((btn) => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
      triggerBtn.textContent = newBtn.dataset.emoji;
      triggerBtn.dataset.selectedEmoji = newBtn.dataset.emoji;
      emojiOptions.hidden = true;
      emojiOptions._activeTrigger = null;
    });
  });
}

/**
 * Reads all player names and selected emojis from the setup form.
 * @returns {Array<{name: string, emoji: string}>}
 */
export function getPlayerSetupData() {
  const container = document.getElementById('player-inputs');
  if (!container) return [];

  const rows = container.querySelectorAll('.player-input-row');
  const data = [];

  rows.forEach((row, i) => {
    const emojiBtn = row.querySelector('.player-emoji-btn');
    const nameInput = row.querySelector('input');

    data.push({
      name: (nameInput && nameInput.value.trim()) || `Player ${i + 1}`,
      emoji: (emojiBtn && emojiBtn.dataset.selectedEmoji) || DEFAULT_EMOJIS[i % DEFAULT_EMOJIS.length],
    });
  });

  return data;
}


// =========================================================
// 6.3 — Gameplay screen rendering
// =========================================================

/**
 * Renders the full gameplay screen with all player decks, pile, and event bar.
 *
 * @param {object} state - GameState from game-engine.js
 * @param {number} localPlayerIndex - Index of the player viewing the screen
 * @param {boolean} isOffline - true for offline pass-and-play mode
 */
export function renderGameplay(state, localPlayerIndex, isOffline) {
  const topRow = document.getElementById('top-players');
  const bottomRow = document.getElementById('bottom-players');
  if (!topRow || !bottomRow) return;

  topRow.innerHTML = '';
  bottomRow.innerHTML = '';

  // Split players symmetrically: half on top, half on bottom
  const n = state.players.length;
  const topCount = Math.floor(n / 2);

  state.players.forEach((player, i) => {
    const slot = _createPlayerSlot(player, i, state, localPlayerIndex, isOffline);
    if (i < topCount) {
      topRow.appendChild(slot);
    } else {
      bottomRow.appendChild(slot);
    }
  });

  _renderPile(state);
}

/**
 * Creates a player slot element with emoji, deck, name, and card count.
 */
function _createPlayerSlot(player, playerIdx, state, localPlayerIndex, isOffline) {
  const slot = document.createElement('div');
  slot.className = 'player-slot';
  slot.dataset.playerIndex = playerIdx;

  if (playerIdx === state.currentPlayerIndex) {
    slot.classList.add('active-turn');
  }
  if (player.eliminated) {
    slot.classList.add('eliminated');
  }

  // In offline mode, the current player's deck is tappable
  // In online mode, only the local player's deck is tappable when it's their turn
  const isTappable = isOffline
    ? (playerIdx === state.currentPlayerIndex)
    : (playerIdx === localPlayerIndex && playerIdx === state.currentPlayerIndex);

  if (isTappable) {
    slot.classList.add('my-turn');
  }

  const emoji = document.createElement('span');
  emoji.className = 'player-slot-emoji';
  emoji.textContent = player.emoji;

  const deckWrapper = document.createElement('div');
  deckWrapper.className = 'player-slot-deck';

  if (!player.eliminated && player.hand.length > 0) {
    const deckCard = renderCardBack();
    deckCard.dataset.handIndex = '0';
    deckCard.dataset.playerIndex = playerIdx;
    deckWrapper.appendChild(deckCard);
  }

  const name = document.createElement('span');
  name.className = 'player-slot-name';
  name.textContent = player.name;

  const count = document.createElement('span');
  count.className = 'player-slot-count';
  count.textContent = player.eliminated ? 'Out' : `🃏 ${player.hand.length}`;

  slot.appendChild(emoji);
  slot.appendChild(deckWrapper);
  slot.appendChild(name);
  slot.appendChild(count);

  return slot;
}

/**
 * Renders the pile area: top card face-up or empty, plus pile count.
 */
function _renderPile(state) {
  const pileCard = document.getElementById('pile-card');
  const pileCount = document.getElementById('pile-count');

  if (pileCard) {
    pileCard.innerHTML = '';
    if (state.pile.length > 0) {
      const topCard = state.pile[state.pile.length - 1];
      const cardEl = renderCardFace(topCard);
      // Remove hover/click styles from pile card
      cardEl.style.cursor = 'default';
      pileCard.appendChild(cardEl);
    }
  }

  if (pileCount) {
    pileCount.textContent = `Pile: ${state.pile.length}`;
  }
}

/**
 * Sets an event message in the event bar.
 * @param {string} message - The event message to display
 */
export function setEventMessage(message) {
  const bar = document.getElementById('event-bar');
  if (bar) bar.textContent = message;
}


// =========================================================
// 6.4 — Turn transition screen
// =========================================================

/**
 * Shows the turn transition screen with "Pass device to {name} {emoji}".
 * Returns a Promise that resolves when the "I'm Ready" button is clicked.
 *
 * @param {string} nextPlayerName - Name of the next player
 * @param {string} nextPlayerEmoji - Emoji of the next player
 * @returns {Promise<void>}
 */
export function showTurnTransition(nextPlayerName, nextPlayerEmoji) {
  const message = document.getElementById('transition-message');
  if (message) {
    message.textContent = `Pass device to ${nextPlayerName} ${nextPlayerEmoji}`;
  }

  showScreen('turn-transition-screen');

  return new Promise((resolve) => {
    const btn = document.getElementById('btn-ready');
    if (!btn) {
      resolve();
      return;
    }

    // Clone to remove old listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
      resolve();
    }, { once: true });
  });
}

// =========================================================
// 6.5 — Results screen
// =========================================================

/**
 * Renders the results screen: winner display and all players' bounty list.
 * @param {object} state - GameState (status === 'finished')
 */
export function renderResults(state) {
  const winnerDisplay = document.getElementById('winner-display');
  const bountyList = document.getElementById('results-bounty-list');

  // Render winner
  if (winnerDisplay) {
    winnerDisplay.innerHTML = '';

    if (state.winnerIndex != null) {
      const winner = state.players[state.winnerIndex];
      const emojiEl = document.createElement('div');
      emojiEl.className = 'winner-emoji';
      emojiEl.textContent = winner.emoji;

      const nameEl = document.createElement('div');
      nameEl.className = 'winner-name';
      nameEl.textContent = `${winner.name} wins!`;

      winnerDisplay.appendChild(emojiEl);
      winnerDisplay.appendChild(nameEl);
    } else {
      const drawEl = document.createElement('div');
      drawEl.className = 'winner-name';
      drawEl.textContent = 'Game ended — no winner';
      winnerDisplay.appendChild(drawEl);
    }
  }

  // Render all players' status list
  if (bountyList) {
    bountyList.innerHTML = '';

    state.players.forEach((player) => {
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${player.emoji} ${player.name}`;

      const statusSpan = document.createElement('span');
      statusSpan.className = 'bounty-value';
      if (player.eliminated) {
        statusSpan.textContent = '❌ Out';
      } else {
        statusSpan.textContent = `🃏 ${player.hand.length} cards`;
      }

      li.appendChild(nameSpan);
      li.appendChild(statusSpan);
      bountyList.appendChild(li);
    });
  }
}

/**
 * Renders ready indicators for play-again flow (same pattern as Tambola).
 * Green dot for ready, red dot for left, neutral for waiting.
 *
 * @param {string[]} playerNames - Array of player display names
 * @param {Set<number>|number[]} readyPlayers - Indices of ready players
 * @param {Set<number>|number[]} [leftPlayers] - Indices of players who left
 */
export function renderReadyIndicators(playerNames, readyPlayers, leftPlayers) {
  const container = document.getElementById('ready-indicators');
  if (!container) return;

  container.hidden = false;
  container.innerHTML = '';

  const readySet = readyPlayers instanceof Set ? readyPlayers : new Set(readyPlayers);
  const leftSet = leftPlayers instanceof Set ? leftPlayers : new Set(leftPlayers || []);

  playerNames.forEach((name, index) => {
    const dot = document.createElement('div');
    dot.className = 'ready-dot';
    if (readySet.has(index)) dot.classList.add('ready');
    if (leftSet.has(index)) dot.classList.add('not-ready');

    const circle = document.createElement('div');
    circle.className = 'dot';

    const label = document.createElement('span');
    label.className = 'dot-name';
    label.textContent = name;

    dot.appendChild(circle);
    dot.appendChild(label);
    container.appendChild(dot);
  });
}

/**
 * Renders the player list in the lobby screen with emoji + name + host badge.
 *
 * @param {Array<{name: string, emoji: string}>} players - Player objects
 * @param {boolean} isHost - Whether the current user is the host
 */
export function renderLobbyPlayers(players, isHost) {
  const list = document.getElementById('lobby-player-list');
  if (!list) return;

  list.innerHTML = '';

  players.forEach((player, index) => {
    const li = document.createElement('li');

    const emojiSpan = document.createElement('span');
    emojiSpan.textContent = player.emoji || '😀';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name || `Player ${index + 1}`;
    nameSpan.style.flex = '1';

    li.appendChild(emojiSpan);
    li.appendChild(nameSpan);

    if (index === 0) {
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'HOST';
      li.appendChild(badge);
    }

    list.appendChild(li);
  });
}
