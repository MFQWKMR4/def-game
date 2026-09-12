import type { SessionDurableObject } from "./session.js";

export interface Env {
  SESSIONS: DurableObjectNamespace<SessionDurableObject>;
  ASSETS: Fetcher;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
}
