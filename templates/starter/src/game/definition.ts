import type { GameDefinition, TransitionResult } from 'def-game';
import type { ActorCommand, SystemCommand, State, View, Effect, GameError } from './types.js';

const TURN_MS = 30_000;
const reject = (error: GameError): TransitionResult<State, Effect, GameError> => ({ ok: false, error });

/** 外部I/Oを行わず、次の入力を待てる状態とEffectを返す。 */
export const game: GameDefinition<State, ActorCommand | SystemCommand, string, View, Effect, GameError> = {
  createInitialState: () => ({ phase: 'lobby', players: [], turn: 0, revision: 0, decision: null }),
  handleCommand(state, command, context) {
    if (command.type === 'decision-timeout') {
      if (context.origin !== 'system' || !Number.isFinite(command.now)) return reject('InvalidCommand');
      if (state.phase !== 'playing' || !state.decision || command.decisionId !== state.decision.id
        || command.now < state.decision.deadline) return reject('StaleDecision');
      return finishTurn(state, 0, command.now);
    }
    if (context.origin !== 'actor') return reject('InvalidCommand');
    const index = state.players.findIndex(p => p.actorId === context.actorId);
    if (command.type === 'join') {
      if (index >= 0) return { ok: true, state, effects: [] }; // 再送・再参加で席を増やさない
      if (state.phase !== 'lobby') return reject('AlreadyStarted');
      if (state.players.length >= 2) return reject('RoomFull');
      if (typeof command.name !== 'string' || !command.name.trim() || command.name.trim().length > 24) return reject('InvalidName');
      return { ok: true, state: { ...state, revision: state.revision + 1,
        players: [...state.players, { actorId: context.actorId, name: command.name.trim(), deck: null, score: 0 }] }, effects: [] };
    }
    if (index < 0) return reject('NotMember');
    if (command.type === 'select-deck') {
      if (state.phase !== 'lobby') return reject('AlreadyStarted');
      if (!command.deck.cards.length || command.deck.cards.some(c => !c.id || !Number.isFinite(c.power))) return reject('InvalidCard');
      return { ok: true, state: { ...state, revision: state.revision + 1,
        players: state.players.map((p, i) => i === index ? { ...p, deck: command.deck } : p) }, effects: [] };
    }
    if (!Number.isFinite(command.now)) return reject('InvalidCommand');
    if (command.type === 'start') {
      if (state.phase !== 'lobby') return reject('AlreadyStarted');
      if (state.players.length !== 2 || state.players.some(p => !p.deck)) return reject('NotReady');
      const decision = { id: `turn-${state.revision + 1}`, deadline: command.now + TURN_MS };
      return { ok: true, state: { ...state, phase: 'playing', revision: state.revision + 1, decision },
        effects: [{ type: 'schedule', decisionId: decision.id, deadline: decision.deadline }] };
    }
    if (command.type === 'play') {
      if (state.phase !== 'playing' || !state.decision || state.decision.id !== command.decisionId
        || command.now >= state.decision.deadline) return reject('StaleDecision');
      if (index !== state.turn) return reject('NotYourTurn');
      const card = state.players[index].deck?.cards.find(c => c.id === command.cardId);
      if (!card) return reject('InvalidCard');
      return finishTurn(state, card.power, command.now);
    }
    return reject('InvalidCommand');
  },
  project(state, actorId) {
    const index = state.players.findIndex(p => p.actorId === actorId);
    const member = index >= 0;
    return {
      phase: state.phase,
      players: state.players.map(p => ({ name: p.name, score: p.score, ready: p.deck !== null, isYou: p.actorId === actorId })),
      yourCards: member ? state.players[index].deck?.cards ?? [] : [],
      activePlayer: state.phase === 'playing' ? state.players[state.turn].name : null,
      decision: state.decision,
      availableActions: !member ? [] : state.phase === 'lobby'
        ? ['select-deck', ...(state.players.length === 2 && state.players.every(p => p.deck) ? ['start' as const] : [])]
        : state.phase === 'playing' && index === state.turn ? ['play'] : [],
    };
  },
};

/** 手番終了と次の期限を同じ遷移で決める。期限切れは得点0として扱う。 */
function finishTurn(state: State, score: number, now: number): TransitionResult<State, Effect, GameError> {
  const players = state.players.map((p, i) => i === state.turn ? { ...p, score } : p);
  const revision = state.revision + 1;
  if (state.turn + 1 === players.length) {
    return { ok: true, state: { ...state, players, revision, phase: 'finished', decision: null },
      effects: [{ type: 'cancel', decisionId: state.decision!.id }, { type: 'finished' }] };
  }
  const decision = { id: `turn-${revision}`, deadline: now + TURN_MS };
  return { ok: true, state: { ...state, players, revision, turn: state.turn + 1, decision },
    effects: [{ type: 'schedule', decisionId: decision.id, deadline: decision.deadline }] };
}
