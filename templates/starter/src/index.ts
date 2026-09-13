import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { getRoom } from 'def-game/cloudflare';
import { authenticate } from './auth.js';
import { listDecks, loadDeck } from './external/decks.js';
import type { Env } from './env.js';
export { RoomDurableObject } from './room.js';

const app = new Hono<{ Bindings: Env; Variables: { actorId: string } }>();

/** 認証とリクエスト保護を独自APIにも共通適用する。static shellに秘密情報は置かない。 */
app.use('*', async (c, next) => {
  if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/ws/')) return next();
  c.header('Cache-Control', 'no-store');
  const origin = c.req.header('origin');
  if (origin && origin !== new URL(c.req.url).origin && (c.req.method !== 'GET' || c.req.path.startsWith('/ws/'))) {
    return c.json({ ok: false, error: { code: 'InvalidOrigin' } }, 403);
  }
  const actorId = await authenticate(getCookie(c, '__token'), c.env);
  if (!actorId) return c.json({ ok: false, error: { code: 'AuthenticationRequired' } }, 401);
  c.set('actorId', actorId);
  await next();
});
app.get('/auth-config', c => c.json({ issuer: c.env.AUTH_ISSUER }, 200, { 'Cache-Control': 'no-store' }));
app.get('/api/me', c => c.json({ ok: true, actorId: c.get('actorId') }));
app.get('/api/decks', c => c.json({ decks: listDecks() }));

app.post('/api/rooms', async c => {
  // 公開room IDはアプリ所有。DO内部のIDと同じ形式にする必要はない。
  const roomId = crypto.randomUUID();
  const result = await getRoom(c.env.ROOMS, c.env.ROOMS.idFromName(roomId)).create();
  return result.ok ? c.json({ ok: true, roomId }, 201) : c.json(result, 500);
});

app.use('/api/rooms/:roomId/*', async (c, next) => {
  if (!validRoomId(c.req.param('roomId'))) return c.json({ ok: false, error: { code: 'InvalidRoomId' } }, 400);
  await next();
});
app.post('/api/rooms/:roomId/join', async c => {
  const input = await readInput(c.req.raw);
  if (!input || typeof input.name !== 'string') return c.json({ ok: false, error: { code: 'InvalidRequest' } }, 400);
  const room = getRoom(c.env.ROOMS, c.env.ROOMS.idFromName(c.req.param('roomId')));
  const result = await room.dispatchActor({ actorId: c.get('actorId') }, { type: 'join', name: input.name });
  return c.json(result, result.ok ? 200 : 409);
});
app.post('/api/rooms/:roomId/deck', async c => {
  const input = await readInput(c.req.raw);
  if (!input || typeof input.deckId !== 'string') return c.json({ ok: false, error: { code: 'InvalidRequest' } }, 400);
  // ここで外部ドメインの取得・権限確認を済ませる。本文のdeckやpowerは使用しない。
  const deck = await loadDeck(c.get('actorId'), input.deckId);
  if (!deck) return c.json({ ok: false, error: { code: 'DeckNotFound' } }, 404);
  const room = getRoom(c.env.ROOMS, c.env.ROOMS.idFromName(c.req.param('roomId')));
  const result = await room.dispatchActor({ actorId: c.get('actorId') }, { type: 'select-deck', deck });
  return c.json(result, result.ok ? 200 : 409);
});
app.get('/ws/rooms/:roomId', c => {
  if (!validRoomId(c.req.param('roomId'))) return c.json({ ok: false, error: { code: 'InvalidRoomId' } }, 400);
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ ok: false, error: { code: 'InvalidRequest' } }, 426);
  return getRoom(c.env.ROOMS, c.env.ROOMS.idFromName(c.req.param('roomId'))).connect({ actorId: c.get('actorId') });
});
app.all('/api/*', c => c.json({ ok: false, error: { code: 'NotFound' } }, 404));
app.all('/ws/*', c => c.json({ ok: false, error: { code: 'NotFound' } }, 404));
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
app.onError((_error, c) => {
  console.error('Worker request failed');
  return c.json({ ok: false, error: { code: 'InternalError' } }, 500);
});
export default app;

function validRoomId(id: string) { return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id); }
/** 上限付きでJSONを読む。認可やゲームルールはここへ入れない。 */
async function readInput(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 64 * 1024) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
  } catch { return null; }
}
