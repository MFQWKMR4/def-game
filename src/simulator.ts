import { DefaultGameLogicState, GameRule, GameState, ToServer } from "./types";

// This is a simulator
export class GameEngine<S extends DefaultGameLogicState> { // like Cloudflare Workers
    private rules: GameRule<S>; // means the program developer should write
    private storage: GameStateStorage<S>; // like Durable Object

    constructor(rules: GameRule<S>) {
        this.rules = rules;
        this.storage = new InMemoryGameStateStorage();

        // Initialize the game state
        const gameState: GameState<S> = {
            gameLogicState: this.rules.initialGameLogicState(),
            taskQueue: []
        }
        this.storage.saveGameState(gameState);
    }

    executeAction(action: ToServer): GameState<S> {
        const tasks = this.rules.divider(action);
        const state = this.storage.loadGameState();

        // ------ Game Logic ------

        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTask(updatedQueueState);

        // ------------------------

        this.storage.saveGameState(newState);
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