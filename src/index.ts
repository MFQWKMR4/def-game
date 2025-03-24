
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
    execute: (gs: DefaultGameLogicState) => TaskResult;
};

export interface TaskResult {
    type: string
    state: DefaultGameLogicState;
}

export type GameState = {
    gameLogicState: DefaultGameLogicState;
    taskQueue: Task[];
};

export interface GameRule<A extends Record<string, any>> {
    // Initial state
    initialGameLogicState: () => DefaultGameLogicState;

    // Divide GameState updates into the smallest execution units, called tasks
    divider<T extends keyof A>(event: WsEvent<T, A>): Task[];

    // Update the task queue
    prioritizeTasks(newTasks: Task[], gameState: GameState): GameState;

    // Manage task execution (e.g., user interactions)
    doTask(state: GameState): GameState;
}

// This is a simulator
export class GameEngine<A extends Record<string, any>> { // like Cloudflare Workers
    private rules: GameRule<A>; // means the program developer should write
    private storage: GameStateStorage; // like Durable Object

    constructor(rules: GameRule<A>) {
        this.rules = rules;
        this.storage = new InMemoryGameStateStorage();

        // Initialize the game state
        const gameState: GameState = {
            gameLogicState: this.rules.initialGameLogicState(),
            taskQueue: []
        }
        this.storage.saveGameState(gameState);
    }

    async executeAction<T extends keyof A>(action: WsEvent<T, A>): Promise<GameState> {
        const tasks = this.rules.divider(action);
        const state = await this.storage.loadGameState();

        // ------ Game Logic ------

        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTask(updatedQueueState);

        // ------------------------

        await this.storage.saveGameState(newState);
        return newState; // this means that this game state is broadcasted to all players
    }

    async getState(): Promise<GameState> {
        return await this.storage.loadGameState();
    }

    async setState(state: GameState): Promise<void> {
        await this.storage.saveGameState(state);
    }
}

interface GameStateStorage {
    loadGameState(): Promise<GameState>;
    saveGameState(state: GameState): Promise<void>;
}

class InMemoryGameStateStorage implements GameStateStorage {
    private state: GameState | null = null;

    async loadGameState(): Promise<GameState> {
        if (this.state === null) {
            throw new Error('Game state is not initialized');
        }
        return this.state;
    }

    async saveGameState(state: GameState): Promise<void> {
        this.state = state;
    }
}
