// the user should define the data whose type is FromServerMap and ToServerMap
export type FromServerMap = Record<string, any>;
export type ToServerMap = Record<string, any>;
export type InteractionMapType = {
    [key in InteractionKey]: {
        fromServer: FromServerMap[key];
        toServer: ToServerMap[key];
    }
}
// the user should define the game logic state that extends DefaultGameLogicState
export interface DefaultGameLogicState {
    forClient: ForClient;
};

export type FromServerDataType = keyof FromServerMap;
export type ToServerDataType = keyof ToServerMap;

export type FromServerData = {
    type: FromServerDataType;
    payload: FromServerMap[FromServerDataType];
}
export type ToServerData = {
    type: ToServerDataType;
    payload: ToServerMap[ToServerDataType];
}

export type InteractionKey = Extract<keyof FromServerMap, keyof ToServerMap>;

export type InteractionFromServerData = {
    type: InteractionKey;
    payload: InteractionMapType[InteractionKey]["fromServer"];
};
export type InteractionToServerData = {
    type: InteractionKey;
    payload: InteractionMapType[InteractionKey]["toServer"];
};

export type FromServer = FromServerData | InteractionFromServerData;
export type ToServer = ToServerData | InteractionToServerData;

export type PlayerId = string;
export type ForClient = { [key: PlayerId]: FromServer; };

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
export interface GameRule<L extends DefaultGameLogicState> {
    initialGameLogicState: () => L;
    divider(event: ToServer): Task<L>[];
    prioritizeTasks(newTasks: Task<L>[], gameState: GameState<L>): GameState<L>;
    doTask(state: GameState<L>): GameState<L>;
}
