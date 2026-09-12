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

Worker generator はこのリリースには含みません。Selfish の Worker 実装で共通部分を確認した後に追加する予定です。

## 開発と公開

```sh
npm ci
npm run typecheck
npm test
npm pack
```

開発時のテストには Node.js 20 以降を使用してください。npm test はビルドと Node 標準のシナリオテストを実行します。

npm pack / npm publish の前に prepack で型チェック・ビルド・テストが実行されます。build は dist を作り直すため、削除した旧 API の生成物が混入しません。公開対象は dist、package.json、README、LICENSE です。

main にレビュー済みの変更を反映した後、公開する version と認証アカウントを確認し、検証済みのパッケージを npm publish で公開します。
