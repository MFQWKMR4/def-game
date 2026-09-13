import { DurableObject } from "cloudflare:workers";
import type { CommandContext } from "../game-definition.js";
import { failure, isRecord, parseCommandRequest } from "./protocol.js";
import type { CommandResult, CreateRoomResult, GetViewResult, GameAdapter, GameTypes, RuntimeFailure, ServerMessage, TimeoutEffect, VerifiedActor } from "./types.js";

const STATE_KEY = "game-state";
const TIMEOUT_KEY = "decision-timeout";
type Reservation = { decisionId: string; deadline: number };

/**
 * 1ルームを動かすCloudflare専用runtime。アプリはadapterだけを接続した派生クラスをexportする。
 * RPCとfetchは信頼されたWorker専用。認証・外部リクエスト保護はWorker入口が担当する。
 */
export abstract class SessionRuntime<Env, T extends GameTypes> extends DurableObject<Env> {
  protected abstract readonly adapter: GameAdapter<Env, T>;

  /** 所有者や参加者を要求せず、ゲームの初期状態だけを保存する。 */
  async create(): Promise<CreateRoomResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const exists = await this.ctx.storage.get(STATE_KEY);
        if (exists !== undefined) return failure("RoomAlreadyExists");
        const state = this.adapter.game.createInitialState();
        if (state === undefined) throw new Error("Initial state must be persistable");
        await this.ctx.storage.transaction(async txn => { await txn.put(STATE_KEY, state); });
        return { ok: true, roomId: this.ctx.id.toString() };
      } catch {
        this.#report("create");
        return failure("InternalError");
      }
    });
  }

  /** HTTP等からの読み取り。公開内容はprojectが決め、WS接続資格は要求しない。 */
  async getView(actor: VerifiedActor): Promise<GetViewResult<T["view"]>> {
    if (!actor || typeof actor.actorId !== "string" || actor.actorId.length === 0) return failure("InvalidRequest");
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const state = await this.ctx.storage.get<T["state"]>(STATE_KEY);
        if (state === undefined) return failure("RoomNotFound");
        return { ok: true, view: this.adapter.game.project(state, actor.actorId) };
      } catch {
        this.#report("view");
        return failure("InternalError");
      }
    });
  }

  /** アプリが認証済みActorと、必要なら外部取得済み情報を渡す入口。 */
  async dispatchActor(actor: VerifiedActor, command: T["actorCommand"]): Promise<CommandResult<T["error"]>> {
    if (!actor || typeof actor.actorId !== "string" || actor.actorId.length === 0) return failure("InvalidRequest");
    return this.#dispatchCommand(command, { origin: "actor", actorId: actor.actorId });
  }

  /** webhook等の認証を済ませたサーバー専用入口。外部本文からoriginをコピーしない。 */
  async dispatchSystem(command: T["systemCommand"]): Promise<CommandResult<T["error"]>> {
    return this.#dispatchCommand(command, { origin: "system" });
  }

  /** 全Commandが通る唯一の経路。Alarmの予約確認も同じ直列化区間で行う。 */
  async #dispatchCommand(
    command: T["actorCommand"] | T["systemCommand"],
    context: CommandContext<string>,
    options: { fromSocket?: boolean; alarm?: boolean } = {},
  ): Promise<CommandResult<T["error"]>> {
    let effects: readonly T["effect"][] = [];
    const outcome = await this.ctx.blockConcurrencyWhile(async (): Promise<CommandResult<T["error"]>> => {
      try {
        let consumed: string | undefined;
        if (options.alarm) {
          const reservation = await this.ctx.storage.get<Reservation>(TIMEOUT_KEY);
          if (!reservation) return { ok: true };
          if (Date.now() < reservation.deadline) {
            await this.ctx.storage.setAlarm(reservation.deadline);
            return { ok: true };
          }
          if (!this.adapter.timeout) throw new Error("Timeout adapter missing");
          command = this.adapter.timeout.command(reservation.decisionId);
          consumed = reservation.decisionId;
        }
        const state = await this.ctx.storage.get<T["state"]>(STATE_KEY);
        if (state === undefined) return failure("RoomNotFound");
        if (options.fromSocket && (context.origin !== "actor" || !this.adapter.canConnect(state, context.actorId))) {
          return failure("NotRoomMember");
        }
        const result = this.adapter.game.handleCommand(state, command, context);
        if (!result.ok) return { ok: false, error: { kind: "game", detail: result.error } };
        if (result.state === undefined) throw new Error("State must be persistable");
        const external: T["effect"][] = [];
        const alarms: TimeoutEffect[] = [];
        for (const effect of result.effects) {
          const alarm = this.adapter.timeout?.effect(effect) ?? null;
          if (alarm === null) external.push(effect);
          else {
            if (!alarm.decisionId || (alarm.type !== "schedule" && alarm.type !== "cancel")
              || (alarm.type === "schedule" && !Number.isFinite(alarm.deadline))) throw new Error("Invalid alarm effect");
            alarms.push(alarm);
          }
        }
        await this.ctx.storage.transaction(async txn => {
          await txn.put(STATE_KEY, result.state);
          if (consumed !== undefined) {
            const current = await txn.get<Reservation>(TIMEOUT_KEY);
            if (current?.decisionId === consumed) {
              await txn.delete(TIMEOUT_KEY);
              await txn.deleteAlarm();
            }
          }
          for (const alarm of alarms) {
            if (alarm.type === "schedule") {
              await txn.put(TIMEOUT_KEY, { decisionId: alarm.decisionId, deadline: alarm.deadline });
              await txn.setAlarm(alarm.deadline);
            } else {
              const current = await txn.get<Reservation>(TIMEOUT_KEY);
              if (current?.decisionId === alarm.decisionId) {
                await txn.delete(TIMEOUT_KEY);
                await txn.deleteAlarm();
              }
            }
          }
        });
        // 保存後の配信失敗で、確定したCommandを失敗に戻さない。
        effects = external;
        this.#broadcast(result.state);
        return { ok: true };
      } catch {
        this.#report("command");
        return failure("InternalError");
      }
    });
    // 排他区間を出てから呼ぶ。外部取得中も次のCommandを受け付ける。
    if (effects.length) this.#deliver(effects);
    return outcome;
  }

  /** Alarm失敗は例外としてCloudflareの有限回リトライへ返す。 */
  async alarm(): Promise<void> {
    const result = await this.#dispatchCommand(undefined as T["systemCommand"], { origin: "system" }, { alarm: true });
    if (!result.ok) throw new Error("Timeout command failed");
  }

  /** 認証済みWorkerからだけ呼ぶ内部WS入口。一般HTTP Commandの転送は受け付けない。 */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || new URL(request.url).pathname !== "/connect"
      || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(failure("InvalidRequest"), { status: 400 });
    }
    const actorId = request.headers.get("x-def-game-actor-id");
    if (!actorId) return Response.json(failure("InvalidRequest"), { status: 400 });
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const state = await this.ctx.storage.get<T["state"]>(STATE_KEY);
        if (state === undefined) return Response.json(failure("RoomNotFound"), { status: 404 });
        if (!this.adapter.canConnect(state, actorId)) return Response.json(failure("NotRoomMember"), { status: 403 });
        const viewState = this.adapter.game.project(state, actorId);
        const pair = new WebSocketPair();
        pair[1].serializeAttachment({ actorId });
        this.ctx.acceptWebSocket(pair[1]);
        this.#send(pair[1], { type: "ViewStateEvent", viewState });
        return new Response(null, { status: 101, webSocket: pair[0] });
      } catch {
        this.#report("connection");
        return Response.json(failure("InternalError"), { status: 500 });
      }
    });
  }

  /** WSの自己申告を実行元にせず、接続に保存したActorでdispatchする。 */
  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const request = parseCommandRequest(raw);
    let command: T["actorCommand"] | null = null;
    try { if (request) command = this.adapter.webSocket.parseCommand(request.command); } catch { /* 入力を拒否 */ }
    if (!request || command === null || command === undefined) {
      this.#send(socket, { type: "ProtocolErrorEvent", error: failure("InvalidRequest").error });
      return;
    }
    const actorId = this.#actor(socket);
    const result = actorId === null ? failure("NotRoomMember")
      : await this.#dispatchCommand(command, { origin: "actor", actorId }, { fromSocket: true });
    this.#send(socket, { type: "GameCommandResponse", requestId: request.requestId, ...result });
  }

  /** 保存済みの状態は変更せず、接続ごとに公開可能なViewだけ配る。 */
  #broadcast(state: T["state"]): void {
    try {
      for (const socket of this.ctx.getWebSockets()) {
        try {
          const actorId = this.#actor(socket);
          if (actorId === null || !this.adapter.canConnect(state, actorId)) { this.#close(socket, 1008); continue; }
          this.#send(socket, { type: "ViewStateEvent", viewState: this.adapter.game.project(state, actorId) });
        } catch { this.#report("view"); this.#close(socket); }
      }
    } catch { this.#report("view"); }
  }

  /** handlerの結果を新しいSystem Commandとして返す。永続配送・自動再試行はしない。 */
  #deliver(effects: readonly T["effect"][]): void {
    this.ctx.waitUntil((async () => {
      for (const effect of effects) {
        let feedback: void | { readonly command: T["systemCommand"] };
        try {
          if (!this.adapter.executeEffect) throw new Error("Effect handler missing");
          feedback = await this.adapter.executeEffect(effect, { env: this.env, roomId: this.ctx.id.toString() });
        } catch { this.#report("effect"); continue; }
        if (feedback !== undefined) {
          try {
            const result = await this.dispatchSystem(feedback.command);
            if (!result.ok) this.#report("effect-feedback");
          } catch { this.#report("effect-feedback"); }
        }
      }
    })());
  }

  #actor(socket: WebSocket): string | null {
    try {
      const attachment: unknown = socket.deserializeAttachment();
      return isRecord(attachment) && typeof attachment.actorId === "string" ? attachment.actorId : null;
    } catch { return null; }
  }
  #send(socket: WebSocket, message: ServerMessage<T["view"], T["error"]>): void {
    try { socket.send(JSON.stringify(message)); } catch { this.#report("view"); this.#close(socket); }
  }
  #close(socket: WebSocket, code = 1011): void {
    try { socket.close(code, "Connection closed"); } catch { /* 既に切断済み */ }
  }
  #report(phase: RuntimeFailure["phase"]): void {
    const failure = { phase, roomId: this.ctx.id.toString() };
    try {
      if (this.adapter.onError) this.adapter.onError(failure);
      else console.error("DefGame runtime failure", failure);
    } catch { console.error("DefGame diagnostic handler failed", failure); }
  }
  webSocketClose(socket: WebSocket, code: number): void {
    this.#close(socket, code === 1005 || code === 1006 || code === 1015 ? 1000 : code);
  }
  webSocketError(socket: WebSocket): void { this.#close(socket); }
}
