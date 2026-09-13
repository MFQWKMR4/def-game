import type { GameDefinition } from "def-game";

/**
 * 生成対象の runtime とゲーム固有コードの接続契約。GameDefinition 自体は変更しない。
 * decoder は未検証の本文からゲーム command を作り、形式不正なら null を返す。
 * 参加・復帰の意味や認可は game.handleCommand が判断する。
 */
export interface GameAdapter<State, Command, View, Error, Effect = never> {
  /** External delivery after persistence. No automatic retries; receivers should deduplicate. */
  readonly executeEffect?: (effect: Effect, context: EffectContext) => Promise<void>;
  readonly game: GameDefinition<State, Command, string, View, Effect, Error>;
  readonly parseCreate: (input: unknown) => Command | null;
  readonly parseJoin: (input: unknown) => Command | null;
  readonly parseCommand: (input: unknown) => Command | null;
  readonly canConnect: (state: State, actorId: string) => boolean;
}

export interface EffectContext {
  readonly sessionId: string;
  readonly env: Readonly<Record<string, unknown>>;
}
