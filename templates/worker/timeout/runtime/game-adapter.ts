import type { GameDefinition } from "def-game";

export type TimeoutEffect =
  | { readonly type: "schedule"; readonly decisionId: string; readonly deadline: number }
  | { readonly type: "cancel"; readonly decisionId: string };

/** Runtime never interprets State. The adapter translates game effects and timeout commands. */
export interface GameAdapter<State, Command, View, Error, Effect = never> {
  readonly game: GameDefinition<State, Command, string, View, Effect, Error>;
  readonly parseCreate: (input: unknown) => Command | null;
  readonly parseJoin: (input: unknown) => Command | null;
  readonly parseCommand: (input: unknown) => Command | null;
  readonly canConnect: (state: State, actorId: string) => boolean;
  readonly timeout?: {
    readonly effect: (effect: Effect) => TimeoutEffect;
    readonly command: (decisionId: string) => Command;
  };
}
