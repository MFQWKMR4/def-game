import type { GameAdapter } from 'def-game/cloudflare';
import type { Env } from './env.js';
import { game } from './game/definition.js';
import type { Types } from './game/types.js';

/** WSで許す入力を制限し、時刻はクライアントの自己申告を使わず実行側で付ける。 */
export const adapter: GameAdapter<Env, Types> = {
  game,
  webSocket: { parseCommand(input) {
    if (typeof input !== 'object' || input === null || !('type' in input)) return null;
    if (input.type === 'start') return { type: 'start', now: Date.now() };
    if (input.type === 'play' && 'cardId' in input && typeof input.cardId === 'string'
      && 'decisionId' in input && typeof input.decisionId === 'string') {
      return { type: 'play', cardId: input.cardId, decisionId: input.decisionId, now: Date.now() };
    }
    // select-deckはHTTPで外部情報を取得してからdispatchする。WSからの自己申告は拒否。
    return null;
  } },
  canConnect: (state, actorId) => state.players.some(p => p.actorId === actorId),
  runtime: {
    effect: effect => effect.type === 'schedule'
      ? { type: 'schedule', id: `decision:${effect.decisionId}`, deadline: effect.deadline }
      : effect.type === 'cancel' ? { type: 'cancel', id: `decision:${effect.decisionId}` } : null,
    scheduler: {
      command: id => ({ type: 'decision-timeout', decisionId: id.slice('decision:'.length), now: Date.now() }),
    },
  },
  async executeEffect(effect, { roomId }) {
    if (effect.type === 'finished') console.info('Game finished', { roomId });
    // 外部処理の結果をゲームへ戻す場合は { command: SystemCommand } を返す。
    // 保存済み状態を直接変更しない。外部配送はbest-effort。
  },
};
