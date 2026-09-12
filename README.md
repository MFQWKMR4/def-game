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

Hono Worker、SQLite-backed Durable Object、waki.work JWT 認証、Hibernation WebSocket、保存・配信処理を生成します。GameDefinition の契約変更はありません。現在は timeout / Effect 実行なしの構成が対象です。

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
- `gameAdapter.game`: ゲーム自身の GameDefinition（Effect は `never`）。
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
