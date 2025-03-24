
export interface DefaultWsEventMap {
}

export interface DefaultGameLogicState {
};

export type WsEvent<T extends keyof M, M extends Record<string, any>> = {
    type: T;
    payload: M[T];
};
export type Task<L extends DefaultGameLogicState> = {
    type: string;
    execute: (gs: L) => TaskResult<L>;
};
export interface TaskResult<L extends DefaultGameLogicState> {
    type: string;
    state: L;
}
export type GameState<L extends DefaultGameLogicState> = {
    gameLogicState: L;
    taskQueue: Task<L>[];
};
export interface GameRule<L extends DefaultGameLogicState, A extends Record<string, any>> {
    initialGameLogicState: () => L;
    divider<T extends keyof A>(event: WsEvent<T, A>): Task<L>[];
    prioritizeTasks(newTasks: Task<L>[], gameState: GameState<L>): GameState<L>;
    doTask(state: GameState<L>): GameState<L>;
}

// This is a simulator
export class GameEngine<S extends DefaultGameLogicState, A extends Record<string, any>> { // like Cloudflare Workers
    private rules: GameRule<S, A>; // means the program developer should write
    private storage: GameStateStorage<S>; // like Durable Object

    constructor(rules: GameRule<S, A>) {
        this.rules = rules;
        this.storage = new InMemoryGameStateStorage();

        // Initialize the game state
        const gameState: GameState<S> = {
            gameLogicState: this.rules.initialGameLogicState(),
            taskQueue: []
        }
        this.storage.saveGameState(gameState);
    }

    async executeAction<T extends keyof A>(action: WsEvent<T, A>): Promise<GameState<S>> {
        const tasks = this.rules.divider(action);
        const state = await this.storage.loadGameState();

        // ------ Game Logic ------

        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTask(updatedQueueState);

        // ------------------------

        await this.storage.saveGameState(newState);
        return newState; // this means that this game state is broadcasted to all players
    }

    getState(): GameState<S> {
        return this.storage.loadGameState();
    }

    setState(state: GameState<S>): void {
        this.storage.saveGameState(state);
    }
}

interface GameStateStorage<T extends DefaultGameLogicState> {
    loadGameState(): GameState<T>;
    saveGameState(state: GameState<T>): void;
}

class InMemoryGameStateStorage<T extends DefaultGameLogicState> implements GameStateStorage<T> {
    private state: GameState<T> | null = null;

    loadGameState(): GameState<T> {
        if (this.state === null) {
            throw new Error('Game state is not initialized');
        }
        return this.state;
    }

    saveGameState(state: GameState<T>): void {
        this.state = state;
    }
}
