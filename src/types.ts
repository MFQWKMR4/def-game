type Map = Record<string, any>;
type Merge<A, B> = {
    [K in keyof A | keyof B]: K extends keyof B
    ? B[K]
    : K extends keyof A
    ? A[K]
    : never;
};

export interface ReqPayload {
    playerId: PlayerId;
}

export type Second = number;

export type ReqMap = Record<string, Simple<ReqPayload> | Custom<ReqPayload>>;

export interface RequireSetting {
    limitedTime: Second
}

export type ResMap = Record<string, Require<any> | Notify<any>>;

export type Simple<T extends ReqPayload> = { kind: "simple"; value: T };
export type Custom<T extends ReqPayload> = { kind: "custom"; value: T };

export type Require<T> = { kind: "require"; value: T; setting: RequireSetting };
export type Notify<T> = { kind: "notify"; value: T };

export type FromServerMap<T extends ResMap> = T;
export type ToServerMap<T extends ReqMap> = T;
export type CustomTaskMap<T extends Map> = T;

export type ExtractSimplePayload<T> = T extends Simple<infer U> ? U : never;
export type ExtractCustomPayload<T> = T extends Custom<infer U> ? U : never;

export type SimpleOnlyPayload<T extends ReqMap> = {
    [K in keyof T as T[K] extends Simple<any> ? K : never]: ExtractSimplePayload<T[K]>;
};
export type CustomOnlyPayload<T extends ReqMap> = {
    [K in keyof T as T[K] extends Custom<any> ? K : never]: ExtractCustomPayload<T[K]>;
};

export type CustomOnly<T extends ReqMap> = {
    [K in keyof T as T[K] extends Custom<any> ? K : never]: T[K];
};

export type RequireOnly<T extends ReqMap> = {
    [K in keyof T as T[K] extends Require<any> ? K : never]: T[K];
};

export type NotifyOnly<T extends ReqMap> = {
    [K in keyof T as T[K] extends Notify<any> ? K : never]: T[K];
};

export type TaskMapType<A extends ReqMap, B extends Map> = Merge<SimpleOnlyPayload<A>, CustomTaskMap<B>>;

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
export interface DefaultGameLogicState<S extends Map> {
    forClient: ForClient<S>;
};

export type FromServerDataType<T extends Map> = keyof FromServerMap<T>;
export type ToServerDataType<T extends Map> = keyof ToServerMap<T>;

export type FromServerData<T extends ResMap> = {
    [K in keyof T]: {
        type: K;
        payload: T[K];
    }
}[keyof T];

export type ToServerData<T extends ReqMap> = {
    [K in keyof T]: {
        type: K;
        payload: T[K];
    }
}[keyof T];

export type FromServer<S extends ResMap> = FromServerData<S>;
export type ToServer<C extends ReqMap> = ToServerData<C>;

// I want to make a type that is defined as `ToServer<C extends ReqMap>`
// C extends ReqMap , but C's key is not a string
export type ToServerWithNonStringKey<C extends ReqMap> = {
    [K in keyof C]: {
        type: K;
        payload: C[K];
    }
}[keyof C];

export type PlayerId = string;
export type ForUI<S extends ResMap> = {
    requiredAction: FromServer<S> | null;
    notifications: FromServer<S>[];
};
export type ForClient<S extends Map> = { [key: PlayerId]: ForUI<S>; };

export type Task<A extends ReqMap, B extends Map> = {
    [K in keyof TaskMapType<A, B>]: {
        type: K;
        payload: TaskMapType<A, B>[K];
    }
}[keyof TaskMapType<A, B>];

export interface TaskResult<S extends Map, L extends DefaultGameLogicState<S>> {
    type: string;
    state: L;
}
export type GameState<T extends Map, S extends Map, C extends ReqMap, L extends DefaultGameLogicState<S>, P extends GameParameters> = {
    gameLogicState: L;
    taskQueue: Task<C, T>[];
    gameParameters: P | null;
};
export interface GameRule<T extends Map, S extends Map, C extends ReqMap, L extends DefaultGameLogicState<S>, P extends GameParameters> {
    initialGameLogicState: () => L;
    createRoom: (state: GameState<T, S, C, L, P>, param: GameParameters) => GameState<T, S, C, L, P>;
    onJoin: (state: GameState<T, S, C, L, P>, joiner: Player) => GameState<T, S, C, L, P>;
    onStartGame: (state: GameState<T, S, C, L, P>) => GameState<T, S, C, L, P>;
    generateTasks(state: GameState<T, S, C, L, P>, event: ToServer<C>): Task<C, T>[];
    prioritizeTasks(newTasks: Task<C, T>[], gameState: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
    doTasks(state: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
    privaten(destinationId: PlayerId, l: L): L
}
