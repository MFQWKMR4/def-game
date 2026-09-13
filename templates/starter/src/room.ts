import { SessionRuntime } from 'def-game/cloudflare';
import { adapter } from './game-adapter.js';
import type { Env } from './env.js';
import type { Types } from './game/types.js';

/** 共通DO実装にこのゲームのadapterを接続する。状態保存・WS管理を複製しない。 */
export class RoomDurableObject extends SessionRuntime<Env, Types> {
  protected readonly adapter = adapter;
}
