import type { GameTypes } from 'def-game/cloudflare';

/** デッキの内容はアプリが取得し、ゲームがスナップショットとして保存する。 */
export interface Card { readonly id: string; readonly power: number }
export interface Deck { readonly id: string; readonly name: string; readonly cards: readonly Card[] }
export interface Player {
  readonly actorId: string;
  readonly name: string;
  readonly deck: Deck | null;
  readonly score: number;
}
/** 所有者のいないロビーを初期状態とする、2人で1回ずつカードを出す最小ゲーム。 */
export interface State {
  readonly phase: 'lobby' | 'playing' | 'finished';
  readonly players: readonly Player[];
  readonly turn: number;
  readonly revision: number;
  readonly decision: { readonly id: string; readonly deadline: number } | null;
}
export type ActorCommand =
  | { readonly type: 'join'; readonly name: string }
  | { readonly type: 'select-deck'; readonly deck: Deck }
  | { readonly type: 'start'; readonly now: number }
  | { readonly type: 'play'; readonly cardId: string; readonly decisionId: string; readonly now: number };
export type SystemCommand = { readonly type: 'decision-timeout'; readonly decisionId: string; readonly now: number };
export type Effect =
  | { readonly type: 'schedule'; readonly decisionId: string; readonly deadline: number }
  | { readonly type: 'cancel'; readonly decisionId: string }
  | { readonly type: 'finished' };
export type GameError = 'AlreadyStarted' | 'RoomFull' | 'InvalidName' | 'NotMember' | 'NotReady'
  | 'NotYourTurn' | 'InvalidCard' | 'StaleDecision' | 'InvalidCommand';
/** 他人のカードは公開しない。クライアントはavailableActionsに従って操作を表示する。 */
export interface View {
  readonly phase: State['phase'];
  readonly players: readonly { readonly name: string; readonly score: number; readonly ready: boolean; readonly isYou: boolean }[];
  readonly yourCards: readonly Card[];
  readonly activePlayer: string | null;
  readonly decision: State['decision'];
  readonly availableActions: readonly ('select-deck' | 'start' | 'play')[];
}
export interface Types extends GameTypes {
  state: State; actorCommand: ActorCommand; systemCommand: SystemCommand;
  view: View; effect: Effect; error: GameError;
}
