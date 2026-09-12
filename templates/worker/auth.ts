import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.js";

let cachedKeys: { url: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;

/** JWT は Worker 境界だけで扱う。署名・必須 claims を検証した sub だけを DO へ渡す。 */
export async function authenticate(token: string | undefined, env: Env): Promise<string | null> {
  if (!token) return null;
  try {
    if (cachedKeys?.url !== env.AUTH_JWKS_URL) {
      // jose がキャッシュと未知 kid に対する再取得（cooldown 付き）を扱う。
      cachedKeys = { url: env.AUTH_JWKS_URL, keys: createRemoteJWKSet(new URL(env.AUTH_JWKS_URL)) };
    }
    const { payload } = await jwtVerify(token, cachedKeys.keys, {
      issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE,
      algorithms: ["ES256"], requiredClaims: ["sub", "exp", "iat"],
    });
    return typeof payload.sub === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(payload.sub)
      ? payload.sub : null;
  } catch {
    return null;
  }
}
