
export interface DefaultWsEventMap {
}

export interface DefaultGameLogicState {
};

export type WsEvent<T extends keyof M, M extends Record<string, any>> = {
    type: T;
    payload: M[T];
};

export type Task = {
    type: string;
    execute: <T extends DefaultGameLogicState>(gs: T) => TaskResult<T>;
};

export interface TaskResult<T extends DefaultGameLogicState> {
    type: string
    state: T;
}

export type GameState<T extends DefaultGameLogicState> = {
    gameLogicState: T;
    taskQueue: Task[];
};

export interface GameRule<T extends DefaultGameLogicState, A extends Record<string, any>> {
    // Initial state
    initialGameLogicState: () => T;

    // Divide GameState updates into the smallest execution units, called tasks
    divider<T extends keyof A>(event: WsEvent<T, A>): Task[];

    // Update the task queue
    prioritizeTasks(newTasks: Task[], gameState: GameState<T>): GameState<T>;

    // Manage task execution (e.g., user interactions)
    doTask(state: GameState<T>): GameState<T>;
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

    async getState(): Promise<GameState<S>> {
        return await this.storage.loadGameState();
    }

    async setState(state: GameState<S>): Promise<void> {
        await this.storage.saveGameState(state);
    }
}

interface GameStateStorage<T extends DefaultGameLogicState> {
    loadGameState(): Promise<GameState<T>>;
    saveGameState(state: GameState<T>): Promise<void>;
}

class InMemoryGameStateStorage<T extends DefaultGameLogicState> implements GameStateStorage<T> {
    private state: GameState<T> | null = null;

    async loadGameState(): Promise<GameState<T>> {
        if (this.state === null) {
            throw new Error('Game state is not initialized');
        }
        return this.state;
    }

    async saveGameState(state: GameState<T>): Promise<void> {
        this.state = state;
    }
}
