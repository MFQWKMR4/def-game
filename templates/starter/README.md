# DefGame Worker Starter

Commandでゲーム状態を変更し、Effectで外部処理につなぐ最小ゲームです。
生成後のコードはアプリ所有で、自由に編集できます。

## Getting Started

Node.js 22以降を使用します。

```sh
npm install
npm run dev
```

ローカルの開発版では、`npm install`の代わりに`npm install /absolute/path/to/def-game-6.1.0.tgz`を実行してください。
`http://127.0.0.1:8787`を開きます。別ブラウザープロファイルで共有URLを開くと、2人で試せます。

実装前に[設計思想](node_modules/def-game/docs/design-philosophy.md)を読み、詳細は[runtime API・初期生成の使い方](node_modules/def-game/docs/runtime-api.md)を参照してください。
