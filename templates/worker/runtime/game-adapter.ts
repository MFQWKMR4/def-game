import type { GameDefinition } from "def-game";

/**
 * 生成対象の runtime とゲーム固有コードの接続契約。GameDefinition 自体は変更しない。
 * decoder は未検証の本文からゲーム command を作り、形式不正なら null を返す。
 * 参加・復帰の意味や認可は game.handleCommand が判断する。
 * 現段階は Effect なし。timeout / Effect の生成オプションは実装時に別途追加する。
 */
export interface GameAdapter<State, Command, View, Error> {
  readonly game: GameDefinition<State, Command, string, View, never, Error>;
  readonly parseCreate: (input: unknown) => Command | null;
  readonly parseJoin: (input: unknown) => Command | null;
  readonly parseCommand: (input: unknown) => Command | null;
  readonly canConnect: (state: State, actorId: string) => boolean;
}
