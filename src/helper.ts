import { Custom, CustomOnly, Notify, ReqMap, ReqPayload, Require, RequireSetting, Simple, SimpleOnlyPayload, Task, TaskMapType, ToServer } from "./types"

export const simple = <T extends ReqPayload>(payload: T): Simple<T> => {
    return {
        kind: "simple",
        value: payload
    }
}

export const custom = <T extends ReqPayload>(payload: T): Custom<T> => {
    return {
        kind: "custom",
        value: payload
    }
}

export const requiring = <T extends ReqPayload>(payload: T, setting: RequireSetting): Require<T> => {
    return {
        kind: "require",
        value: payload,
        setting
    }
}

export const notifying = <T extends ReqPayload>(payload: T): Notify<T> => {
    return {
        kind: "notify",
        value: payload
    }
}

export type CustomEventHander<A extends ReqMap, B extends Record<string, any>>
    = (r: ToServer<CustomOnly<A>>) => Task<A, B>[]


export const simplify =
    <A extends ReqMap, B extends Record<string, any>>(h: CustomEventHander<A, B>) =>
        (a: ToServer<A>): Task<A, B>[] => {
            switch (a.payload.kind) {
                case "simple":
                    const key: keyof SimpleOnlyPayload<A> = a.type as keyof SimpleOnlyPayload<A>;
                    const payload = a.payload.value as TaskMapType<A, B>[keyof SimpleOnlyPayload<A>];
                    return [
                        {
                            type: key,
                            payload,
                        }
                    ]
                case "custom":
                    const b = a as ToServer<CustomOnly<A>>;
                    return h(b);
            }
        }
