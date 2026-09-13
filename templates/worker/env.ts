import type { SessionDurableObject } from "./session.js";

export interface Env extends Record<string, unknown> {
  SESSIONS: DurableObjectNamespace<SessionDurableObject>;
  ASSETS: Fetcher;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
}
