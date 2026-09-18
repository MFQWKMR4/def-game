# def-game

ゲームの状態遷移をCommandに集約し、外部処理をEffectで接続するTypeScriptライブラリです。
共通runtimeが部屋の保存・WebSocket・Alarmを扱い、ゲームルールと認証・外部サービスとの接続はアプリ側で定義します。

## Getting Started

Node.js 22以降が必要です。v6.3.0の利用手順です。

```sh
npx def-game@6.3.0 init-worker --directory my-game --name my-game
cd my-game
npm install
npm run dev
```

`http://127.0.0.1:8787`を開いてください。
実装前に[設計思想](docs/design-philosophy.md)を読み、接続方法は[runtime API・初期生成の使い方](docs/runtime-api.md)を参照してください。
