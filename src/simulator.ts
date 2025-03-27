import { DefaultGameLogicState, GameParameters, GameRule, GameState, Joiner, Player, ToServer } from "./types";

// This is a simulator
export class GameEngine<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>, P extends GameParameters> { // like Cloudflare Workers
    private rules: GameRule<S, C, L, P>; // means the program developer should write
    private storage: GameStateStorage<S, C, L, P>; // like Durable Object

    constructor(rules: GameRule<S, C, L, P>) {
        this.rules = rules;
        this.storage = new InMemoryGameStateStorage();

        // Initialize the game state
        const gameState: GameState<S, C, L, P> = {
            gameParameters: null,
            gameLogicState: this.rules.initialGameLogicState(),
            taskQueue: []
        }
        this.storage.saveGameState(gameState);
    }

    createRoom(p: P): void {
        const state = this.storage.loadGameState();
        const configured = this.rules.createRoom(state, p);
        this.storage.saveGameState(configured);
    }

    join(player: Player): void {
        const state = this.storage.loadGameState();
        const started = this.rules.onStartGame(state, player);
        this.storage.saveGameState(started);
    }

    executeAction(action: ToServer<S, C>): GameState<S, C, L, P> {
        const tasks = this.rules.divider(action);
        const state = this.storage.loadGameState();

        // ------ Game Logic ------

        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTask(updatedQueueState);

        // ------------------------

        this.storage.saveGameState(newState);
        return newState; // this means that this game state is broadcasted to all players
    }

    getState(): GameState<S, C, L, P> {
        return this.storage.loadGameState();
    }

    setState(state: GameState<S, C, L, P>): void {
        this.storage.saveGameState(state);
    }
}

interface GameStateStorage<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>, P extends GameParameters> {
    loadGameState(): GameState<S, C, L, P>;
    saveGameState(state: GameState<S, C, L, P>): void;
}

class InMemoryGameStateStorage<S extends Record<string, any>, C extends Record<string, any>, L extends DefaultGameLogicState<S, C>, P extends GameParameters> implements GameStateStorage<S, C, L, P> {
    private state: GameState<S, C, L, P> | null = null;

    loadGameState(): GameState<S, C, L, P> {
        if (this.state === null) {
            throw new Error('Game state is not initialized');
        }
        return this.state;
    }

    saveGameState(state: GameState<S, C, L, P>): void {
        this.state = state;
    }
}