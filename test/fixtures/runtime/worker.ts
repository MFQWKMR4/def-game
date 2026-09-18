import { SessionRuntime, getRoom, getSystemRoom, type GameAdapter, type GameTypes, type RuntimeEffect } from 'def-game/cloudflare';

interface State { members: string[]; count: number; secret: string; decision?: string; fired: string[] }
type ActorCommand = { type: 'join' | 'increment' | 'leave' | 'external' | 'throw-effect' | 'invalid-alarm' | 'projection-error' | 'delete' }
  | { type: 'schedule'; id: string; deadline: number }
  | { type: 'cancel'; id: string }
  | { type: 'trusted'; amount: number };
type SystemCommand = { type: 'result' } | { type: 'scheduled'; id: string };
type Effect = { type: 'external' | 'throw' | 'delete-session' }
  | { type: 'schedule'; id: string; deadline: number } | { type: 'cancel'; id: string };
interface Types extends GameTypes {
  state: State; actorCommand: ActorCommand; systemCommand: SystemCommand;
  view: { count: number; actorId: string }; effect: Effect; error: string;
}
interface Env { ROOMS: DurableObjectNamespace<TestRoom> }
let release: (() => void) | undefined;
let entered = false;
const errors: { roomId: string; phase: string }[] = [];

const adapter: GameAdapter<Env, Types> = {
  game: {
    createInitialState: () => ({ members: [], count: 0, secret: 'never-public', fired: [] }),
    handleCommand(state, command, context) {
      if (command.type === 'result' || command.type === 'scheduled') {
        if (context.origin !== 'system') return { ok: false, error: 'system-only' };
        return { ok: true, state: { ...state, count: state.count + 10,
          fired: command.type === 'scheduled' ? [...state.fired, command.id] : state.fired },
          effects: command.type === 'scheduled' && command.id === 'cancel-next' ? [{ type: 'cancel', id: 'next' }] : [] };
      }
      if (context.origin !== 'actor') return { ok: false, error: 'actor-only' };
      if (command.type === 'join') return { ok: true, state: { ...state, members: [...new Set([...state.members, context.actorId])] }, effects: [] };
      if (!state.members.includes(context.actorId)) return { ok: false, error: 'not-member' };
      if (command.type === 'leave') return { ok: true, state: { ...state, members: state.members.filter(id => id !== context.actorId) }, effects: [] };
      if (command.type === 'schedule') return { ok: true, state: { ...state, decision: command.id }, effects: [{ type: 'schedule', id: command.id, deadline: command.deadline }] };
      if (command.type === 'cancel') return { ok: true, state, effects: [{ type: 'cancel', id: command.id }] };
      if (command.type === 'delete') return { ok: true, state, effects: [{ type: 'delete-session' }] };
      if (command.type === 'invalid-alarm') return { ok: true, state: { ...state, count: 999 }, effects: [{ type: 'schedule', id: 'invalid', deadline: NaN }] };
      if (command.type === 'projection-error') return { ok: true, state: { ...state, count: -1 }, effects: [{ type: 'throw' }] };
      return { ok: true, state: { ...state, count: state.count + (command.type === 'trusted' ? command.amount : 1) },
        effects: command.type === 'external' ? [{ type: 'external' }] : command.type === 'throw-effect' ? [{ type: 'throw' }, { type: 'external' }] : [] };
    },
    project(state, actorId) {
      if (state.count === -1) throw new Error('secret projection failure');
      return { count: state.count, actorId };
    },
  },
  webSocket: { parseCommand(input) {
    if (typeof input !== 'object' || input === null || !('type' in input)) return null;
    return input.type === 'increment' || input.type === 'leave' || input.type === 'delete' ? { type: input.type } : null;
  } },
  canConnect: (state, actorId) => state.members.includes(actorId),
  runtime: {
    effect: (effect): RuntimeEffect | null => effect.type === 'schedule' || effect.type === 'cancel' ? effect
      : effect.type === 'delete-session' ? { type: 'delete-session' } : null,
    scheduler: { command: id => ({ type: 'scheduled', id }) },
  },
  async executeEffect(effect) {
    if (effect.type === 'delete-session') throw new Error('runtime effect leaked to external handler');
    if (effect.type === 'throw') throw new Error('secret effect failure');
    if (effect.type === 'external') {
      entered = true;
      await new Promise<void>(resolve => { release = resolve; });
      entered = false;
      return { command: { type: 'result' } };
    }
  },
  onError: failure => { errors.push(failure); },
};
export class TestRoom extends SessionRuntime<Env, Types> {
  protected readonly adapter = adapter;
  // 以下はテスト専用。配布runtimeに状態取得・Alarm強制起動の公開APIはない。
  async inspect() { return { state: await this.ctx.storage.get('game-state'), reservations: await this.ctx.storage.get('scheduled-events'), alarm: await this.ctx.storage.getAlarm(), errors: errors.filter(e => e.roomId === this.ctx.id.toString()).map(e => e.phase), entered }; }
  async releaseEffect() { release?.(); }
  async fireAlarm() { await this.alarm(); }
  async expireReservations() {
    const reservations = await this.ctx.storage.get<{ id: string; deadline: number }[]>('scheduled-events') ?? [];
    await this.ctx.storage.put('scheduled-events', reservations.map(reservation => ({ ...reservation, deadline: 0 })));
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = env.ROOMS.idFromName(url.searchParams.get('room') ?? 'room');
    const room = getRoom(env.ROOMS, id);
    const actor = { actorId: url.searchParams.get('actor') ?? 'alice' };
    // テスト専用の認証代替。実アプリではCookie/JWT等を検証する。
    if (url.pathname === '/view') return Response.json(await room.getView(actor));
    if (url.pathname === '/connect') return room.connect(actor);
    if (url.pathname === '/create') return Response.json(await room.create());
    if (url.pathname === '/system') return Response.json(await getSystemRoom(env.ROOMS, id).dispatchSystem(await request.json()));
    if (url.pathname === '/keys') return Response.json(Object.keys(room));
    return Response.json(await room.dispatchActor(actor, await request.json()));
  },
};

// 呼び出し側でActor/Systemの型が混ざらないことも検証する。
function checkClientTypes(env: Env, id: DurableObjectId) {
  const room = getRoom(env.ROOMS, id);
  void room.getView({ actorId: 'guest' }).then(result => {
    if (result.ok) {
      const count: number = result.view.count;
      // @ts-expect-error Viewには秘密の保存状態を公開しない
      result.view.secret;
    }
  });
  // @ts-expect-error 通常の参照にSystem入口はない
  room.dispatchSystem({ type: 'result' });
  // @ts-expect-error System CommandはActor入口に渡せない
  room.dispatchActor({ actorId: 'a' }, { type: 'result' });
  // @ts-expect-error System入口にActor操作は渡せない
  getSystemRoom(env.ROOMS, id).dispatchSystem({ type: 'increment' });
}
