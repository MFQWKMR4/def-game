import { DefaultGameLogicState, GameRule, GameState, ToServer } from "./types";

// This is a simulator
export class GameEngine<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>> { // like Cloudflare Workers
    private rules: GameRule<S, C, L>; // means the program developer should write
    private storage: GameStateStorage<S, C, L>; // like Durable Object

    constructor(rules: GameRule<S, C, L>) {
        this.rules = rules;
        this.storage = new InMemoryGameStateStorage();

        // Initialize the game state
        const gameState: GameState<S, C, L> = {
            gameLogicState: this.rules.initialGameLogicState(),
            taskQueue: []
        }
        this.storage.saveGameState(gameState);
    }

    executeAction(action: ToServer<S, C>): GameState<S, C, L> {
        const tasks = this.rules.divider(action);
        const state = this.storage.loadGameState();

        // ------ Game Logic ------

        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTask(updatedQueueState);

        // ------------------------

        this.storage.saveGameState(newState);
        return newState; // this means that this game state is broadcasted to all players
    }

    getState(): GameState<S, C, L> {
        return this.storage.loadGameState();
    }

    setState(state: GameState<S, C, L>): void {
        this.storage.saveGameState(state);
    }
}

interface GameStateStorage<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>> {
    loadGameState(): GameState<S, C, L>;
    saveGameState(state: GameState<S, C, L>): void;
}

class InMemoryGameStateStorage<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>> implements GameStateStorage<S, C, L> {
    private state: GameState<S, C, L> | null = null;

    loadGameState(): GameState<S, C, L> {
        if (this.state === null) {
            throw new Error('Game state is not initialized');
        }
        return this.state;
    }

    saveGameState(state: GameState<S, C, L>): void {
        this.state = state;
    }
}