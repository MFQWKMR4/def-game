const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GameSimulator } = require("../dist/index.js");

// A、B が順に秘密の値を選ぶ。期限切れなら system が既定値を選ぶ検証用ゲーム。
const definition = {
    createInitialState() {
        return { waitingFor: "A", choices: {} };
    },
    handleCommand(state, command, context) {
        if (state.waitingFor === null) return { ok: false, error: "finished" };
        const timeout = command.type === "Timeout" && context.origin === "system";
        const choose = command.type === "Choose" && context.origin === "actor"
            && context.actorId === state.waitingFor;
        if (!timeout && !choose) return { ok: false, error: "not-allowed" };
        const next = {
            waitingFor: state.waitingFor === "A" ? "B" : null,
            choices: { ...state.choices, [state.waitingFor]: timeout ? 0 : command.value },
        };
        return {
            ok: true,
            state: next,
            effects: next.waitingFor === null ? [{ type: "Finished" }] : [],
        };
    },
    project(state, actorId) {
        return {
            ownChoice: state.choices[actorId],
            availableActions: state.waitingFor === actorId ? ["Choose"] : [],
        };
    },
};

test("Actor の入力を順に処理し、最新状態からそれぞれの View を返す", () => {
    const simulator = new GameSimulator(definition);
    assert.deepEqual(simulator.getView("A").availableActions, ["Choose"]);
    const first = simulator.executeCommand(
        { type: "Choose", value: 7 }, { origin: "actor", actorId: "A" }
    );
    assert.equal(first.ok, true);
    assert.deepEqual(first.effects, []);
    assert.deepEqual(simulator.getView("A"), { ownChoice: 7, availableActions: [] });
    assert.deepEqual(simulator.getView("B"), { ownChoice: undefined, availableActions: ["Choose"] });
    const second = simulator.executeCommand(
        { type: "Choose", value: 9 }, { origin: "actor", actorId: "B" }
    );
    assert.equal(second.ok, true);
    assert.deepEqual(second.effects, [{ type: "Finished" }]);
    assert.deepEqual(simulator.getState(), { waitingFor: null, choices: { A: 7, B: 9 } });
});

test("拒否された操作では状態を進めず、その後も正しい入力を受け付ける", () => {
    const simulator = new GameSimulator(definition);
    const initial = structuredClone(simulator.getState());
    const result = simulator.executeCommand(
        { type: "Choose", value: 9 }, { origin: "actor", actorId: "B" }
    );
    assert.deepEqual(result, { ok: false, error: "not-allowed" });
    assert.deepEqual(simulator.getState(), initial);
    assert.equal(simulator.executeCommand(
        { type: "Choose", value: 7 }, { origin: "actor", actorId: "A" }
    ).ok, true);
    assert.equal(simulator.getState().waitingFor, "B");
});

test("system timeout も通常の遷移を使い、終了後の入力は状態を変えない", () => {
    const simulator = new GameSimulator(definition);
    assert.deepEqual(simulator.executeCommand(
        { type: "Timeout" }, { origin: "actor", actorId: "A" }
    ), { ok: false, error: "not-allowed" });
    simulator.executeCommand({ type: "Timeout" }, { origin: "system" });
    assert.equal(simulator.getState().waitingFor, "B");
    const result = simulator.executeCommand({ type: "Timeout" }, { origin: "system" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.effects, [{ type: "Finished" }]);
    const finished = { waitingFor: null, choices: { A: 0, B: 0 } };
    assert.deepEqual(simulator.getState(), finished);
    assert.deepEqual(simulator.executeCommand(
        { type: "Timeout" }, { origin: "system" }
    ), { ok: false, error: "finished" });
    assert.deepEqual(simulator.getState(), finished);
});

test("別の simulator は新しい初期状態から開始する", () => {
    const first = new GameSimulator(definition);
    first.executeCommand({ type: "Timeout" }, { origin: "system" });
    const second = new GameSimulator(definition);
    assert.deepEqual(second.getState(), { waitingFor: "A", choices: {} });
});
