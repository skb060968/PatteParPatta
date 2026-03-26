import { describe, it, expect } from 'vitest';
import { createDeck, shuffle, dealCards, serializeCard, deserializeCard } from '../src/deck.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

describe('createDeck', () => {
  it('produces 52 cards', () => {
    const deck = createDeck();
    expect(deck.length).toBe(52);
  });

  it('contains 13 ranks × 4 suits with no duplicates', () => {
    const deck = createDeck();
    const serialized = deck.map(c => c.rank + c.suit);
    const unique = new Set(serialized);
    expect(unique.size).toBe(52);

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        expect(unique.has(rank + suit)).toBe(true);
      }
    }
  });

  it('each card has valid rank and suit', () => {
    const deck = createDeck();
    for (const card of deck) {
      expect(RANKS).toContain(card.rank);
      expect(SUITS).toContain(card.suit);
    }
  });
});

describe('shuffle', () => {
  it('returns same length array', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled.length).toBe(52);
  });

  it('returns the same array reference (in-place)', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toBe(deck);
  });

  it('contains the same cards after shuffle (just reordered)', () => {
    const deck = createDeck();
    const before = deck.map(c => c.rank + c.suit).sort();
    shuffle(deck);
    const after = deck.map(c => c.rank + c.suit).sort();
    expect(after).toEqual(before);
  });
});

describe('dealCards', () => {
  it('deals correctly to 2 players (26 each)', () => {
    const deck = createDeck();
    const hands = dealCards(deck, 2);
    expect(hands.length).toBe(2);
    expect(hands[0].length).toBe(26);
    expect(hands[1].length).toBe(26);
  });

  it('deals correctly to 4 players (13 each)', () => {
    const deck = createDeck();
    const hands = dealCards(deck, 4);
    expect(hands.length).toBe(4);
    for (const hand of hands) {
      expect(hand.length).toBe(13);
    }
  });

  it('deals correctly to 3 players (17 each, 1 discarded)', () => {
    const deck = createDeck();
    const hands = dealCards(deck, 3);
    expect(hands.length).toBe(3);
    for (const hand of hands) {
      expect(hand.length).toBe(17);
    }
    // Total dealt = 51, 1 card discarded from 52
    const totalDealt = hands.reduce((sum, h) => sum + h.length, 0);
    expect(totalDealt).toBe(51);
  });

  it('discards remainder cards', () => {
    // 52 / 3 = 17 remainder 1
    const deck = createDeck();
    const hands = dealCards(deck, 3);
    const totalDealt = hands.reduce((sum, h) => sum + h.length, 0);
    expect(totalDealt).toBe(17 * 3); // 51
    expect(52 - totalDealt).toBe(1); // 1 discarded
  });
});

describe('serializeCard / deserializeCard round-trip', () => {
  it('round-trips a simple card (A♠)', () => {
    const card = { rank: 'A', suit: '♠' };
    const str = serializeCard(card);
    expect(str).toBe('A♠');
    const result = deserializeCard(str);
    expect(result).toEqual(card);
  });

  it('round-trips a 10 card (10♥)', () => {
    const card = { rank: '10', suit: '♥' };
    const str = serializeCard(card);
    expect(str).toBe('10♥');
    const result = deserializeCard(str);
    expect(result).toEqual(card);
  });

  it('round-trips all 52 cards', () => {
    const deck = createDeck();
    for (const card of deck) {
      const roundTripped = deserializeCard(serializeCard(card));
      expect(roundTripped).toEqual(card);
    }
  });
});
