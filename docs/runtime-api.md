# GameAdapter・GameDefinitionとruntime API

[設計思想](design-philosophy.md)が実装の進め方を説明するのに対し、この文書は**あなたが実装する関数の型と契約**を説明します。
中心は、ゲームそのものを定義する`GameDefinition`と、それをCloudflare runtimeへ接続する`GameAdapter`です。

- [GameTypes：ゲーム固有の型](#gametypes)
- [GameAdapter：接続する関数の一覧](#gameadapter)
- [GameDefinition：初期状態・ルール・View](#gamedefinition)
- [adapterの各プロパティ](#adapter-properties)
- [呼び出し側のAPI・戻り値・エラー](#room-api)
- [WebSocketの通信形式](#websocket-protocol)
- [初期生成とローカル開発](#初期生成とローカル開発)

`GameDefinition`・`CommandContext`・`TransitionResult`は`def-game`から、
`GameAdapter`・`GameTypes`・`SessionRuntime`と接続用の型は`def-game/cloudflare`からimportします。
後者はCloudflare専用のES moduleです。

<a id="gametypes"></a>
## GameTypes：ゲーム固有の型をまとめる

`GameTypes`は、adapter全体で使う型を一か所にまとめるためのinterfaceです。
以下の`My…`はアプリで定義する型です。

```ts
import type { GameTypes } from 'def-game/cloudflare';

interface Types extends GameTypes {
  state: MyState;
  actorCommand: MyActorCommand;
  systemCommand: MySystemCommand;
  view: MyView;
  effect: MyEffect;
  error: MyError;
}
```

| プロパティ | 定義するもの | 使わない場合 |
| --- | --- | --- |
| `state` | 永続化するゲーム状態。参加者・手番・結果待ち等 | 必須 |
| `actorCommand` | 認証済みActorの操作。サーバー取得済み情報を含めてもよい | 操作がなければnever |
| `systemCommand` | Alarmや外部処理の結果等、サーバー起点の操作 | never |
| `view` | Actorに公開する情報とavailableActions | 必須 |
| `effect` | ゲームが宣言するruntime操作・外部処理の種類と引数 | never |
| `error` | ゲーム上の拒否理由。文字列unionやオブジェクト等 | 拒否がなければnever |

runtimeはStateの内部構造を解釈しません。`undefined`は未作成判定に使うためStateとして返せません。
Stateはstorageへ保存可能なデータにし、Viewとクライアントへ返すErrorはJSONで送れる形にしてください。
型に`readonly`を付けても自動で深く凍結されるわけではありません。入力を変更しない契約は実装側で守ります。

<a id="gameadapter"></a>
## GameAdapter：ゲームとアプリを接続する契約

`Env`はWorkerのbinding・環境変数の型、`T`は上記のゲーム固有型です。
`T["state"]`は、例えば`Types`に定義した`state`の型を取り出すTypeScriptの記法です。

```ts
export interface GameAdapter<Env, T extends GameTypes> {
  readonly game: GameDefinition<T["state"], T["actorCommand"] | T["systemCommand"], string,
    T["view"], T["effect"], T["error"]>;
  readonly webSocket: {
    /** クライアントが指定してよい入力だけCommandにする。手番等の検証はゲームに残す。 */
    readonly parseCommand: (input: unknown) => T["actorCommand"] | null;
  };
  readonly canConnect: (state: T["state"], actorId: string) => boolean;
  readonly runtime?: {
    readonly effect: (effect: T["effect"]) => RuntimeEffect | null;
    readonly scheduler?: {
      readonly command: (id: string) => T["systemCommand"];
    };
  };
  /** 保存後のbest-effort処理。結果はruntimeがSystem Commandとして再度dispatchする。 */
  readonly executeEffect?: (effect: T["effect"], context: { readonly env: Env; readonly roomId: string })
    => Promise<void | { readonly command: T["systemCommand"] }>;
  /** 同期の診断フック。例外はruntimeが隔離する。配送・再試行の仕組みではない。 */
  readonly onError?: (failure: RuntimeFailure) => void;
}
```

| 項目 | 目的 | 必須か |
| --- | --- | --- |
| `game` | 純粋な初期状態生成・ルール・View生成を提供 | 必須 |
| `webSocket.parseCommand` | クライアントが指定してよい入力をCommandへ変換 | 必須 |
| `canConnect` | Actorの接続とView配信を許可するか判断 | 必須 |
| `runtime` | Effectをruntime固有のschedule・cancel・delete-sessionへ変換 | runtime操作を使う場合 |
| `executeEffect` | Alarm以外のEffectを実行し、必要なら結果を返す | 外部Effectを出す場合 |
| `onError` | runtimeの診断情報を受け取る | 任意 |

接続先のDOクラスでは、adapterをプロパティとして渡します。
`game`等の関数はruntimeから呼ばれます。保存・WS配信の共通手順を各関数へ再実装する必要はありません。

```ts
export class RoomDurableObject extends SessionRuntime<Env, Types> {
  protected readonly adapter = adapter;
}
```

<a id="gamedefinition"></a>
## GameDefinition：adapter.gameに実装するもの

```ts
export interface GameDefinition<State, Command, ActorId, View, Effect, Error> {
    /** Session や接続の情報に依存しない、ゲームの初期状態を生成する。 */
    createInitialState(): State;

    /**
     * 実行元とコマンドを再検証し、次の外部入力を待てる安定状態まで遷移する。
     * 入力 state を変更せず、拒否時は error のみを返す。外部 I/O は行わない。
     * system 起点でも、そのコマンドが現在の状態で有効かを検証する。
     */
    handleCommand(
        state: State,
        command: Command,
        context: CommandContext<ActorId>
    ): TransitionResult<State, Effect, Error>;

    /**
     * state を変更せず、Actor に公開できる情報と availableActions を持つ View を生成する。
     * availableActions は表示補助であり、コマンド実行時の検証を省略する根拠にはしない。
     */
    project(state: State, actorId: ActorId): View;
}
```

coreの`GameDefinition`はActor IDの型も選べます。Cloudflareの`GameAdapter`へ接続する場合は`string`です。
`Command`には`T["actorCommand"] | T["systemCommand"]`を渡します。ActorとSystemの処理を別の状態更新経路に分けません。
3つの関数はすべて**同期・純粋な関数**です。Promiseを返さず、fetch・storage・WS送信は行いません。

### createInitialState(): State

**目的:** 新しく作った空のルームに保存する土台を返します。

参加前の状態、未開始のフェーズ、空の結果等を定義します。Actor・Env・外部設定は引数に渡されません。
参加者や所有者を必須にせず、Joinや設定変更は後続Commandで扱ってください。
既存ルームの二重作成はruntimeが拒否するため、この関数でstorageの存在確認はしません。
例外や`undefined`を返す初期化は作成失敗になります。

### handleCommand(state, command, context): TransitionResult

**目的:** 現在の状態で入力を受け入れてよいか判断し、次の入力を待てる状態まで進めます。

| 引数 | 内容 | 書く処理 |
| --- | --- | --- |
| `state` | runtimeが取得した現在の保存状態 | 手番・参加資格・結果待ち等を調べる。直接変更しない |
| `command` | ActorまたはSystemのゲーム入力 | 操作の種類・値・対象IDを検証する |
| `context` | 実行側が確定した操作の起点 | Actorの認可、System専用操作の判定に使う |

```ts
export type CommandContext<ActorId> =
  | { readonly origin: 'actor'; readonly actorId: ActorId }
  | { readonly origin: 'system' };

export type TransitionResult<State, Effect, Error> =
  | {
      readonly ok: true;
      readonly state: State;
      readonly effects: readonly Effect[];
    }
  | { readonly ok: false; readonly error: Error };
```

成功時は、新しいStateとEffect配列を返します。Effectがなくても`effects: []`を返します。
拒否時は`{ ok: false, error }`だけを返し、runtimeは状態保存・View配信・Effect実行を行いません。
予定されたゲーム上の拒否に例外を使わず、このError型で表現してください。

認証済みでも「今その操作をしてよい」とは限りません。System入力も古い結果や期限を対象にしていないか検証します。
時刻や乱数が必要なら実行側で入力に載せ、関数内で取得しないようにします。
成功結果の保存はruntimeの責務です。関数が返しただけでは保存の成功は保証されません。

### project(state, actorId): View

**目的:** 現在状態から、そのActorへ公開してよい情報を作ります。

自分の手札・公開得点・選択可能な操作等を返します。全Stateをそのまま返さず、非公開情報を除いてください。
`availableActions`はViewに含める設計上の契約ですが、型の制約で自動的に必須化されてはいません。
その表示は認可の代わりにならないため、Command実行時にも検証します。

runtimeはHTTP等からの`getView`、接続時、Command保存後の配信で呼びます。同じActorの複数接続などで何度呼ばれてもStateを変更してはいけません。
配信中に例外が出ても保存済みCommandは取り消しません。該当接続は閉じられ、診断対象になります。

<a id="adapter-properties"></a>
## adapterの各プロパティに何を書くか

### webSocket.parseCommand

```ts
(input: unknown) => T['actorCommand'] | null
```

**目的:** WSのゲーム固有入力を検証し、クライアントに許可したCommandだけを作ります。
共通envelope内の`command`が渡されます。envelope自体の検証はruntimeが担当します。

型や必須フィールドを調べ、許可した値だけを新しいオブジェクトへコピーしてください。
時刻等を信頼できる実行側で追加する場所にもなります。外部取得は同期parser内では行わず、アプリのHTTP処理等で行います。

```ts
parseCommand(input) {
  if (typeof input !== 'object' || input === null) return null;
  if (!('type' in input) || input.type !== 'play') return null;
  if (!('cardId' in input) || typeof input.cardId !== 'string') return null;
  if (!('decisionId' in input) || typeof input.decisionId !== 'string') return null;
  return {
    type: 'play', cardId: input.cardId,
    decisionId: input.decisionId, now: Date.now(),
  };
}
```

この例ではカード能力値やActor IDはクライアントから受け取りません。
手番等のStateに依存するゲームルールは`game.handleCommand`に置きます。
`null`を返す、または例外を投げると`ProtocolErrorEvent`で拒否します。
HTTPから`dispatchActor`へ渡したCommandには、このWS parserは適用されません。HTTP入力の検証はアプリで行ってください。

### canConnect

```ts
(state: T['state'], actorId: string) => boolean
```

**目的:** このActorにWS接続とView配信を許可するか判断します。
例えば`state.players.some(player => player.actorId === actorId)`を返します。観戦者を許すなら、その条件もアプリが定義します。
同期で判定し、状態変更や外部I/Oはしません。

接続開始時、WS Command実行前、View配信時に呼ばれます。
falseなら接続開始は403、WS Commandは`NotRoomMember`として拒否し、配信対象なら接続を閉じます。
HTTP／SystemのCommand認可には使われないため、`handleCommand`の検証は必須です。

### runtime.effect / runtime.scheduler.command

```ts
runtime?: {
  effect: (effect: T['effect']) => RuntimeEffect | null;
  scheduler?: {
    command: (id: string) => T['systemCommand'];
  };
};

type RuntimeEffect =
  | { readonly type: 'schedule'; readonly id: string; readonly deadline: number }
  | { readonly type: 'cancel'; readonly id: string }
  | { readonly type: 'delete-session' };
```

**目的:** ゲームが返すEffectを、`SessionRuntime`自身が実行するインフラ操作へ変換します。
`runtime.effect`は成功した遷移の各Effectに対して呼ばれます。runtime操作なら上記の形に変換し、
外部・アプリ固有のEffectなら`null`を返します。変換したEffectは`executeEffect`へは渡されません。

| 戻り値 | runtimeの動作 |
| --- | --- |
| schedule | 同じidの予約を追加または置き換え、最も早い期限を物理Alarmへ設定 |
| cancel | 同じidの予約を削除し、残る最も早い期限へ物理Alarmを再設定 |
| delete-session | ゲームState・予定イベント・Alarmを含むDO storageを削除 |
| null | 保存後に外部Effect handlerへ渡す |

1ルームに複数の論理予約を保持できます。`id`は空でない文字列、`deadline`は有限のUnix時刻ミリ秒を指定します。
予約はゲームStateとは別の`scheduled-events`へ永続化されます。Cloudflareの物理Alarmは1つだけで、常に最も早い論理予約の期限を指します。
予約がなくなれば物理Alarmも削除されます。複数のschedule・cancelは配列順に適用します。

`runtime.scheduler.command`は期限に達した論理予約の`id`からSystem Commandを作ります。
必要なら`now: Date.now()`等を追加してください。これは予定イベントにだけ必要な逆方向の変換です。
runtimeはイベント名の意味を解釈しません。decision timeout、inactivity、reconnect grace period等の名前と処理はアプリが決めます。
decision timeoutもschedulerの通常の利用例であり、runtime固有の特別な予約ではありません。

Alarm発火時は、期限に達した最も早い予約を1件だけCommandへ変換し、通常のdispatcherで処理します。
成功後に予約を読み直し、別の予約も期限に達していれば最新Stateに対して次のCommandを処理します。
これにより、先のCommandが後続予約を取り消した場合、その予約は古いStateから作ったCommandとして実行されません。
早すぎる発火は最も早い期限へ再設定し、ゲームによる拒否・保存失敗では予約を消費せず例外を返します。
Alarmの予約と、将来の発火・再試行は別の実行です。一度だけ届く前提にしないでください。

`delete-session`はschedulerとは別のruntime lifecycle操作です。予定イベントをきっかけに削除する場合も、
まずSystem Commandとしてゲームが最新Stateで削除の妥当性を判断し、その結果のEffectを`runtime.effect`で変換します。
イベントID自体へ削除の意味を持たせたり、ゲームからDurable Object Storageを直接操作したりしません。

削除が同じ遷移のruntime Effectに含まれる場合、削除がschedule・cancelより優先されます。
runtimeは返された次Stateを保存・配信せず、`storage.deleteAll()`を完了してCommandを成功として返します。
同じ遷移の外部Effectは通常どおり`executeEffect`へ渡されますが、そのfeedback Commandが戻る時点ではRoomNotFoundになります。
接続中のWebSocketでは削除Commandの応答を送ってから全接続を正常終了し、その後のView取得・Command・接続はRoomNotFoundになります。
明示的に`create()`を再度呼べば、同じDO IDへ新しいセッションを作ることはできます。

Cloudflareではcompatibility date `2026-02-24`以降、`deleteAll()`が保存データと物理Alarmをまとめて削除します。
生成されるWorkerはこれより新しいdateを使います。古いcompatibility dateのアプリは
`delete_all_deletes_alarm`を有効にするか、dateを更新してから`delete-session`を利用してください。

### executeEffect

```ts
(effect: T['effect'], context: { readonly env: Env; readonly roomId: string })
  => Promise<void | { readonly command: T['systemCommand'] }>
```

**目的:** 保存後、ゲームが依頼した外部処理をアプリとして実行します。
`env`はWorkerのbinding・環境変数、`roomId`はDO IDの文字列であり、アプリの公開ルームIDとは限りません。

```ts
async executeEffect(effect, { env, roomId }) {
  const result = await callExternalService(env, roomId, effect);
  return { command: makeSystemCommand(result) };
}
```

結果を戻さなければ何も返さず完了します。戻す場合は**Commandそのものではなく`{ command }`**を返します。
runtimeがSystem起点でdispatchするので、handler自身による再dispatchは不要です。
ゲームのstorageを直接変更せず、結果の有効性は`handleCommand`で判断します。

外部処理中も別Commandは実行できます。同じ遷移のEffectは順に処理しますが、他のCommandが出すEffectとの全体順序は保証しません。
例外は診断対象となり、元の保存済み成功を取り消さず、残りのEffectを処理します。handler未設定も配送失敗になります。
配送はbest effortで、永続キュー・自動再試行・exactly-onceはありません。保存後の停止で依頼や結果が失われる場合の復旧はアプリで設計します。

### onError

```ts
(failure: RuntimeFailure) => void

interface RuntimeFailure {
  readonly roomId: string;
  readonly phase: 'create' | 'command' | 'effect' | 'effect-feedback' | 'view' | 'connection';
}
```

**目的:** runtime内部で失敗した区間を同期的に観測します。ログ等の診断処理を書きます。

| phase | 主な対象 |
| --- | --- |
| create | 初期状態生成・作成保存の例外 |
| command | Command適用・Alarm変換・保存等の例外 |
| effect | 外部Effect handlerの例外・未設定 |
| effect-feedback | 結果System Commandの拒否・実行失敗 |
| view | View生成・送信・接続列挙の失敗 |
| connection | WS接続処理の例外 |

通常のゲーム上の拒否すべてを通知するフックではありません。
State・Command・Effect・元の例外本文は引数に含めません。未設定ならメタデータだけをconsoleへ記録します。
フック内の例外もruntimeが隔離します。Promiseは待機されず、復旧・配送の仕組みではありません。

<a id="room-api"></a>
## 呼び出し側のAPI・戻り値・エラー

アプリの利用例は生成された`src/index.ts`を参照してください。以下は共通契約です。

```ts
interface VerifiedActor { readonly actorId: string }

// getRoom(namespace, durableObjectId)が返す参照
interface RoomClient<ActorCommand, Error, View = unknown> {
  create(): Promise<CreateRoomResult>;
  getView(actor: VerifiedActor): Promise<GetViewResult<View>>;
  dispatchActor(actor: VerifiedActor, command: ActorCommand): Promise<CommandResult<Error>>;
  connect(actor: VerifiedActor): Promise<Response>;
}
// getSystemRoom(namespace, durableObjectId)が返す参照
// { dispatchSystem(command: SystemCommand): Promise<CommandResult<Error>> }
```

### getView(actor)：接続せずにViewを取得する

```ts
const room = getRoom(env.ROOMS, id);
const result = await room.getView(verifiedActor);
// 公開HTTPのレスポンスやステータスはアプリで決める
```

```ts
type GetViewResult<View> =
  | { readonly ok: true; readonly view: View }
  | { readonly ok: false; readonly error: RuntimeError };
```

runtimeが保存済みStateを読み、既存の`game.project(state, actor.actorId)`を呼んで返します。
ゲーム側に新しい関数の実装は必要ありません。View型はDOのadapterから推論されます。
状態変更・Command実行・Effect・WS接続・他の接続への配信は行いません。

`canConnect`は呼びません。認証済みの未参加者にも、projectが部屋の概要等を返せます。
参加者・観戦者・未参加者で何を見せるかはprojectで判断し、非公開Stateを返さないでください。
未認証の公開閲覧を提供するAPIではなく、アプリは呼び出し前にActorを認証します。

未作成はRoomNotFound、不正ActorはInvalidRequest、読み取り・projectの例外はInternalErrorです。
内部例外はonErrorのview区間へ通知し、保存済み状態を変更しません。
返るのは読み取り時点のViewであり、その後の操作が同じ状態で受理される保証はありません。

### 作成・操作・接続

`create()`は初期状態のみを保存し、二重作成を拒否します。JoinはゲームCommandです。
`connect()`成功時は101のWS応答を返します。未作成404、接続資格なし403、内部例外500等になります。
Actorが不正な場合は呼び出し側で例外になることもあります。

```ts
type CommandResult<Error> =
  | { readonly ok: true }
  | { readonly ok: false; readonly error:
      RuntimeError | { readonly kind: 'game'; readonly detail: Error } };

type CreateRoomResult =
  | { readonly ok: true; readonly roomId: string }
  | { readonly ok: false; readonly error: RuntimeError };

// RuntimeErrorは下表のcodeを持つ
// { readonly kind: 'runtime'; readonly code: ... }
```

| runtime code | 意味 |
| --- | --- |
| RoomNotFound | 初期状態が保存されていない |
| RoomAlreadyExists | 既存ルームを再作成しようとした |
| InvalidRequest | Actor情報・WS入力等が不正 |
| NotRoomMember | WS操作の接続資格を満たさない |
| InternalError | 初期化・Command処理・保存等の内部失敗 |

`TransitionResult`はゲームがruntimeへ返す次状態・Effect、`CommandResult`はruntimeが呼び出し元へ返す成否です。
後者の成功は保存完了を表し、StateやEffectを返しません。View受信や外部Effect完了も保証しません。
DO RPCの通信失敗は例外として伝わる場合があります。公開HTTPのレスポンス形式はアプリが決めます。

作成結果のroomIdはDO IDの文字列です。公開IDをidFromNameで解決するアプリは、公開IDを別に管理します。
`VerifiedActor`の型や`getSystemRoom`自体に認証能力はありません。namespace bindingを持つアプリを信頼する契約です。
通常参照はSystem入口を隠しますが、生のDO stubにはSystem RPCがあります。
外部のactorId・originをそのまま渡したり、汎用RPC転送を公開したりしないでください。
WS接続には`connect`を使い、外部RequestをDOの内部fetchへそのまま転送しません。

<a id="websocket-protocol"></a>
## WebSocketの通信形式

```ts
interface GameCommandRequest<Command> {
  readonly type: 'GameCommandRequest';
  readonly requestId: string;
  readonly command: Command;
}
type GameCommandResponse<Error> = CommandResult<Error> & {
  readonly type: 'GameCommandResponse'; readonly requestId: string;
};
interface ViewStateEvent<View> {
  readonly type: 'ViewStateEvent'; readonly viewState: View;
}
interface ProtocolErrorEvent {
  readonly type: 'ProtocolErrorEvent'; readonly error: RuntimeError;
}
type ServerMessage<View, Error> =
  GameCommandResponse<Error> | ViewStateEvent<View> | ProtocolErrorEvent;
```

入力はJSONのテキストフレーム、UTF-8で64KiBまで、requestIdは1〜128文字です。バイナリは拒否します。
`command`はparserへ渡すクライアント入力です。サーバーで追加する値までクライアントが指定できるという意味ではありません。
Actorとoriginは接続の情報からruntimeが決めます。

```json
{ "type": "GameCommandRequest", "requestId": "r1", "command": { "type": "start" } }
```

```json
{ "type": "GameCommandResponse", "requestId": "r1", "ok": false, "error": { "kind": "game", "detail": "not-ready" } }
```

```json
{ "type": "ViewStateEvent", "viewState": { "availableActions": [] } }
```

```json
{ "type": "ProtocolErrorEvent", "error": { "kind": "runtime", "code": "InvalidRequest" } }
```

ProtocolErrorEventにはrequestIdがありません。ViewとCommand応答の到着順には依存しないでください。
requestIdは応答の対応付け用で、永続的な重複排除には使いません。再送時の扱いはゲームで定義します。
同一Actorの複数接続を許可し、HTTP経由の更新も接続中WSへ配信します。
再接続時は最新Viewを送り、切断中のイベント再生は提供しません。
認証は接続時のみです。トークン更新はアプリ側で行い、接続中の自動再検証・失効連動の切断は行いません。

---

## 初期生成とローカル開発

生成物はすべてアプリ所有です。ライブラリ更新時に再生成せず、アプリのコードとして変更します。

### 始め方

Node.js 22以降を使用します。`6.2.0`を指定して生成します。

```sh
npx def-game@6.2.0 init-worker --directory my-game --name my-game
cd my-game
npm install
npm run dev
```

開発版をこのリポジトリから試す場合は、リポジトリで`npm pack`を実行します。
`node bin/def-game.cjs init-worker --directory /path/to/my-game --name my-game`で生成し、生成先で
`npm install /absolute/path/to/def-game-6.2.0.tgz`を実行してください。
その後は`npm run typecheck`、`npm run build`、`npm run dev`を利用できます。buildはWranglerのdry-runで、公開しません。

生成先は新しいディレクトリに限定します。既存ディレクトリは空でも拒否します。
Worker名は先頭が英小文字または数字、全体が英小文字・数字・ハイフンの1〜63文字です。
名前は`package.json`と`wrangler.jsonc`に構造的に反映し、Def Game依存バージョンは生成に使ったCLIに揃えます。
ソースコード内の置換変数はありません。認証先、binding、ゲーム名の表示などは生成後に編集します。

### 動く最小例

2人が部屋に参加し、サーバーのカタログからデッキを選び、各自1枚プレイして終了します。
手番には30秒の期限があり、AlarmもSystem Commandとして通常と同じゲームルールを通ります。

- HTTP: 認証、空の部屋作成、Join Command、外部取得済みデッキを含むCommand。
- WebSocket: start/playだけをparserで許可。時刻はサーバーが追加します。
- View: 自分のカードだけを配信。再接続時は最新Viewを受け取ります。
- Effect: Alarm予約・取消と、終了時の外部処理例を分けます。

デッキ取得はサーバー側の固定データです。実際の外部サービスへ接続するときは、この取得処理を置き換えます。
所有権チェックやデータ取得は`src/external/decks.ts`、状態遷移は`src/game/definition.ts`に実装します。
Worker・認証・公開ルームID解決は`src/index.ts`等、ライブラリへの接続は`src/game-adapter.ts`と`src/room.ts`です。

### ローカル認証と公開設定

`npm run dev`は127.0.0.1の8787番でWorker、8790番で開発専用認証サーバーを起動します。
ブラウザーで`http://127.0.0.1:8787`を開きます。別ブラウザープロファイルで2人として試せます。
開発認証は署名済みJWTを発行し、Workerは本番と同じ検証を通ります。認証の省略は行いません。
開発認証のActorは自己発行で、本人確認用途には使えません。認証サーバーはWorkerからimportせず、デプロイ成果物に含めません。
ローカル認証先はdevコマンドだけで上書きし、Wranglerの公開設定を書き換えません。

初期設定の公開認証先は`auth.waki.work`です。共有Cookieが届くHTTPSの`*.waki.work`で利用する想定です。
`workers.dev`や別ドメインでは、認証先とCookieの設計をアプリに合わせて変更してください。
静的な画面は公開し、状態を扱うHTTPとWS入口で認証します。

