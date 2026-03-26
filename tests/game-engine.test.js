import { describe, it, expect } from 'vitest';
import {
  createGame,
  throwCard,
  getNextActivePlayer,
  advanceTurn,
  checkWinCondition,
  validateState,
} from '../src/game-engine.js';

// Helper to build a minimal game state for targeted tests
function makeState(overrides = {}) {
  return {
    players: [
      { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }], bounty: [], eliminated: false, connected: true },
      { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
    ],
    pile: [],
    currentPlayerIndex: 0,
    deckSize: 2,
    status: 'playing',
    winnerIndex: null,
    ...overrides,
  };
}

describe('createGame', () => {
  it('creates game with 2 players, 1 deck', () => {
    const state = createGame([
      { name: 'Alice', emoji: '😀' },
      { name: 'Bob', emoji: '😎' },
    ]);
    expect(state.players.length).toBe(2);
    expect(state.players[0].hand.length).toBe(26);
    expect(state.players[1].hand.length).toBe(26);
    expect(state.pile).toEqual([]);
    expect(state.deckSize).toBe(52);
    expect(state.status).toBe('playing');
    expect(state.winnerIndex).toBeNull();
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('creates game with 3 players, 1 deck', () => {
    const state = createGame([
      { name: 'A', emoji: '😀' },
      { name: 'B', emoji: '😎' },
      { name: 'C', emoji: '🤩' },
    ]);
    expect(state.players.length).toBe(3);
    for (const p of state.players) {
      expect(p.hand.length).toBe(17);
      expect(p.bounty).toEqual([]);
      expect(p.eliminated).toBe(false);
    }
  });

  it('creates game with 4 players, 1 deck', () => {
    const state = createGame([
      { name: 'A', emoji: '😀' },
      { name: 'B', emoji: '😎' },
      { name: 'C', emoji: '🤩' },
      { name: 'D', emoji: '😇' },
    ]);
    expect(state.players.length).toBe(4);
    for (const p of state.players) {
      expect(p.hand.length).toBe(13);
    }
  });

  it('creates game with 2 decks (104 cards)', () => {
    const state = createGame([
      { name: 'A', emoji: '😀' },
      { name: 'B', emoji: '😎' },
    ], 2);
    expect(state.deckSize).toBe(104);
    expect(state.players[0].hand.length).toBe(52);
    expect(state.players[1].hand.length).toBe(52);
  });

  it('creates game with 4 players, 2 decks', () => {
    const state = createGame([
      { name: 'A', emoji: '😀' },
      { name: 'B', emoji: '😎' },
      { name: 'C', emoji: '🤩' },
      { name: 'D', emoji: '😇' },
    ], 2);
    expect(state.deckSize).toBe(104);
    for (const p of state.players) {
      expect(p.hand.length).toBe(26);
    }
  });
});

describe('throwCard', () => {
  it('normal throw on empty pile (no capture)', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }, { rank: 'K', suit: '♥' }], bounty: [], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [],
      currentPlayerIndex: 0,
      deckSize: 3,
    });

    const { newState, captured } = throwCard(state, 0);
    expect(captured).toBe(false);
    expect(newState.pile).toEqual([{ rank: '5', suit: '♠' }]);
    expect(newState.players[0].hand.length).toBe(1);
    expect(newState.players[0].hand[0]).toEqual({ rank: 'K', suit: '♥' });
  });

  it('throw with rank match triggers capture', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '7', suit: '♠' }, { rank: 'K', suit: '♥' }], bounty: [], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '3', suit: '♦' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [{ rank: '2', suit: '♣' }, { rank: '7', suit: '♥' }],
      currentPlayerIndex: 0,
      deckSize: 5,
    });

    const { newState, captured } = throwCard(state, 0);
    expect(captured).toBe(true);
    expect(newState.pile).toEqual([]);
    // Captured cards go back into hand (pile + thrown card added to hand)
    expect(newState.players[0].hand.length).toBe(4); // 1 remaining + 2 pile + 1 thrown
    expect(newState.players[0].bounty.length).toBe(0);
  });

  it('throw on non-empty pile with no rank match', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }, { rank: 'K', suit: '♥' }], bounty: [], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '3', suit: '♦' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [{ rank: '7', suit: '♥' }],
      currentPlayerIndex: 0,
      deckSize: 4,
    });

    const { newState, captured } = throwCard(state, 0);
    expect(captured).toBe(false);
    expect(newState.pile.length).toBe(2);
    expect(newState.pile[1]).toEqual({ rank: '5', suit: '♠' });
  });

  it('elimination when last card is thrown', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }], bounty: [], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [],
      currentPlayerIndex: 0,
      deckSize: 2,
    });

    const { newState } = throwCard(state, 0);
    expect(newState.players[0].hand.length).toBe(0);
    expect(newState.players[0].eliminated).toBe(true);
  });

  it('does not mutate original state (pure function)', () => {
    const state = makeState();
    const originalPileLength = state.pile.length;
    const originalHandLength = state.players[0].hand.length;

    throwCard(state, 0);

    expect(state.pile.length).toBe(originalPileLength);
    expect(state.players[0].hand.length).toBe(originalHandLength);
  });
});

describe('getNextActivePlayer', () => {
  it('returns next player in sequence', () => {
    const state = makeState({ currentPlayerIndex: 0 });
    expect(getNextActivePlayer(state)).toBe(1);
  });

  it('wraps around from last to first', () => {
    const state = makeState({ currentPlayerIndex: 1 });
    expect(getNextActivePlayer(state)).toBe(0);
  });

  it('skips eliminated players', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [], bounty: [], eliminated: true, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
        { name: 'C', emoji: '🤩', hand: [{ rank: '3', suit: '♦' }], bounty: [], eliminated: false, connected: true },
      ],
      currentPlayerIndex: 2,
      deckSize: 2,
    });
    // From player 2, next should skip player 0 (eliminated) and go to player 1
    expect(getNextActivePlayer(state)).toBe(1);
  });

  it('returns the only active player when all others eliminated', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [], bounty: [], eliminated: true, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
        { name: 'C', emoji: '🤩', hand: [], bounty: [], eliminated: true, connected: true },
      ],
      currentPlayerIndex: 0,
      deckSize: 1,
    });
    expect(getNextActivePlayer(state)).toBe(1);
  });
});

describe('advanceTurn', () => {
  it('updates currentPlayerIndex to next active player', () => {
    const state = makeState({ currentPlayerIndex: 0 });
    const newState = advanceTurn(state);
    expect(newState.currentPlayerIndex).toBe(1);
  });

  it('does not mutate original state', () => {
    const state = makeState({ currentPlayerIndex: 0 });
    advanceTurn(state);
    expect(state.currentPlayerIndex).toBe(0);
  });
});

describe('checkWinCondition', () => {
  it('returns finished when only 1 active player', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [], bounty: [], eliminated: true, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
      ],
    });
    const result = checkWinCondition(state);
    expect(result.finished).toBe(true);
    expect(result.winnerIndex).toBe(1);
  });

  it('returns not finished when 2+ active players', () => {
    const state = makeState();
    const result = checkWinCondition(state);
    expect(result.finished).toBe(false);
    expect(result.winnerIndex).toBeNull();
  });

  it('identifies correct winner index with 4 players', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [], bounty: [], eliminated: true, connected: true },
        { name: 'B', emoji: '😎', hand: [], bounty: [], eliminated: true, connected: true },
        { name: 'C', emoji: '🤩', hand: [{ rank: '3', suit: '♦' }], bounty: [], eliminated: false, connected: true },
        { name: 'D', emoji: '😇', hand: [], bounty: [], eliminated: true, connected: true },
      ],
    });
    const result = checkWinCondition(state);
    expect(result.finished).toBe(true);
    expect(result.winnerIndex).toBe(2);
  });
});

describe('validateState', () => {
  it('valid state: card count matches deckSize', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }], bounty: [{ rank: 'K', suit: '♥' }], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [{ rank: '3', suit: '♦' }],
      deckSize: 4,
    });
    const result = validateState(state);
    expect(result.valid).toBe(true);
  });

  it('invalid state: card count mismatch', () => {
    const state = makeState({
      players: [
        { name: 'A', emoji: '😀', hand: [{ rank: '5', suit: '♠' }], bounty: [], eliminated: false, connected: true },
        { name: 'B', emoji: '😎', hand: [{ rank: '7', suit: '♥' }], bounty: [], eliminated: false, connected: true },
      ],
      pile: [],
      deckSize: 52, // mismatch: only 2 cards exist
    });
    const result = validateState(state);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('valid after createGame', () => {
    const state = createGame([
      { name: 'A', emoji: '😀' },
      { name: 'B', emoji: '😎' },
    ]);
    const result = validateState(state);
    expect(result.valid).toBe(true);
  });
});
