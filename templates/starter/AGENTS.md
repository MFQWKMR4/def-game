# このゲームを実装するAIエージェントへ

最初に `node_modules/def-game/docs/design-philosophy.md` と `node_modules/def-game/docs/runtime-api.md` を読むこと。
インストール前はDefGameリポジトリの同名ドキュメントを参照する。

- このディレクトリは初期生成後、アプリ所有。自由に編集する。生成コマンドで更新・上書きしない。
- ゲームの状態変更はCommandを通す。Game Definitionの`handleCommand`を純粋に保つ。
- runtimeの保存・WS・Alarmをアプリ側へコピーしない。`RoomDurableObject`はadapterを接続する薄いクラスに保つ。
- 認証・公開ルート・room ID解決・外部取得はアプリ側。本人確認とゲーム上の操作権限を分ける。
- 外部から取得したデッキ等はHTTP側で検証してActor Commandへ含める。WS parserから自己申告できないようにする。
- ゲームが要求する外部処理はEffect、結果を返す場合はSystem Command。外部Effectはbest-effort。
- 参加・所有者・設定変更のルールはゲーム固有。例の2人制やカード得点をライブラリの制約だと思わない。
- 認証の更新は再接続時にアプリ側で行う。接続中に定期的な認証確認を足さない。
- `scripts/dev-auth.mjs`はループバック専用の開発用認証サーバー。公開Workerからimportせず、デプロイへ含めない。
- 変更後は `npm run typecheck` と `npm run build` を実行し、Commandの検証と主要な接続動作を確認する。
