/**
 * Main Entry Point for Patte Par Patta
 *
 * Wires all modules together: home screen, offline/online game flows,
 * card tap handling, animations, voice, and service worker.
 */

import {
  createGame,
  throwCard,
  advanceTurn,
  checkWinCondition,
  validateState,
} from './game-engine.js';

import {
  showScreen,
  showToast,
  renderPlayerInputs,
  getPlayerSetupData,
  renderGameplay,
  showTurnTransition,
  renderResults,
  renderLobbyPlayers,
  renderReadyIndicators,
} from './ui.js';

import { animateSlide, animateSweep, animateThrowToPile } from './animation-manager.js';
import { renderCardFace } from './card-renderer.js';
import { announceCapture, announceWin, initAudio, toggleMute, isMuted } from './voice-announcer.js';
import { deserializeCard } from './deck.js';
import {
  createRoom,
  joinRoom,
  listenRoom,
  writeThrow,
  writeGameState,
  setupDisconnectHandler,
  endRoom,
  deleteRoom,
  resetRoom,
  firebaseRetry,
} from './firebase-sync.js';
import { db } from './firebase-config.js';
import { ref, get, update, onValue, off, remove } from 'firebase/database';

/* ======= STATE ======= */

let state = null;
let gameMode = 'offline'; // 'offline' | 'online'
let isProcessingTurn = false; // prevents double-tap during animations

// Online state
let roomCode = null;
let playerIndex = null;
let isHost = false;
let playerNames = [];
let unsubscribeRoom = null;
let lastMoveTimestamp = 0;

/* ======= DOM REFERENCES ======= */

const btnOffline = document.getElementById('btn-offline');
const btnOnline = document.getElementById('btn-online');
const btnStartGame = document.getElementById('btn-start-game');
const btnBackSetup = document.getElementById('btn-back-setup');
const btnBackOnline = document.getElementById('btn-back-online');
const btnEndGame = document.getElementById('btn-end-game');
const muteToggle = document.getElementById('mute-toggle');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnHome = document.getElementById('btn-home');
const playerHand = document.getElementById('player-hand');

/* ======= HELPERS ======= */

/** Saves online session info to localStorage for reconnection after refresh. */
function saveOnlineSession() {
  if (gameMode === 'online' && roomCode != null && playerIndex != null) {
    localStorage.setItem('ppp_session', JSON.stringify({
      roomCode,
      playerIndex,
      isHost,
    }));
  }
}

/** Clears saved online session. */
function clearOnlineSession() {
  localStorage.removeItem('ppp_session');
}

/** Loads saved online session from localStorage. */
function loadOnlineSession() {
  try {
    const raw = localStorage.getItem('ppp_session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** Cleans up online state and navigates home. */
function cleanupAndGoHome() {
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  clearOnlineSession();
  roomCode = null;
  playerIndex = null;
  isHost = false;
  playerNames = [];
  gameMode = 'offline';
  state = null;
  lastMoveTimestamp = 0;
  showScreen('home-screen');
}

/**
 * Deserializes a Firebase game snapshot into a local GameState object.
 * Converts serialized card strings back to Card objects.
 */
function deserializeGameState(gameData, playersData) {
  const playerKeys = Object.keys(playersData).sort();
  const players = playerKeys.map((key, i) => {
    const pData = playersData[key];
    const rawHand = (gameData.hands && gameData.hands[key]) || [];
    const rawBounty = (gameData.bounties && gameData.bounties[key]) || [];
    const hand = Array.isArray(rawHand) ? rawHand.map(deserializeCard) : Object.values(rawHand).map(deserializeCard);
    const bounty = Array.isArray(rawBounty) ? rawBounty.map(deserializeCard) : Object.values(rawBounty).map(deserializeCard);
    const eliminated = (gameData.eliminated && gameData.eliminated[key]) || false;

    return {
      name: pData.name || `Player ${i + 1}`,
      emoji: pData.emoji || '😀',
      hand,
      bounty,
      eliminated,
      connected: pData.connected !== false,
    };
  });

  const rawPile = gameData.pile || [];
  const pile = Array.isArray(rawPile) ? rawPile.map(deserializeCard) : Object.values(rawPile).map(deserializeCard);

  return {
    players,
    pile,
    currentPlayerIndex: gameData.currentPlayerIndex || 0,
    deckSize: gameData.deckSize || 52,
    status: gameData.status || 'playing',
    winnerIndex: gameData.winnerIndex != null ? gameData.winnerIndex : null,
  };
}

/* ======= HOME SCREEN ======= */

function wireHomeScreen() {
  btnOffline.addEventListener('click', () => {
    renderPlayerInputs(2); // default 2 players
    showScreen('player-setup-screen');
  });

  btnOnline.addEventListener('click', () => {
    showScreen('online-choice-screen');
  });
}

/* ======= PLAYER SETUP SCREEN ======= */

function wirePlayerSetup() {
  // Player count buttons
  const playerCountBtns = document.querySelectorAll('.player-count-btn');
  playerCountBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      playerCountBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const count = parseInt(btn.dataset.count, 10);
      renderPlayerInputs(count);
    });
  });

  // Deck count buttons
  const deckCountBtns = document.querySelectorAll('.deck-count-btn');
  deckCountBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      deckCountBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Start game
  btnStartGame.addEventListener('click', () => {
    const playerInfos = getPlayerSetupData();
    if (playerInfos.length < 2) {
      showToast('Need at least 2 players');
      return;
    }

    // Read deck count from active button
    const activeDeckBtn = document.querySelector('.deck-count-btn.active');
    const deckCount = activeDeckBtn ? parseInt(activeDeckBtn.dataset.deck, 10) : 1;

    state = createGame(playerInfos, deckCount);
    gameMode = 'offline';
    startOfflineGame();
  });

  // Back button
  btnBackSetup.addEventListener('click', () => {
    showScreen('home-screen');
  });
}

/* ======= OFFLINE GAME FLOW ======= */

function startOfflineGame() {
  showScreen('gameplay-screen');

  // Show end game button for offline
  if (btnEndGame) btnEndGame.hidden = false;

  renderGameplay(state, state.currentPlayerIndex, true);
  isProcessingTurn = false;
}

/**
 * Handles a card tap in the player's hand during offline mode.
 * Orchestrates: throw → validate → animate → capture → elimination → win check → advance turn.
 */
async function handleOfflineCardTap(handIndex) {
  if (!state || state.status === 'finished' || isProcessingTurn) return;
  isProcessingTurn = true;

  try {
    const currentPlayer = state.players[state.currentPlayerIndex];

    // 1. Throw the card
    const { newState, captured } = throwCard(state, handIndex);

    // 2. Validate state integrity
    const validation = validateState(newState);
    if (!validation.valid) {
      console.error('State validation failed:', validation.error);
      showToast(`Error: ${validation.error}`);
      isProcessingTurn = false;
      return;
    }

    // 3. Animate: slide face-down card from deck to pile, then flip to reveal
    const deckEl = playerHand.querySelector('.card');
    const pileArea = document.getElementById('pile-area');
    const thrownCard = state.players[state.currentPlayerIndex].hand[handIndex];

    if (deckEl && pileArea) {
      const deckRect = deckEl.getBoundingClientRect();
      const pileRect = pileArea.getBoundingClientRect();
      const faceEl = renderCardFace(thrownCard);
      await animateThrowToPile(deckRect, pileRect, faceEl);
    }

    // 4. If captured: sweep animation + voice announcement
    if (captured) {
      const pileEl = document.getElementById('pile-card');
      const deckCard = playerHand.querySelector('.card');
      if (pileEl && deckCard) {
        const targetRect = deckCard.getBoundingClientRect();
        await animateSweep(pileEl, targetRect);
      }
      announceCapture(currentPlayer.name);
    }

    // 5. Update state
    state = newState;

    // 6. Check elimination
    const thrower = state.players[state.currentPlayerIndex];
    if (thrower.eliminated) {
      showToast(`${thrower.name} is out of cards!`);
    }

    // 7. Check win condition
    const winResult = checkWinCondition(state);
    if (winResult.finished) {
      state.status = 'finished';
      state.winnerIndex = winResult.winnerIndex;

      const winner = state.players[winResult.winnerIndex];
      await announceWin(winner.name);

      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }

      renderResults(state);
      showScreen('results-screen');
      isProcessingTurn = false;
      return;
    }

    // 8. Advance turn
    state = advanceTurn(state);

    // 9. Show turn transition (offline pass-and-play)
    const nextPlayer = state.players[state.currentPlayerIndex];
    await showTurnTransition(nextPlayer.name, nextPlayer.emoji);

    // 10. Re-render gameplay for next player
    showScreen('gameplay-screen');
    renderGameplay(state, state.currentPlayerIndex, true);
  } catch (err) {
    console.error('Error during card tap:', err);
    showToast('Something went wrong');
  } finally {
    isProcessingTurn = false;
  }
}

/**
 * Handles a card tap during online mode.
 * Only the local player can throw when it's their turn.
 * Throw → validate → writeThrow → animate locally.
 */
async function handleOnlineCardTap(handIndex) {
  if (!state || state.status === 'finished' || isProcessingTurn) return;
  if (state.currentPlayerIndex !== playerIndex) return; // not our turn
  isProcessingTurn = true;

  try {
    const currentPlayer = state.players[playerIndex];

    // 1. Throw the card — save reference before state changes
    const thrownCard = state.players[playerIndex].hand[handIndex];
    const { newState, captured } = throwCard(state, handIndex);

    // 2. Validate state integrity
    const validation = validateState(newState);
    if (!validation.valid) {
      console.error('State validation failed:', validation.error);
      showToast(`Error: ${validation.error}`);
      isProcessingTurn = false;
      return;
    }

    // 3. Check win condition before advancing turn
    const winResult = checkWinCondition(newState);
    let stateToWrite;
    if (winResult.finished) {
      stateToWrite = { ...newState, status: 'finished', winnerIndex: winResult.winnerIndex };
    } else {
      // Advance turn before writing so Firebase has the correct next player
      stateToWrite = advanceTurn(newState);
    }

    // 4. Write to Firebase
    try {
      await writeThrow(roomCode, playerIndex, thrownCard, captured, stateToWrite);
    } catch (err) {
      console.error('Failed to write throw:', err, 'State:', JSON.stringify(stateToWrite, null, 2));
      showToast('Failed to sync move. Try again.');
      isProcessingTurn = false;
      return;
    }

    // 5. Animate: slide face-down card from deck to pile, then flip
    const deckEl = playerHand.querySelector('.card');
    const pileArea = document.getElementById('pile-area');

    if (deckEl && pileArea) {
      const deckRect = deckEl.getBoundingClientRect();
      const pileRect = pileArea.getBoundingClientRect();
      const faceEl = renderCardFace(thrownCard);
      await animateThrowToPile(deckRect, pileRect, faceEl);
    }

    if (captured) {
      const pileEl = document.getElementById('pile-card');
      const deckCard = playerHand.querySelector('.card');
      if (pileEl && deckCard) {
        const targetRect = deckCard.getBoundingClientRect();
        await animateSweep(pileEl, targetRect);
      }
      announceCapture(currentPlayer.name);
    }

    // 6. Update local state
    state = stateToWrite;

    // 7. Check elimination
    if (newState.players[playerIndex].eliminated) {
      showToast(`${newState.players[playerIndex].name} is out of cards!`);
    }

    // 8. Handle win
    if (winResult.finished) {
      const winner = state.players[winResult.winnerIndex];
      await announceWin(winner.name);

      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }

      renderResults(state);
      showScreen('results-screen');
      startReadyListener();
      isProcessingTurn = false;
      return;
    }

    // 9. Re-render (turn already advanced in stateToWrite)
    renderGameplay(state, playerIndex, false);
  } catch (err) {
    console.error('Error during online card tap:', err);
    showToast('Something went wrong');
  } finally {
    isProcessingTurn = false;
  }
}

/* ======= CARD TAP HANDLER (delegated) ======= */

function wireCardTapHandler() {
  playerHand.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;

    const handIndex = parseInt(cardEl.dataset.handIndex, 10);
    if (isNaN(handIndex)) return;

    if (gameMode === 'offline') {
      handleOfflineCardTap(handIndex);
    } else {
      handleOnlineCardTap(handIndex);
    }
  });
}

/* ======= END GAME ======= */

function wireEndGame() {
  if (!btnEndGame) return;

  btnEndGame.addEventListener('click', async () => {
    if (!state) return;

    // End the game immediately — winner is the player with most cards
    state.status = 'finished';

    let bestIdx = 0;
    let bestCards = -1;
    state.players.forEach((p, i) => {
      if (p.hand.length > bestCards) {
        bestCards = p.hand.length;
        bestIdx = i;
      }
    });
    state.winnerIndex = bestIdx;

    if (gameMode === 'online' && roomCode) {
      try {
        await endRoom(roomCode);
      } catch (_) {}
    }

    renderResults(state);
    showScreen('results-screen');
    if (gameMode === 'online') startReadyListener();
  });
}

/* ======= TASK 10.1: ONLINE CREATE & JOIN ROOM ======= */

function wireOnlineCreate() {
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnCreateSubmit = document.getElementById('btn-create-submit');

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
      showScreen('create-room-screen');
    });
  }

  if (btnCreateSubmit) {
    btnCreateSubmit.addEventListener('click', async () => {
      const nameInput = document.getElementById('create-name-input');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        showToast('Please enter your name');
        return;
      }

      // Get selected emoji from create-room-screen picker
      const emojiPicker = document.querySelector('#create-room-screen .emoji-picker');
      const selectedEmojiBtn = emojiPicker ? emojiPicker.querySelector('.emoji-btn.selected') : null;
      const emoji = selectedEmojiBtn ? selectedEmojiBtn.dataset.emoji : '😀';

      try {
        const result = await createRoom(name, emoji);
        roomCode = result.roomCode;
        playerIndex = result.playerIndex;
        isHost = true;
        playerNames = [name];
        gameMode = 'online';
        saveOnlineSession();
        setupLobby();
      } catch (err) {
        console.error('Failed to create room:', err);
        showToast('Failed to create room. Check your connection.');
      }
    });
  }

  // Wire emoji picker selection in create-room-screen
  wireEmojiPicker('#create-room-screen .emoji-picker');
}

function wireOnlineJoin() {
  const btnJoinRoom = document.getElementById('btn-join-room');
  const btnJoinSubmit = document.getElementById('btn-join-submit');

  if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', () => {
      showScreen('join-room-screen');
    });
  }

  if (btnJoinSubmit) {
    btnJoinSubmit.addEventListener('click', async () => {
      const codeInput = document.getElementById('room-code-input');
      const nameInput = document.getElementById('join-name-input');
      const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
      const name = nameInput ? nameInput.value.trim() : '';

      if (!code || code.length !== 4) {
        showToast('Please enter a valid 4-character room code');
        return;
      }
      if (!name) {
        showToast('Please enter your name');
        return;
      }

      // Get selected emoji from join-room-screen picker
      const emojiPicker = document.querySelector('#join-room-screen .emoji-picker');
      const selectedEmojiBtn = emojiPicker ? emojiPicker.querySelector('.emoji-btn.selected') : null;
      const emoji = selectedEmojiBtn ? selectedEmojiBtn.dataset.emoji : '😀';

      try {
        const result = await joinRoom(code, name, emoji);
        if (!result.success) {
          showToast(result.reason || 'Failed to join room');
          return;
        }
        roomCode = code;
        playerIndex = result.playerIndex;
        isHost = false;
        gameMode = 'online';
        saveOnlineSession();
        setupLobby();
      } catch (err) {
        console.error('Failed to join room:', err);
        showToast('Failed to join room. Check your connection.');
      }
    });
  }

  // Wire emoji picker selection in join-room-screen
  wireEmojiPicker('#join-room-screen .emoji-picker');
}

/** Wires emoji picker buttons within a container selector to toggle .selected class. */
function wireEmojiPicker(containerSelector) {
  const picker = document.querySelector(containerSelector);
  if (!picker) return;

  const buttons = picker.querySelectorAll('.emoji-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Select first emoji by default
  if (buttons.length > 0) {
    buttons[0].classList.add('selected');
  }
}

/* ======= TASK 10.2: LOBBY SCREEN ======= */

function setupLobby() {
  showScreen('lobby-screen');

  // Display room code
  const lobbyRoomCode = document.getElementById('lobby-room-code');
  if (lobbyRoomCode) lobbyRoomCode.textContent = roomCode;

  // Show/hide host-only controls
  const btnStartOnline = document.getElementById('btn-start-online');
  const lobbyWaiting = document.getElementById('lobby-waiting');

  if (isHost) {
    if (btnStartOnline) btnStartOnline.hidden = false;
    if (lobbyWaiting) lobbyWaiting.hidden = true;
  } else {
    if (btnStartOnline) btnStartOnline.hidden = true;
    if (lobbyWaiting) lobbyWaiting.hidden = false;
  }

  // Set up disconnect handler
  setupDisconnectHandler(roomCode, playerIndex);

  // Start listening for room changes
  if (unsubscribeRoom) unsubscribeRoom();

  unsubscribeRoom = listenRoom(roomCode, {
    onPlayersChange: (players) => {
      const playerArr = [];
      const keys = Object.keys(players).sort();
      keys.forEach((key) => playerArr.push(players[key]));
      playerNames = playerArr.map((p) => p.name || 'Unknown');
      renderLobbyPlayers(playerArr, isHost);
    },

    onStatusChange: async (status) => {
      if (status === 'active' && !isHost) {
        // Game started by host — fetch game state from Firebase
        try {
          const roomRef = ref(db, `ppp-rooms/${roomCode}`);
          const snapshot = await firebaseRetry(() => get(roomRef));
          if (snapshot.exists()) {
            const roomData = snapshot.val();
            if (roomData.game && roomData.players) {
              state = deserializeGameState(roomData.game, roomData.players);
              lastMoveTimestamp = (roomData.lastMove && roomData.lastMove.timestamp) || 0;
              startOnlineGame();
            }
          }
        } catch (err) {
          console.error('Failed to fetch game state:', err);
          showToast('Failed to load game data.');
        }
      }

      if (status === 'lobby') {
        // Play again: room reset to lobby
        state = null;
        lastMoveTimestamp = 0;
        setupLobby();
      }

      if (status === 'ended') {
        // Game ended by host
        if (state) {
          state.status = 'finished';
          // Winner is the player with most cards in hand
          let bestIdx = 0;
          let bestCards = -1;
          state.players.forEach((p, i) => {
            if (p.hand.length > bestCards) {
              bestCards = p.hand.length;
              bestIdx = i;
            }
          });
          state.winnerIndex = bestIdx;
          renderResults(state);
          showScreen('results-screen');
          startReadyListener();
        }
      }
    },

    onGameUpdate: (gameData) => {
      handleOnlineGameUpdate(gameData);
    },

    onRoomDeleted: () => {
      showToast('Host has left. Room closed.', 3000);
      cleanupAndGoHome();
    },
  });
}

function wireOnlineLobby() {
  // Share Code button
  const btnShareCode = document.getElementById('btn-share-code');
  if (btnShareCode) {
    btnShareCode.addEventListener('click', async () => {
      if (!roomCode) return;
      const shareText = `Join my Patte Par Patta game! Room code: ${roomCode}`;
      const shareUrl = window.location.origin;

      if (navigator.share) {
        try {
          await navigator.share({ title: 'Patte Par Patta', text: shareText, url: shareUrl });
          return;
        } catch (_) {}
      }

      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        showToast('Room code copied!');
      } catch (_) {
        showToast(`Room code: ${roomCode}`);
      }
    });
  }

  // Start Game (host only)
  const btnStartOnline = document.getElementById('btn-start-online');
  if (btnStartOnline) {
    btnStartOnline.addEventListener('click', async () => {
      if (!isHost || !roomCode) return;

      if (playerNames.length < 2) {
        showToast('Need at least 2 players to start');
        return;
      }

      try {
        // Fetch player data from Firebase to build game
        const playersRef = ref(db, `ppp-rooms/${roomCode}/players`);
        const snapshot = await firebaseRetry(() => get(playersRef));
        if (!snapshot.exists()) {
          showToast('No players found');
          return;
        }

        const playersData = snapshot.val();
        const playerKeys = Object.keys(playersData).sort();
        const playerInfos = playerKeys.map((key) => ({
          name: playersData[key].name || 'Unknown',
          emoji: playersData[key].emoji || '😀',
        }));

        // Read deck count (default 1)
        const metaRef = ref(db, `ppp-rooms/${roomCode}/meta`);
        const metaSnap = await firebaseRetry(() => get(metaRef));
        const deckCount = metaSnap.exists() ? (metaSnap.val().deckCount || 1) : 1;

        state = createGame(playerInfos, deckCount);
        await writeGameState(roomCode, state);
        lastMoveTimestamp = 0;
        startOnlineGame();
      } catch (err) {
        console.error('Failed to start game:', err);
        showToast('Failed to start game. Try again.');
      }
    });
  }

  // Leave lobby
  const btnLeaveLobby = document.getElementById('btn-leave-lobby');
  if (btnLeaveLobby) {
    btnLeaveLobby.addEventListener('click', async () => {
      if (isHost && roomCode) {
        try {
          await deleteRoom(roomCode);
        } catch (_) {}
      } else if (roomCode && playerIndex != null) {
        // Remove self from room
        try {
          const playerRef = ref(db, `ppp-rooms/${roomCode}/players/player_${playerIndex}`);
          await remove(playerRef);
        } catch (_) {}
      }
      cleanupAndGoHome();
    });
  }
}

/* ======= TASK 10.3: ONLINE GAME FLOW ======= */

/** Starts the online game view. */
function startOnlineGame() {
  showScreen('gameplay-screen');

  // Show end game button only for host
  if (btnEndGame) btnEndGame.hidden = !isHost;

  renderGameplay(state, playerIndex, false);
  isProcessingTurn = false;
}

/**
 * Handles game updates from Firebase for online mode.
 * Detects new moves from other players, deserializes state, animates, updates UI.
 */
function handleOnlineGameUpdate(gameData) {
  if (!gameData || !roomCode) return;

  // Skip updates while we're processing our own throw (animation in progress)
  if (isProcessingTurn) return;

  // We need players data to deserialize — fetch from the listener context
  // The game data alone has hands/bounties keyed by player_N
  // We can reconstruct state from gameData + playerNames

  // Build a minimal playersData from playerNames for deserialization
  const playersData = {};
  playerNames.forEach((name, i) => {
    playersData[`player_${i}`] = { name, emoji: state ? state.players[i]?.emoji || '😀' : '😀' };
  });

  const newState = deserializeGameState(gameData, playersData);

  // Check if this is a new move from another player (not our own)
  if (state && newState.currentPlayerIndex !== state.currentPlayerIndex) {
    // State has advanced — another player made a move
    const prevPlayerIdx = state.currentPlayerIndex;
    if (prevPlayerIdx !== playerIndex) {
      // Animate the other player's move
      const prevPlayer = state.players[prevPlayerIdx];
      const newPrevPlayer = newState.players[prevPlayerIdx];

      // Check if a capture happened (pile went from non-empty to empty)
      const wasCaptured = state.pile.length > 0 && newState.pile.length === 0 &&
        newPrevPlayer.bounty.length > prevPlayer.bounty.length;

      if (wasCaptured) {
        announceCapture(prevPlayer.name);
      }

      // Check if player was eliminated
      if (!prevPlayer.eliminated && newPrevPlayer.eliminated) {
        showToast(`${prevPlayer.name} is out of cards!`);
      }
    }
  }

  state = newState;

  // Check win condition
  if (state.status === 'finished' || (state.winnerIndex != null && state.winnerIndex >= 0)) {
    state.status = 'finished';
    const winner = state.players[state.winnerIndex];
    if (winner) {
      announceWin(winner.name);
      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    }
    renderResults(state);
    showScreen('results-screen');
    if (gameMode === 'online') startReadyListener();
    return;
  }

  // Re-render gameplay
  renderGameplay(state, playerIndex, false);
  isProcessingTurn = false;
}

/** Checks for a saved online session and attempts to rejoin. */
async function checkOnlineSession() {
  const session = loadOnlineSession();
  if (!session) return false;

  try {
    // Check if the room still exists
    const roomRef = ref(db, `ppp-rooms/${session.roomCode}`);
    const snapshot = await firebaseRetry(() => get(roomRef));

    if (!snapshot.exists()) {
      clearOnlineSession();
      return false;
    }

    const roomData = snapshot.val();
    const status = roomData.meta?.status;

    if (status === 'ended') {
      clearOnlineSession();
      return false;
    }

    // Restore session state
    roomCode = session.roomCode;
    playerIndex = session.playerIndex;
    isHost = session.isHost;
    gameMode = 'online';

    // Rebuild player names
    if (roomData.players) {
      const keys = Object.keys(roomData.players).sort();
      playerNames = keys.map((k) => roomData.players[k].name || 'Unknown');
    }

    // Mark ourselves as connected again
    try {
      await update(ref(db, `ppp-rooms/${roomCode}/players/player_${playerIndex}`), {
        connected: true,
      });
    } catch (_) {}

    if (status === 'lobby') {
      setupLobby();
      return true;
    }

    if (status === 'active' && roomData.game) {
      state = deserializeGameState(roomData.game, roomData.players);
      lastMoveTimestamp = (roomData.lastMove && roomData.lastMove.timestamp) || 0;

      // Set up disconnect handler and start listening
      setupDisconnectHandler(roomCode, playerIndex);

      if (unsubscribeRoom) unsubscribeRoom();
      unsubscribeRoom = listenRoom(roomCode, {
        onPlayersChange: (players) => {
          const playerArr = [];
          const keys = Object.keys(players).sort();
          keys.forEach((key) => playerArr.push(players[key]));
          playerNames = playerArr.map((p) => p.name || 'Unknown');
        },
        onStatusChange: async (newStatus) => {
          if (newStatus === 'lobby') {
            state = null;
            lastMoveTimestamp = 0;
            setupLobby();
          }
          if (newStatus === 'ended' && state) {
            state.status = 'finished';
            let bestIdx = 0;
            let bestBounty = -1;
            state.players.forEach((p, i) => {
              if (p.bounty.length > bestBounty) {
                bestBounty = p.bounty.length;
                bestIdx = i;
              }
            });
            state.winnerIndex = bestIdx;
            renderResults(state);
            showScreen('results-screen');
            startReadyListener();
          }
        },
        onGameUpdate: (gameData) => {
          handleOnlineGameUpdate(gameData);
        },
        onRoomDeleted: () => {
          showToast('Host has left. Room closed.', 3000);
          cleanupAndGoHome();
        },
      });

      startOnlineGame();
      return true;
    }

    clearOnlineSession();
    return false;
  } catch (err) {
    console.warn('Failed to rejoin room:', err);
    clearOnlineSession();
    return false;
  }
}

/* ======= TASK 10.4: PLAY-AGAIN FLOW ======= */

function wireResults() {
  btnPlayAgain.addEventListener('click', async () => {
    if (gameMode === 'offline') {
      state = null;
      renderPlayerInputs(2);
      showScreen('player-setup-screen');
      return;
    }

    // Online mode
    if (isHost) {
      // Host: first click signals readiness, second click resets room
      if (!btnPlayAgain.dataset.hostReady) {
        // First click: signal readiness
        btnPlayAgain.dataset.hostReady = 'true';
        btnPlayAgain.textContent = '▶ Start New Round';
        if (roomCode) {
          try {
            await update(ref(db, `ppp-rooms/${roomCode}/ready`), {
              [`player_${playerIndex}`]: true,
            });
          } catch (_) {}
        }
      } else {
        // Second click: reset room to lobby
        if (window._readyCleanup) window._readyCleanup();
        btnPlayAgain.dataset.hostReady = '';
        btnPlayAgain.textContent = 'Play Again';
        state = null;
        lastMoveTimestamp = 0;
        if (roomCode) {
          try {
            await resetRoom(roomCode);
          } catch (err) {
            console.error('Failed to reset room:', err);
            showToast('Failed to reset room.');
          }
        }
        setupLobby();
      }
    } else {
      // Non-host: signal readiness via Firebase
      if (roomCode && playerIndex != null) {
        try {
          await update(ref(db, `ppp-rooms/${roomCode}/ready`), {
            [`player_${playerIndex}`]: true,
          });
        } catch (_) {}
      }
      btnPlayAgain.disabled = true;
      btnPlayAgain.textContent = '✓ Ready';
      showToast('Waiting for host to start new round...');
    }
  });

  btnHome.addEventListener('click', async () => {
    // Clean up ready cleanup listener
    if (window._readyCleanup) window._readyCleanup();

    if (gameMode === 'online' && roomCode) {
      // Signal that this player left (red dot for others)
      if (playerIndex != null) {
        try {
          await update(ref(db, `ppp-rooms/${roomCode}/ready`), {
            [`player_${playerIndex}`]: 'left',
          });
        } catch (_) {}
      }

      if (isHost) {
        try {
          await deleteRoom(roomCode);
        } catch (_) {}
      } else if (playerIndex != null) {
        // Remove self from room
        try {
          const playerRef = ref(db, `ppp-rooms/${roomCode}/players/player_${playerIndex}`);
          await remove(playerRef);
        } catch (_) {}
      }
    }

    cleanupAndGoHome();
  });

  // Ready listeners are started via startReadyListener() when entering results screen
}

/** Starts listening for ready flags when entering online results screen. */
function startReadyListener() {
  if (gameMode !== 'online' || !roomCode) return;

  // Reset play again button state
  btnPlayAgain.disabled = false;
  btnPlayAgain.textContent = 'Play Again';
  btnPlayAgain.dataset.hostReady = '';

  const readyRef = ref(db, `ppp-rooms/${roomCode}/ready`);

  const readyHandler = (snapshot) => {
    const data = snapshot.val() || {};
    const readyIndices = Object.keys(data)
      .filter((k) => data[k] === true)
      .map((k) => parseInt(k.replace('player_', ''), 10))
      .filter((n) => !isNaN(n));
    const leftIndices = Object.keys(data)
      .filter((k) => data[k] === 'left')
      .map((k) => parseInt(k.replace('player_', ''), 10))
      .filter((n) => !isNaN(n));
    renderReadyIndicators(playerNames, readyIndices, leftIndices);
  };
  onValue(readyRef, readyHandler);

  window._readyCleanup = () => {
    off(readyRef, 'value', readyHandler);
    window._readyCleanup = null;
  };
}

/* ======= MUTE TOGGLE ======= */

function wireMuteToggle() {
  if (!muteToggle) return;

  muteToggle.addEventListener('change', () => {
    toggleMute();
  });
}

/* ======= BACK BUTTONS ======= */

function wireBackButtons() {
  // Online choice screen back
  if (btnBackOnline) {
    btnBackOnline.addEventListener('click', () => {
      showScreen('home-screen');
    });
  }

  // Create room back
  const btnBackCreate = document.getElementById('btn-back-create');
  if (btnBackCreate) {
    btnBackCreate.addEventListener('click', () => {
      showScreen('online-choice-screen');
    });
  }

  // Join room back
  const btnBackJoin = document.getElementById('btn-back-join');
  if (btnBackJoin) {
    btnBackJoin.addEventListener('click', () => {
      showScreen('online-choice-screen');
    });
  }
}

/* ======= SERVICE WORKER ======= */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker registered');

      if (registration.waiting) {
        showUpdateToast(registration);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(registration);
          }
        });
      });
    } catch (err) {
      console.warn('⚠️ Service Worker registration failed:', err.message);
    }
  });
}

function showUpdateToast(registration) {
  const updateToast = document.getElementById('update-toast');
  const updateBtn = document.getElementById('update-refresh-btn');
  if (!updateToast) return;

  updateToast.hidden = false;

  if (updateBtn && !updateBtn._listenerAdded) {
    updateBtn._listenerAdded = true;
    updateBtn.addEventListener('click', () => {
      updateToast.hidden = true;
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    });
  }
}

/* ======= INITIALIZATION ======= */

async function init() {
  // Initialize audio on first interaction
  initAudio();

  // Set mute toggle from persisted state
  if (muteToggle) {
    muteToggle.checked = isMuted();
  }

  // Wire all event handlers
  wireHomeScreen();
  wirePlayerSetup();
  wireCardTapHandler();
  wireEndGame();
  wireResults();
  wireMuteToggle();
  wireBackButtons();

  // Online wiring (Tasks 10.1, 10.2)
  wireOnlineCreate();
  wireOnlineJoin();
  wireOnlineLobby();

  // Register service worker
  registerServiceWorker();

  // Try to rejoin online session first (survives page refresh)
  const rejoined = await checkOnlineSession();

  // Show home screen if not rejoining
  if (!rejoined) {
    showScreen('home-screen');
  }
}

// Start the app
init();
