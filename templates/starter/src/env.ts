import type { RoomDurableObject } from './room.js';

/** アプリ所有のbinding。外部デッキ保存などを追加するときはここへ接続する。 */
export interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
  ASSETS: Fetcher;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
}
