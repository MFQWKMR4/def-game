/**
 * Worker や simulator が確定したコマンドの実行元。
 * actorId は認証済みの主体を表し、接続 ID ではない。
 * 外部リクエストの自己申告をそのまま使わず、system は信頼できる実行側だけが指定する。
 */
export type CommandContext<ActorId> =
    | { readonly origin: "actor"; readonly actorId: ActorId }
    | { readonly origin: "system" };

/**
 * 成功時は次の安定状態と副作用の宣言、失敗時はゲーム上の拒否理由を返す。
 * 実行側は成功した状態を保存してから外部 Effect を処理する。
 * 同じストレージ内の Alarm 予約などは、状態と原子的に保存できる。
 */
export type TransitionResult<State, Effect, Error> =
    | {
        readonly ok: true;
        readonly state: State;
        readonly effects: readonly Effect[];
    }
    | { readonly ok: false; readonly error: Error };

/**
 * 通信・永続化から独立したゲームそのものの契約。
 * State の構造や入力待ちの表現は各ゲームが定義し、kernel は task queue を要求しない。
 */
export interface GameDefinition<State, Command, ActorId, View, Effect, Error> {
    /** Session や接続の情報に依存しない、ゲームの初期状態を生成する。 */
    createInitialState(): State;

    /**
     * 実行元とコマンドを再検証し、次の外部入力を待てる安定状態まで遷移する。
     * 入力 state を変更せず、拒否時は error のみを返す。外部 I/O は行わない。
     * system 起点でも、そのコマンドが現在の状態で有効かを検証する。
     */
    handleCommand(
        state: State,
        command: Command,
        context: CommandContext<ActorId>
    ): TransitionResult<State, Effect, Error>;

    /**
     * state を変更せず、Actor に公開できる情報と availableActions を持つ View を生成する。
     * availableActions は表示補助であり、コマンド実行時の検証を省略する根拠にはしない。
     */
    project(state: State, actorId: ActorId): View;
}
