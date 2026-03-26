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
const DEFAULT_EMOJIS = ['😀', '😎', '🤩', '😇', '🥳', '😏', '🤠', '😺'];

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
 * Renders the full gameplay screen from game state.
 *
 * @param {object} state - GameState from game-engine.js
 * @param {number} localPlayerIndex - Index of the player viewing the screen
 * @param {boolean} isOffline - true for offline pass-and-play mode
 */
export function renderGameplay(state, localPlayerIndex, isOffline) {
  _renderOpponents(state, localPlayerIndex, isOffline);
  _renderPile(state);
  _renderTurnIndicator(state, localPlayerIndex);
  _renderPlayerHand(state, localPlayerIndex, isOffline);
  _renderPlayerStats(state, localPlayerIndex);
}

/**
 * Renders opponent info rows in #opponents-area.
 */
function _renderOpponents(state, localPlayerIndex, isOffline) {
  const area = document.getElementById('opponents-area');
  if (!area) return;

  area.innerHTML = '';

  state.players.forEach((player, i) => {
    if (i === localPlayerIndex) return; // skip local player

    const row = document.createElement('div');
    row.className = 'opponent-info';

    if (i === state.currentPlayerIndex) {
      row.classList.add('active-turn');
    }
    if (player.eliminated) {
      row.classList.add('eliminated');
    }

    const emoji = document.createElement('span');
    emoji.className = 'opponent-emoji';
    emoji.textContent = player.emoji;

    const name = document.createElement('span');
    name.className = 'opponent-name';
    name.textContent = player.name;

    const cards = document.createElement('span');
    cards.className = 'opponent-cards';
    cards.textContent = `🃏 ${player.hand.length}`;

    row.appendChild(emoji);
    row.appendChild(name);
    row.appendChild(cards);

    area.appendChild(row);
  });
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
 * Renders the turn indicator with current player's emoji + name.
 */
function _renderTurnIndicator(state, localPlayerIndex) {
  const indicator = document.getElementById('turn-indicator');
  if (!indicator) return;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (state.currentPlayerIndex === localPlayerIndex) {
    indicator.textContent = `▶ ${currentPlayer.emoji} Your turn!`;
  } else {
    indicator.textContent = `▶ ${currentPlayer.emoji} ${currentPlayer.name}'s turn`;
  }
}

/**
 * Renders the player's hand as a single face-down deck.
 * Player taps the deck to throw the top card (index 0).
 * Shows card count on the deck.
 */
function _renderPlayerHand(state, localPlayerIndex, isOffline) {
  const handContainer = document.getElementById('player-hand');
  if (!handContainer) return;

  handContainer.innerHTML = '';

  const playerIndex = isOffline ? state.currentPlayerIndex : localPlayerIndex;
  const player = state.players[playerIndex];

  if (!player || player.eliminated || player.hand.length === 0) return;

  // Single face-down deck card
  const deckEl = renderCardBack();
  deckEl.dataset.handIndex = '0'; // always throw the top card
  deckEl.classList.add('player-deck');
  deckEl.setAttribute('aria-label', `Your deck - ${player.hand.length} cards. Tap to throw.`);
  deckEl.style.cursor = 'pointer';

  // Card count overlay on the deck
  const countBadge = document.createElement('span');
  countBadge.className = 'deck-count-badge';
  countBadge.textContent = player.hand.length;
  deckEl.appendChild(countBadge);

  handContainer.appendChild(deckEl);
}

/**
 * Updates hand count and bounty count displays.
 */
function _renderPlayerStats(state, localPlayerIndex) {
  const handCount = document.getElementById('hand-count');
  const bountyCount = document.getElementById('bounty-count');

  const player = state.players[localPlayerIndex];
  if (!player) return;

  if (handCount) {
    handCount.textContent = `Hand: ${player.hand.length}`;
  }
  if (bountyCount) {
    bountyCount.hidden = true;
  }
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

    const winner = state.winnerIndex != null ? state.players[state.winnerIndex] : null;

    if (winner) {
      const emojiEl = document.createElement('div');
      emojiEl.className = 'winner-emoji';
      emojiEl.textContent = winner.emoji;

      const nameEl = document.createElement('div');
      nameEl.className = 'winner-name';
      nameEl.textContent = `${winner.name} wins!`;

      winnerDisplay.appendChild(emojiEl);
      winnerDisplay.appendChild(nameEl);
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
