import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ActorId, CreateSessionResponse, JoinSessionResponse, ProtocolError, PublicError } from __ADAPTER_IMPORT__;
import type { Env } from "./env.js";
import { authenticate } from "./auth.js";
export { SessionDurableObject } from "./session.js";

type AppEnv = { Bindings: Env; Variables: { actorId: ActorId } };
const app = new Hono<AppEnv>();

// Static Assets を含む全ルートで認証し、以後は検証済み ActorId を context から取得する。
app.use("*", async (c, next) => {
  const actorId = await authenticate(getCookie(c, "__token"), c.env);
  if (!actorId) return errorResponse(c, "AuthenticationRequired", 401);
  c.set("actorId", actorId);
  await next();
});

app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  const isWebSocket = c.req.path.startsWith("/ws/");
  if (origin && origin !== new URL(c.req.url).origin && (c.req.method !== "GET" || isWebSocket)) {
    return errorResponse(c, "InvalidRequest", 403);
  }
  await next();
});

app.post("/api/sessions", (c) => joinSession(c, c.env.SESSIONS.newUniqueId(), "create"));

app.post("/api/sessions/:sessionId/join", (c) => {
  const sessionId = c.req.param("sessionId");
  if (!/^[0-9a-f]{64}$/.test(sessionId)) return errorResponse(c, "InvalidRequest", 404);
  return joinSession(c, c.env.SESSIONS.idFromString(sessionId), "join");
});

app.get("/ws/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  if (!/^[0-9a-f]{64}$/.test(sessionId)) return errorResponse(c, "InvalidRequest", 404);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return errorResponse(c, "InvalidRequest", 426);
  const id = c.env.SESSIONS.idFromString(sessionId);
  // DO の Hibernation 接続をそのまま返す。token や外部のヘッダーは転送しない。
  return c.env.SESSIONS.get(id).fetch(new Request("https://session/connect", {
    headers: { upgrade: "websocket", "x-actor-id": c.get("actorId") },
  }));
});

app.all("/api/*", (c) => errorResponse(c, "InvalidRequest", 404));
app.all("/ws/*", (c) => errorResponse(c, "InvalidRequest", 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((_error, c) => {
  console.error("Worker request failed");
  return errorResponse(c, "InternalError", 500);
});

export default app;

/** create と join に共通する本文検証と DO 呼び出し。本文のゲーム固有形式と参加可否は DO 内の adapter / domain が判断する。 */
async function joinSession(c: Context<AppEnv>, id: DurableObjectId, operation: "create" | "join"): Promise<Response> {
  if (!c.req.header("content-type")?.startsWith("application/json")) return errorResponse(c, "InvalidRequest", 400);
  const raw = await c.req.text();
  if (raw.length > 64 * 1024) return errorResponse(c, "InvalidRequest", 400);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return errorResponse(c, "InvalidRequest", 400); }

  const result = await c.env.SESSIONS.get(id).fetch(new Request(`https://session/${operation}`, {
    method: "POST", headers: { "x-actor-id": c.get("actorId"), "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  const data = await result.json<{ ok: true } | { ok: false; error: PublicError }>();
  const type = operation === "create" ? "CreateSessionResponse" : "JoinSessionResponse";
  const response: CreateSessionResponse | JoinSessionResponse = data.ok
    ? { type, ok: true, sessionId: id.toString() }
    : { type, ok: false, error: data.error };
  return Response.json(response, { status: result.status });
}

/** middleware で拒否する場合も、既存の公開レスポンス形式を維持する。 */
function errorResponse(c: Context<AppEnv>, code: ProtocolError["code"], status: 400 | 401 | 403 | 404 | 426 | 500): Response {
  const type = c.req.method === "POST" && c.req.path === "/api/sessions"
    ? "CreateSessionResponse"
    : /^\/api\/sessions\/[0-9a-f]{64}\/join$/.test(c.req.path) ? "JoinSessionResponse" : undefined;
  return c.json({ ...(type ? { type } : {}), ok: false, error: { code } }, status);
}
