# def-game
- a framework for creating online board games

--- 

このフレームワークは、オンラインボードゲームを作成する際の開発を支援する。
フレームワークは、開発者が定義するべき情報を明確に分類する。

このフレームワークを使って、ゲームルールを定義した共通モジュールを作成する。
その共通モジュールはサーバーサイドプロジェクトとクライアントサイドプロジェクトからimportすることを前提とする。
開発者は、サーバーサイド側のコードを修正する必要がない。
共通モジュールで定義したゲームロジックがそのまま動くようになっているからである。
また、サーバークライアント間での型共有が容易になるのも利点の一つである。

ここからは、このフレームワークが要求するデータ型や関数についての説明を行う。
`固有の用語`と`データ型`については、インラインコードブロックで示す。


# 設計 | design

## アウトライン
このフレームワークが要求する関数のすべては、`GameRule`に定義されている。
```ts
export interface GameRule<T extends Map, S extends Map, C extends ReqMap, L extends DefaultGameLogicState<S>, P extends GameParameters> {
    initialGameLogicState: (staticValues: any) => L;
    createRoom: (state: GameState<T, S, C, L, P>, param: GameParameters) => GameState<T, S, C, L, P>;
    onStartGame: (state: GameState<T, S, C, L, P>, joiner: Player) => GameState<T, S, C, L, P>;
    generateTasks(state: GameState<T, S, C, L, P>, event: ToServer<C>): Task<C, T>[];
    prioritizeTasks(newTasks: Task<C, T>[], gameState: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
    doTasks(state: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;
}
```

### initialGameLogicState
`initialGameLogicState: (staticValues: any) => L;`
`ゲームロジック状態`のデフォルトを作成する関数である。
これはプレイヤーが参加する前に仮に作成される`ゲーム状態`である。
引数の`staticValues`は、静的な設定値のオブジェクトである。これはプログラム上にハードコードされたものである。

ここで重要なのは、できる限り関数（計算）の中で`staticValues`から他の値を算出することである。
これは、ランダムマップの生成や、ゲーム内の計算で使用される値などを算出することを念頭においている。
逆に`initialGameLogicState`の中でのハードコードは避け、`staticValues`にすべてを集約することも大切である。

このようにして`ゲームロジック状態`のデフォルト`L`が作成される。これは`ルーム`が作成される前の段階である。

### createRoom
`createRoom: (state: GameState<T, S, C, L, P>, param: GameParameters) => GameState<T, S, C, L, P>;`
この関数は、`ルーム`が作成されるタイミングで実行される関数である。
開発者は、`GameParameters`を設定することができる。
これは`ルーム`を作成する段階で、入力可能な設定値のことである。画面から入力されることを想定している。

例えば、プレイヤーの人数や制限時間、ゲームに固有なパラメータなどなんでも`ゲームロジック状態`に設定できる。
そして、この関数は、`GameState`が持つ`GameParameters`を更新することを行う。
これは、プレイヤーの待ち合わせ処理などの`ゲームロジック状態`とは分離して処理を行う場合を想定しており、`GameParameters`はそこで使用される。

それに加えて、必要であれば、`ゲームロジック状態`に含まれる設定値などもこのタイミングで更新を行う。
それらを全ての更新を行なった`GameState<T, S, C, L, P>`を返す。

この段階で、`ルーム`に参加しているプレイヤーに対しては、UIを提供する必要があり、
UIに関する情報は、`ゲームロジック状態`の中に保持することを推奨している。

### onStartGame
`onStartGame: (state: GameState<T, S, C, L, P>, joiner: Player) => GameState<T, S, C, L, P>;`
これは、プレイヤーの参加ごとに呼び出される関数である。
プレイヤーの待ち合わせ処理を実装する。
参加したプレイヤーに対しては適切なUI情報を返す。
この関数が実行されている段階ですでにWebSocket接続が確立されている。


### generateTasks | prioritizeTasks | doTasks
この3つの関数は、ゲームの進行を定義するのに重要な関数となる。
サーバーサイドプロジェクトにデフォルトで実装されている処理フローは、`src/simulatir.ts`で確認することができる。
以下の部分である。
```ts
        // ------ Game Logic ------
        const tasks = this.rules.generateTasks(state, action);
        const updatedQueueState = this.rules.prioritizeTasks(tasks, state);
        const newState = this.rules.doTasks(updatedQueueState);
```

`タスク`というゲーム状態を更新する最小の単位となる概念を導入している。
`ゲーム状態`は`タスクキュー`をもつ。


1. `generateTasks(state: GameState<T, S, C, L, P>, event: ToServer<C>): Task<C, T>[];`

プレイヤーからの`イベント`を受け取った時に、実行されるのがこの関数である。
この関数では`ゲーム状態`を更新しない。新しく発生する`タスク`の配列を返す。

この関数では、`イベント`を受け取った際のバリデーションを実装することができる。

2. `prioritizeTasks(newTasks: Task<C, T>[], gameState: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;`

この関数では、`ゲーム状態`が持つ`タスクキュー`と`generateTasks`により生成された新しい`タスク`の配列をマージする処理を実装する。
`タスク`の優先度に応じて並び替える処理を実装できる。

3. `doTasks(state: GameState<T, S, C, L, P>): GameState<T, S, C, L, P>;`

この関数は、`タスクキュー`をループして、一つ一つのタスクを実行する処理を記述する。
ここで重要なのは、一つのタスクが`タスクリザルト`を返すことである。

`タスクリザルト`は、次のタスクを実行するのか、一旦停止して処理を終えるのかと言った情報を持つことができる。
この処理は、特にユーザー間のやり取りが発生する場合に有用である。

- ユーザーA: request
- タスク生成: (task1, task2, task3, task4)
- task1はユーザーBからの応答を要請する
  - タスクの実行を一時中断: (task2, task3, task4)
- ユーザーB: request
- タスク生成: (task1B)
  - 優先度による並び替え: (task1B, task2, task3, task4)
- タスクキューの実行再開

また、より堅牢なシステムを作るために、次に期待されるタスクを`ゲーム状態`に持たせることが可能である。
この例でいえば、"task1はユーザーBからの応答を要請する"際に、`タスクリザルト`は、タスクの実行を一時中断するだけでなく、次に期待されるタスクを"task1B"に設定する。
これにより、再開時に、"task1B"以外の実行をキャンセルする。


### privaten
`privaten(destinationId: PlayerId, l: L): L`

`privaten(destinationId, gameLogicState): GameLogicState`は情報秘匿のための関数である。
基本的には、`ゲームロジック状態`が更新されるたびに、`ゲームロジック状態`をシリアライズしたものをクライアント側に通知する。
クライアントから`ゲームロジック状態`の一部を隠さなければならない状況に対処するため、この関数を実装する。

これはサーバーサイドに実装されている`broadcast`関数であり、各プレイヤーごとに`privaten`を呼び出す。
```ts
async broadcast<T>(result: Game1State) {
    Object.keys(result.gameLogicState.forClient).forEach(async to => {
        await this.sendTo(to, JSON.stringify(gameRule.privaten(to, result.gameLogicState)));
    });
}
```


## 型による支援

規則的な命名と強い型付によって、型システムやAIによる補完の精度向上を狙っている。

`GameRule<T extends Map, S extends Map, C extends ReqMap, L extends DefaultGameLogicState<S>, P extends GameParameters>`
を見てもらえれば、分かる通りいくつかのRecord型(`Map`)定義を要請している。

### `T extends Map`
これは、`タスク`を定義するための`Map`である。

```ts
interface Tasks {
    "sample": SampleTask
    "update": UpdateTask
}
```
と言った具体である。
タスクハンドラーは、`ゲームロジック状態`とこのタスク（例えば`SampleTask`型のデータ）を受け取り、`ゲームロジック状態`を更新する処理を行う。

### `S extends ResMap`
これは、サーバーサイドから返却されるUI状態を定義するための`Map`である。

```ts
interface Res {
    "updated": Notify<UpdatedRes>
    "accept": Require<AcceptRes>
}
```

`ResMap`は、値の型として、`Notify`か`Require`のいずれかでラップすることを要請する。
これは、UI上で、ただの情報の通知を表すか、ユーザーに対してのなんらかのアクションの要求を表している。
`Require`は、アクションに関する制限時間を持っており、ユーザーに伝えることが可能である。

### `C extends ReqMap`
これは、クライアントサイドからイベントは発生させるためのリクエストを定義するための`Map`である。

```ts
interface Req {
    "propose": Custom<ProposeReq>
    "accept": Simple<AcceptReq>
}
```
`ReqMap`は、値の型として、`Custom`か`Simple`のいずれかでラップすることを要請する。
これはサーバーサイド側での実装を簡略化するために導入された型である。

なんらかの`Req`を受け取ってから`Task[]`に変換する処理はしばしば冗長である。
そこでリクエストペイロードをそのまま`タスク`として定義することができるようになっている。
この例では、`Simple<AcceptReq>`のように`Simple`によってラップされたペイロード(`AcceptReq`)は、そのままタスクとしてキューに追加される。

この仕組みは、以下の型定義により、型的にもサポートされている。
```ts
export type TaskMapType<A extends ReqMap, B extends Map> = Merge<SimpleOnlyPayload<A>, CustomTaskMap<B>>;
export type Task<A extends ReqMap, B extends Map> = {
    [K in keyof TaskMapType<A, B>]: {
        type: K;
        payload: TaskMapType<A, B>[K];
    }
}[keyof TaskMapType<A, B>];
```






## その他の設計

### ルームへの接続

- プラットフォームAPIにより認証されたユーザーは、ルームIDを指定して入室することができる。
- このタイミングでroomKeyと呼ばれるJWTを返す。
`{ playerId: playerId, roomId: body.roomId }`
- クライアントは、そのJWTをWebSocket接続時のパラメータに加える。
- これにより、接続とplayerIdが関連づけられる。
- WebSocket接続を通じて送られる全てのJSONデータはplayerIdプロパティを持っている。
- サーバーサイドは、そのplayerIdプロパティがWebSocket接続に紐づいたplayerIdと一致することを確認する。


### 時間制限

`ルーム`に接続中のクライアントは、webSocketハートビートを定期的に送信する。
これは、要求されたアクションの時間制限に関する確認処理をトリガーする。

`gameState.nextTaskExpectation`は以下のような情報を持っていて、
```js
{
    expectedTaskType: "accept",
    deadline: 1744589266,
    defaultTask: {
        playerId: "samplePlayer",
        proposerId: "proposer",
        isAccept: false,
    }
}
```
deadlineを過ぎていれば、`defaultTask`が`タスクキュー`の先頭に配置され、実行が再開するという具体である。





