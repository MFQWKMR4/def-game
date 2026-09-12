import type { CommandContext, GameDefinition, TransitionResult } from "./game-definition";

/**
 * Worker なしで同じゲーム定義にコマンドを順番に流す実行器。
 * 状態はメモリだけに保存し、Effect は実行せず検証用に返す。
 * ゲーム定義と呼び出し側は、受け取った状態を直接変更しない契約に従う。
 */
export class GameSimulator<State, Command, ActorId, View, Effect, Error> {
    private state: State;

    /** ゲーム定義が生成した初期状態から、独立した試行を開始する。 */
    constructor(
        private readonly definition: GameDefinition<State, Command, ActorId, View, Effect, Error>
    ) {
        this.state = definition.createInitialState();
    }

    /** コマンドが成功した場合だけ次の状態を採用し、結果をそのまま返す。 */
    executeCommand(
        command: Command,
        context: CommandContext<ActorId>
    ): TransitionResult<State, Effect, Error> {
        const result = this.definition.handleCommand(this.state, command, context);
        if (result.ok) {
            this.state = result.state;
        }
        return result;
    }

    /** シナリオの検証用に全状態を参照する。クライアント配信用ではない。 */
    getState(): State {
        return this.state;
    }

    /** 現在の状態を指定 Actor 向けに投影する。 */
    getView(actorId: ActorId): View {
        return this.definition.project(this.state, actorId);
    }
}
