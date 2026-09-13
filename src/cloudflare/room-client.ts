import type { CommandResult, CreateRoomResult, GetViewResult, VerifiedActor } from "./types.js";

/** DOの信頼されたRPC面。アプリは外部リクエストを直接この面へ転送しない。 */
interface RoomTransport<ActorCommand, SystemCommand, Error, View> {
  create(): Promise<CreateRoomResult>;
  getView(actor: VerifiedActor): Promise<GetViewResult<View>>;
  dispatchActor(actor: VerifiedActor, command: ActorCommand): Promise<CommandResult<Error>>;
  dispatchSystem(command: SystemCommand): Promise<CommandResult<Error>>;
  fetch(request: Request): Promise<Response>;
}

/** 通常のアプリ操作向け参照。System入口を含めない。 */
export interface RoomClient<ActorCommand, Error, View = unknown> {
  create(): Promise<CreateRoomResult>;
  getView(actor: VerifiedActor): Promise<GetViewResult<View>>;
  dispatchActor(actor: VerifiedActor, command: ActorCommand): Promise<CommandResult<Error>>;
  connect(actor: VerifiedActor): Promise<Response>;
}

/** 対象DOを選び、認証済みActor向けのAPIだけを返す。IDの解決はアプリが行う。 */
export function getRoom<A, S, E, V>(
  namespace: { get(id: DurableObjectId): RoomTransport<A, S, E, V> }, id: DurableObjectId,
): RoomClient<A, E, V> {
  const stub = namespace.get(id);
  return {
    create: () => stub.create(),
    getView: actor => stub.getView(actor),
    dispatchActor: (actor, command) => stub.dispatchActor(actor, command),
    connect: actor => {
      if (!actor || typeof actor.actorId !== "string" || !actor.actorId) throw new Error("Verified actor required");
      return stub.fetch(new Request("https://def-game.internal/connect", {
        headers: { upgrade: "websocket", "x-def-game-actor-id": actor.actorId },
      }));
    },
  };
}

/** 認証・権限確認済みのwebhookやマッチングからSystem Commandを渡す参照。 */
export function getSystemRoom<A, S, E, V>(
  namespace: { get(id: DurableObjectId): RoomTransport<A, S, E, V> }, id: DurableObjectId,
): { dispatchSystem(command: S): Promise<CommandResult<E>> } {
  const stub = namespace.get(id);
  return { dispatchSystem: command => stub.dispatchSystem(command) };
}
