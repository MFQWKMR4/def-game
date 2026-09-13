import type { Deck } from '../game/types.js';

/** ゲーム進行から独立したデッキ取得の例。Aquare等ではここを個人保存・図鑑APIへ接続する。 */
const decks: readonly Deck[] = [
  { id: 'swift', name: 'Swift', cards: [{ id: 'swift-1', power: 2 }, { id: 'swift-2', power: 4 }] },
  { id: 'steady', name: 'Steady', cards: [{ id: 'steady-1', power: 3 }, { id: 'steady-2', power: 5 }] },
];
export function listDecks() { return decks.map(({ id, name }) => ({ id, name })); }

/** 認証済みActorからアクセス可否を判断できる入口。例では両方を全員に提供する。 */
export async function loadDeck(actorId: string, deckId: string): Promise<Deck | null> {
  if (!actorId) return null;
  const deck = decks.find(d => d.id === deckId);
  return deck ? structuredClone(deck) : null;
}
