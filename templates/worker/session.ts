import { DurableObject } from "cloudflare:workers";
import { gameAdapter, type State, type ServerMessage, type ProtocolError } from __ADAPTER_IMPORT__;
import type { Env } from "./env.js";
import { isRecord, parseCommandRequest } from "./runtime/parse.js";

const STATE_KEY = "game-state";
type Success = Extract<ReturnType<typeof gameAdapter.game.handleCommand>, { ok: true }>;

/** 生成対象の Session runtime。ゲーム固有の判断は gameAdapter だけを通して呼ぶ。 */
export class SessionDurableObject extends DurableObject<Env> {
  // State の独自キャッシュを持たない。再起動時にも Storage と attachment だけで復元する。
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const actorId = request.headers.get("x-actor-id");
      const fail = (code: ProtocolError["code"], status: number) => Response.json({ ok: false, error: { code } }, { status });
      if (!actorId) return fail("AuthenticationRequired", 401);
      const path = new URL(request.url).pathname;
      const stored = await this.ctx.storage.get<State>(STATE_KEY);
      if (path === "/connect" && request.method === "GET") {
        if (stored === undefined) return fail("SessionNotFound", 404);
        if (!gameAdapter.canConnect(stored, actorId)) return fail("NotSessionMember", 403);
        const viewState = gameAdapter.game.project(stored, actorId);
        const pair = new WebSocketPair();
        pair[1].serializeAttachment({ actorId });
        this.ctx.acceptWebSocket(pair[1]);
        this.send(pair[1], { type: "ViewStateEvent", viewState });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (request.method !== "POST" || (path !== "/create" && path !== "/join")) return fail("InvalidRequest", 400);
      if (path === "/create" && stored !== undefined) return fail("InvalidRequest", 409);
      if (path === "/join" && stored === undefined) return fail("SessionNotFound", 404);
      let body: unknown;
      try { body = await request.json(); } catch { return fail("InvalidRequest", 400); }
      const command = path === "/create" ? gameAdapter.parseCreate(body) : gameAdapter.parseJoin(body);
      if (command === null) return fail("InvalidRequest", 400);
      const result = gameAdapter.game.handleCommand(stored === undefined ? gameAdapter.game.createInitialState() : stored, command, { origin: "actor", actorId });
      if (!result.ok) return Response.json(result, { status: 409 });
      // 作成と作成者の参加は、この1回の保存で確定する。
      if (result.state !== stored || result.effects.length > 0) {
        await this.ctx.storage.put(STATE_KEY, result.state);
        this.broadcast(result.state);
        this.deliverEffects(result);
      }
      return Response.json({ ok: true });
    });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const parsed = parseCommandRequest(raw);
      const command = parsed ? gameAdapter.parseCommand(parsed.command) : null;
      if (!parsed || command === null) {
        this.send(socket, { type: "ProtocolErrorEvent", error: { code: "InvalidRequest" } });
        return;
      }
      try {
        const attachment: unknown = socket.deserializeAttachment();
        const state = await this.ctx.storage.get<State>(STATE_KEY);
        if (state === undefined || !isRecord(attachment) || typeof attachment.actorId !== "string" || !gameAdapter.canConnect(state, attachment.actorId)) {
          this.send(socket, { type: "GameCommandResponse", requestId: parsed.requestId, ok: false, error: { code: "NotSessionMember" } });
          return;
        }
        const result = gameAdapter.game.handleCommand(state, command, { origin: "actor", actorId: attachment.actorId });
        if (!result.ok) {
          this.send(socket, { type: "GameCommandResponse", requestId: parsed.requestId, ok: false, error: result.error });
          return;
        }
        await this.ctx.storage.put(STATE_KEY, result.state);
        this.send(socket, { type: "GameCommandResponse", requestId: parsed.requestId, ok: true });
        this.broadcast(result.state);
        this.deliverEffects(result);
      } catch {
        console.error("Session command failed");
        this.send(socket, { type: "GameCommandResponse", requestId: parsed.requestId, ok: false, error: { code: "InternalError" } });
      }
    });
  }

  /** Fire after commit; isolate failures from the saved command and remaining effects. */
  private deliverEffects(result: Success): void {
    this.ctx.waitUntil((async () => {
      for (const effect of result.effects) {
        try {
          if (!gameAdapter.executeEffect) throw new Error("Effect handler is not configured");
          await gameAdapter.executeEffect(effect, { sessionId: this.ctx.id.toString(), env: this.env });
        } catch {
          // Do not log arbitrary effect payloads: games own redaction and recovery records.
          console.error("Session effect delivery failed", { sessionId: this.ctx.id.toString() });
        }
      }
    })());
  }

  private broadcast(state: State): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment: unknown = socket.deserializeAttachment();
        if (!isRecord(attachment) || typeof attachment.actorId !== "string" || !gameAdapter.canConnect(state, attachment.actorId)) continue;
        this.send(socket, { type: "ViewStateEvent", viewState: gameAdapter.game.project(state, attachment.actorId) });
      } catch {
        console.error("Session view delivery failed");
        this.close(socket);
      }
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try { socket.send(JSON.stringify(message)); } catch { this.close(socket); }
  }

  private close(socket: WebSocket): void {
    try { socket.close(1011, "Delivery failed"); } catch { /* 切断済み。確定済みの保存結果へ影響させない。 */ }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void { socket.close(code, reason); }
  webSocketError(socket: WebSocket): void { socket.close(1011, "Connection error"); }
}
