import { CustomEventHander, simplify } from "./helper";
import { Custom, CustomOnly, PlayerId, ReqPayload, Simple, Task, ToServer } from "./types";

// req payload
interface LoginReq extends ReqPayload {
    senderId: PlayerId;
    name: string;
}

interface MoveReq extends ReqPayload {
    senderId: PlayerId;
    direction: "up" | "down" | "left" | "right";
}

// task arguments

type Task1 = {
    name: string;
    password: string;
}

type Task2 = {
    name: string;
    level: number;
}

type Task3 = {
    name: string;
    level: number;
}

type AuthorizeTask = {
    name: string;
    password: string;
}

type AuthenticateTask = {
    name: string;
    level: number;
}

type ComplicatedReq = {
    senderId: PlayerId;
    name: string;
    level: number;
}

// define the request types
type Req = {
    "login": Custom<LoginReq>;
    "move": Simple<MoveReq>;
    "complicatedReq": Custom<ComplicatedReq>;
}

type A = {
    "move": Simple<MoveReq>;
}

// A equals to SimpleOnly<Req>



// define the task types
type Tasks = {
    "authorize": AuthorizeTask
    "authenticate": AuthenticateTask
    "task1": Task1
    "task2": Task2
    "task3": Task3
}

const customEventHander: CustomEventHander<Req, Tasks> = (r: ToServer<CustomOnly<Req>>) => {
    switch (r.type) {
        case "login":
            return [
                {
                    type: "authorize",
                    payload: {
                        name: "a",
                        password: "b",
                    },
                },
                {
                    type: "authenticate",
                    payload: {
                        name: "a",
                        level: 1,
                    },
                }
            ]
        case "complicatedReq":
            return [
                {
                    type: "task1",
                    payload: {
                        name: "a",
                        password: "b",
                    },
                },
                {
                    type: "task2",
                    payload: {
                        name: "a",
                        level: 1,
                    },
                },
                {
                    type: "task3",
                    payload: {
                        name: "a",
                        level: 1,
                    },
                }
            ]
        default:
            return [];
    }
}

// no need to write process that handles simple requests
const _sampleGenerateTasks = simplify(customEventHander);

// ------------------------------------------------------------

// this is how you handle tasks
// task cases are composed 
// - keyof SimpleOnlyPayload<Req>
// - keyof Tasks
const _switchTask = (task: Task<Req, Tasks>) => {
    switch (task.type) {
        case "move":
            return moveTaskHandler(task.payload);
        // login is a custom request, so we need to handle it differently
        case "authorize":
            return authorizeTaskHandler(task.payload);
        case "authenticate":
            return authenticateTaskHandler(task.payload);
        case "task1":
            return task1Handler(task.payload);
        case "task2":
            return task2Handler(task.payload);
        case "task3":
            return task3Handler(task.payload);
        default:
            const _exhaustiveCheck: never = task;
            console.log("unknown event", task);
    }
}

const moveTaskHandler = (payload: MoveReq) => {
    console.log(payload);
}

const authorizeTaskHandler = (payload: AuthorizeTask) => {
    console.log(payload);
}

const authenticateTaskHandler = (payload: AuthenticateTask) => {
    console.log(payload);
}

const task1Handler = (payload: Task1) => {
    console.log(payload);
}

const task2Handler = (payload: Task2) => {
    console.log(payload);
}

const task3Handler = (payload: Task3) => {
    console.log(payload);
}

// ------------------------------------------------------------

