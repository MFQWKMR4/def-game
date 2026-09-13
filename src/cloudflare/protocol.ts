import type { GameCommandRequest, RuntimeError } from "./types.js";

/** 配列やnullをオブジェクト入力として扱わない。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** envelopeだけを読む。ゲーム固有の入力はadapterのWS parserが検証する。 */
export function parseCommandRequest(raw: string | ArrayBuffer): GameCommandRequest<unknown> | null {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 64 * 1024) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.type !== "GameCommandRequest" || typeof value.requestId !== "string"
      || value.requestId.length === 0 || value.requestId.length > 128
      || !Object.prototype.hasOwnProperty.call(value, "command")) return null;
    return { type: "GameCommandRequest", requestId: value.requestId, command: value.command };
  } catch { return null; }
}

/** runtimeの拒否理由を共通形式にする。 */
export function failure(code: RuntimeError["code"]): { ok: false; error: RuntimeError } {
  return { ok: false, error: { kind: "runtime", code } };
}
