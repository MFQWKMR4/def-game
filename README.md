# def-game V5

ターン制ゲームのルールを通信・永続化から独立させる、TypeScript の最小 contract とメモリ上の simulator です。

```sh
npm install def-game@^5
```

## 公開 API

- `GameDefinition`: 初期状態の生成、コマンドによる状態遷移、Actor 別の projection。
- `TransitionResult`: 成功時の次状態と Effect、または失敗理由。
- `CommandContext`: Actor と system の実行元の区別。
- `GameSimulator`: 同じゲーム定義へコマンドを順に流し、状態・View・Effect を検証する実行器。

型の詳細と契約は [game-definition.ts](src/game-definition.ts)、実行器は [game-simulator.ts](src/game-simulator.ts) を参照してください。
[シナリオテスト](test/game-simulator.test.cjs) に、2人の入力待ちと system timeout を扱う実行例があります。

## 責務

各ゲームは GameState と Command を定義し、1コマンドで次の外部入力を待てる安定状態まで遷移させます。入力状態は変更せず、失敗時はエラーだけを返します。現在の入力待ちはゲーム自身の状態として表現します。

接続、認証、永続化、時刻の取得、Alarm、外部 I/O は実行側の責務です。実行側が検証済みの Actor または system を context に指定します。リクエストに書かれた実行元をそのまま信用してはいけません。ゲーム側でも実行元と現在の状態に対してコマンドを検証します。

Effect は副作用の宣言です。本番の実行側は次状態を保存してから Effect を実行します。simulator は Effect を実行せず、遷移結果に含めて返します。

projection は秘密情報を除いた Actor 別の View と availableActions を生成します。availableActions は表示補助であり、コマンド実行時の検証を置き換えません。

simulator の getState は検証用の全状態への参照です。呼び出し側も状態を直接変更しないでください。deep clone、freeze、失敗時の rollback は行いません。クライアントへ公開する情報には getView を使用します。

## V4 からの移行

V5 は破壊的変更です。GameRule、GameEngine、TaskQueue に関する型、旧通信型と helper は削除しています。V4 を利用する既存ゲームは移植が完了するまで V4 を使用してください。

- 旧ライフサイクルを GameDefinition の初期化・コマンド処理・projection に移します。
- task queue に未来の処理を保存する代わりに、ゲーム固有の状態で現在の入力待ちを表現します。
- 参加・開始などもゲームの Command として扱います。
- 旧 GameEngine の代わりに GameSimulator でコマンド列を実行します。

## Worker generator（5.0.1）

Hono Worker、SQLite-backed Durable Object、waki.work JWT 認証、Hibernation WebSocket、保存・配信処理を生成します。GameDefinition の契約変更はありません。timeout は任意の生成オプションです。外部 Effect の実行は任意の adapter フックで接続します。

server package に `def-game.worker.json` を作ります。全パスはこの設定ファイルのディレクトリ基準です。

```json
{
  "outputDir": "src/worker",
  "adapter": "src/worker/game-adapter.ts",
  "entry": "src/index.ts",
  "wranglerConfig": "wrangler.jsonc",
  "name": "my-game",
  "assets": "../client/public",
  "compatibilityDate": "2026-09-12"
}
```

```sh
npm install --save-dev def-game@5.0.1 wrangler @cloudflare/workers-types
npm install hono jose
npx def-game generate-worker --config def-game.worker.json
npx def-game generate-worker --config def-game.worker.json --check
```

生成対象は `outputDir` 内の `index.ts`、`session.ts`、`auth.ts`、`env.ts`、`runtime/parse.ts`、`runtime/game-adapter.ts` と、`entry`、`wranglerConfig` の計8ファイルです。Hono / jose は利用側の runtime dependency で、generator 自体に実行時依存はありません。

生成コードは Node.js 24.20.0、TypeScript 5.6.3、Hono 4.13.7、jose 6.2.12、Wrangler 4.131.1、`@cloudflare/workers-types` 5.20260911.1 の環境で、ビルド・型チェック・HTTP / WebSocket / Durable Object の通信テストを確認しています。

ゲーム側は既存ファイルとして `adapter` を用意し、次を export します。このファイル、domain、shared は生成・上書きしません。

- `gameAdapter`: 生成される `GameAdapter<State, Command, View, Error>` に適合するオブジェクト。
- `gameAdapter.game`: ゲーム自身の GameDefinition（Effect の省略時は `never`）。
- `parseCreate(input)` / `parseJoin(input)` / `parseCommand(input)`: 未検証入力から command を返す関数。形式不正なら null。WS の関数へ渡るのは envelope 内の command だけです。
- `canConnect(state, actorId)`: 接続・配信を許可するかの判定。command の認可は GameDefinition が再検証します。
- 型の export: `State`、`ActorId`（string）、`ServerMessage`、`ProtocolError`、`PublicError`、`CreateSessionResponse`、`JoinSessionResponse`。

公開通信は `GameCommandRequest { requestId, command }`、`GameCommandResponse { requestId, ok, error? }`、`ViewStateEvent { viewState }`、`ProtocolErrorEvent { error }` の type で区別します。HTTP 応答は `CreateSessionResponse` / `JoinSessionResponse` の type と、成功時 `ok: true, sessionId`、失敗時 `ok: false, error` を持ちます。ProtocolError の code は `AuthenticationRequired` / `SessionNotFound` / `NotSessionMember` / `InvalidRequest` / `InternalError`。PublicError はそれとゲームエラーの union です。

認証は Cookie `__token` を JWKS / ES256 / issuer / audience / exp で検証し、UUID の sub を ActorId として使います。Static Assets も認証必須。ログイン誘導・refresh は client の責務です。

出力が同一なら変更しません。既存ファイルと差分がある場合は書き込み前に停止します。確認後に `--force` を付けると生成対象8ファイルだけを更新します。`--check` は欠落・差分を非ゼロ終了で報告し、ファイルを変更しません。生成ファイルは Git 管理し、修正は generator / 設定側へ戻してください。Wrangler 設定も全体が生成対象なので、独自 bindings や migrations の追加には generator の対応が必要です。

CLI は dependencies、package scripts、tsconfig を書き換えません。利用側で Worker の型と Hono / jose を設定し、生成された entry を Wrangler から実行します。CLI には Node.js 20 以降が必要です。

## 開発と公開

```sh
npm ci
npm run typecheck
npm test
npm pack
```

開発時のテストには Node.js 20 以降を使用してください。npm test はビルドと Node 標準のシナリオテストを実行します。

npm pack / npm publish の前に prepack で型チェック・ビルド・テストが実行されます。build は dist を作り直すため、削除した旧 API の生成物が混入しません。公開対象は dist、bin、templates、package.json、README、LICENSE です。

main にレビュー済みの変更を反映した後、公開する version と認証アカウントを確認し、検証済みのパッケージを npm publish で公開します。


## Decision timeout（5.1.0-timeout.0 開発版）

生成設定に `"timeout": true` を追加すると、DO Alarm と system command 配送を生成します。未指定または false なら Alarm を生成しません。

`GameAdapter<State, Command, View, Error, Effect>` に次の任意の接続点を設定します。

```ts
timeout: {
  effect: (effect) => /* { type: "schedule", decisionId: string, deadline: number }
                        または { type: "cancel", decisionId: string } */,
  command: (decisionId) => /* ゲーム固有の system command */,
}
```

ゲームは新しい decision で再利用しない ID と期限を発行します。同じ decision 内の部分完了では Effect を出しません。default action・pending actors・bot policy はゲーム側に残します。runtime は State を解釈せず、1つの現在予約を保存します。独立した複数の同時 decision のスケジューラーではありません。

状態・予約・Alarm は同じ storage transaction で確定します。Alarm は保存済み予約から system command を生成し、古い発火が新しい予約を期限前に処理しないよう再予約します。domain も ID・期限を検証してください。期限を迎えた予約は成功した遷移と同じ transaction で消費し、次の予約があれば置き換えます。失敗は例外として伝播し Cloudflare の有限回の再試行に委ねます。Alarm の無制限の再試行は含みません。外部 Effect は下記の保存後フックで扱います。

timeout.effect は予約・解除を返し、外部 Effect に対しては null を返します。外部通知と異なり、Alarm は状態と原子的に保存するローカルな永続化処理です。外部サービス呼び出しは transaction 内に追加しないでください。

実行環境の検証: Node.js 24、TypeScript 5.6、Hono 4.13、jose 6.2、Wrangler 4.131、Cloudflare Vitest plugin 1.1。標準構成・任意構成の生成一致を generator テストで確認しています。

## 保存後の外部 Effect（5.1.0-effects.0）

通常構成・timeout 構成の両方で `GameAdapter<State, Command, View, Error, Effect>` に
`executeEffect(effect, { sessionId, env }): Promise<void>` を指定できます。`env` の追加 binding は
ゲーム側で検証して使用します。runtime は State・通知先・通知内容を解釈しません。

作成・参加・WebSocket command・Alarm の成功を永続化し、View を配信した後に
`ctx.waitUntil` で実行します。timeout が処理した予約・解除はフックに渡しません。
各 Effect の失敗は他の Effect や保存済み結果に影響せず、command を失敗へ戻しません。
フック未設定の外部 Effect は配送エラーとして記録します。

これは best-effort 配送です。永続 outbox・自動再試行・exactly-once は提供しません。
保存と外部通知の間のプロセス停止では通知が失われ得ます。ゲーム側で安全な失敗記録と
手動再送方法を用意し、受信側は sessionId 等の安定したキーで重複を排除してください。
API key や非公開の GameState をログへ含めないでください。

検証: `npm test` は配布テンプレートを実行し、保存前の失敗、保存後の配送失敗、
後続 Effect の継続、通常 command と Alarm の経路を確認します。
