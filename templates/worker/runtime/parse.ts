export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 通信 envelope だけを検証する。command の名前・payload の意味は adapter が判断する。 */
export function parseCommandRequest(raw: string | ArrayBuffer): { requestId: string; command: unknown } | null {
  if (typeof raw !== "string" || raw.length > 64 * 1024) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.type !== "GameCommandRequest" || typeof value.requestId !== "string"
      || value.requestId.length === 0 || value.requestId.length > 128 || !Object.hasOwn(value, "command")) return null;
    return { requestId: value.requestId, command: value.command };
  } catch { return null; }
}
