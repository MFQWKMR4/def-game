import type { GameDefinition } from "../game-definition.js";

/** ゲームが所有する型をまとめる。runtimeはStateの内部構造を解釈しない。 */
export interface GameTypes {
  state: unknown;
  actorCommand: unknown;
  systemCommand: unknown;
  view: unknown;
  effect: unknown;
  error: unknown;
}

/** アプリが本人確認を済ませた実行元。型そのものに認証能力はない。 */
export interface VerifiedActor { readonly actorId: string }

/** ゲームの拒否とインフラ側の拒否を区別する。内部例外はペイロードへ含めない。 */
export type RuntimeError = { readonly kind: "runtime"; readonly code:
  "RoomNotFound" | "RoomAlreadyExists" | "InvalidRequest" | "NotRoomMember" | "InternalError" };
export type CommandResult<Error> = { readonly ok: true } | {
  readonly ok: false;
  readonly error: RuntimeError | { readonly kind: "game"; readonly detail: Error };
};
export type CreateRoomResult = { readonly ok: true; readonly roomId: string }
  | { readonly ok: false; readonly error: RuntimeError };

/** 保存状態そのものではなく、ゲームがActorに公開するViewを返す。 */
export type GetViewResult<View> = { readonly ok: true; readonly view: View }
  | { readonly ok: false; readonly error: RuntimeError };

/** 状態と一緒に確定する、論理的な予定イベントの予約・解除。 */
export type ScheduledEffect =
  | { readonly type: "schedule"; readonly id: string; readonly deadline: number }
  | { readonly type: "cancel"; readonly id: string };

/** 失敗した区間を通知する。秘密の状態・Command・Effectを自動ログに含めない。 */
export interface RuntimeFailure {
  readonly roomId: string;
  readonly phase: "create" | "command" | "effect" | "effect-feedback" | "view" | "connection";
}

/** 純粋なゲームと、アプリ固有の入力・外部処理を共通runtimeへ接続する。 */
export interface GameAdapter<Env, T extends GameTypes> {
  readonly game: GameDefinition<T["state"], T["actorCommand"] | T["systemCommand"], string,
    T["view"], T["effect"], T["error"]>;
  readonly webSocket: {
    /** クライアントが指定してよい入力だけCommandにする。手番等の検証はゲームに残す。 */
    readonly parseCommand: (input: unknown) => T["actorCommand"] | null;
  };
  readonly canConnect: (state: T["state"], actorId: string) => boolean;
  readonly scheduler?: {
    readonly effect: (effect: T["effect"]) => ScheduledEffect | null;
    readonly command: (id: string) => T["systemCommand"];
  };
  /** 保存後のbest-effort処理。結果はruntimeがSystem Commandとして再度dispatchする。 */
  readonly executeEffect?: (effect: T["effect"], context: { readonly env: Env; readonly roomId: string })
    => Promise<void | { readonly command: T["systemCommand"] }>;
  /** 同期の診断フック。例外はruntimeが隔離する。配送・再試行の仕組みではない。 */
  readonly onError?: (failure: RuntimeFailure) => void;
}

/** WebSocketの共通envelope。actorIdやoriginはクライアントから受け取らない。 */
export interface GameCommandRequest<Command> {
  readonly type: "GameCommandRequest";
  readonly requestId: string;
  readonly command: Command;
}
export type GameCommandResponse<Error> = CommandResult<Error> & {
  readonly type: "GameCommandResponse"; readonly requestId: string;
};
export interface ViewStateEvent<View> { readonly type: "ViewStateEvent"; readonly viewState: View }
export interface ProtocolErrorEvent { readonly type: "ProtocolErrorEvent"; readonly error: RuntimeError }
export type ServerMessage<View, Error> = GameCommandResponse<Error> | ViewStateEvent<View> | ProtocolErrorEvent;
