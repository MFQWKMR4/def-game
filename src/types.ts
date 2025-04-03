
type Map = Record<string, any>;

// the user should define T interface.
export type FromServerMap<T extends Map> = T;
export type ToServerMap<T extends Map> = T;
export type TaskMap<T extends Map> = T;
export type InteractionMapType<S extends Map, C extends Map> = {
    [key in InteractionKey<S, C>]: {
        fromServer: FromServerMap<S>[key];
        toServer: ToServerMap<C>[key];
    }
}

export type Player = {
    id: PlayerId;
    name: string;
};

export type Joiner = {
    numberOfPlayers: number;
    enteredPlayers: Player[];
}

export interface GameParameters {
    owner: Player;
    joiner: Joiner;
}

// the user should define the game logic state that extends DefaultGameLogicState
export interface DefaultGameLogicState<S extends Map, C extends Map> {
    forClient: ForClient<S, C>;
};

export type FromServerDataType<T extends Map> = keyof FromServerMap<T>;
export type ToServerDataType<T extends Map> = keyof ToServerMap<T>;

export type FromServerData<T extends Map> = {
    type: FromServerDataType<T>;
    payload: FromServerMap<T>[FromServerDataType<T>];
}
export type ToServerData<T extends Map> = {
    type: ToServerDataType<T>;
    payload: ToServerMap<T>[ToServerDataType<T>];
}

export type InteractionKey<S extends Map, C extends Map>
    = Extract<keyof FromServerMap<S>, keyof ToServerMap<C>>;

export type InteractionFromServerData<S extends Map, C extends Map> = {
    type: InteractionKey<S, C>;
    payload: InteractionMapType<S, C>[InteractionKey<S, C>]["fromServer"];
};
export type InteractionToServerData<S extends Map, C extends Map> = {
    type: InteractionKey<S, C>;
    payload: InteractionMapType<S, C>[InteractionKey<S, C>]["toServer"];
};

export type FromServer<S extends Map, C extends Map> = FromServerData<S> | InteractionFromServerData<S, C>;
export type ToServer<S extends Map, C extends Map> = ToServerData<C> | InteractionToServerData<S, C>;

export type PlayerId = string;
export type ForUI<S extends Map, C extends Map> = {
    requiredAction: FromServer<S, C> | null;
    notifications: FromServer<S, C>[];
};
export type ForClient<S extends Map, C extends Map> = { [key: PlayerId]: ForUI<S, C>; };

export type Task<T extends Map> = {
    type: keyof TaskMap<T>;
    args: TaskMap<T>[keyof TaskMap<T>];
};
export interface TaskResult<S extends Map, C extends Map, L extends DefaultGameLogicState<S, C>> {
    type: string;
    state: L;
}
export type GameState<T extends Map, S extends Map, C extends Map, L extends DefaultGameLogicState<S, C>, P extends GameParameters> = {
    gameLogicState: L;
    taskQueue: Task<T>[];
    gameParameters: P | null;
};
export interface GameRule<T extends Map, S extends Map, C extends Map, L extends DefaultGameLogicState<S, C>, P extends GameParameters> {
    initialGameLogicState: () => L;
    createRoom: (state: GameState<T, S, C, L, P>, param: P) => GameState<T, S, C, L, P>;
    onStartGame: (state: GameState<T, S, C, L, P>, joiner: Player) => GameState<T, S, C, L, P>;
    generateTasks(state: GameState<T, S, C, L, P>, event: ToServer<S, C>): Task<T>[];
    prioritizeTasks(newTasks: Task<T>[], gameState: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
    doTasks(state: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
}
