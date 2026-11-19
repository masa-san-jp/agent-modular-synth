# 第三者ライブラリとライセンス

採用時に確認して記録する(REQ-NF-008、DEC-109)。調査対象(#1)のコード・アセット・外観・商標は再利用していない。

| 名称 | 版(確認時) | ライセンス | 用途 | 配布物に含まれるか | 確認日 |
|---|---|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | ビルド・型検査(開発時のみ) | 含まれない | 2026-11-15 |
| @types/node | 22.20.5 | MIT | Node.js の型定義(開発時のみ) | 含まれない | 2026-11-15 |
| esbuild | 0.25.12 | MIT | ブラウザ用の単一ファイル出力(AudioWorklet と画面のスクリプトをまとめる。開発時のみ) | 含まれない(出力されるのは自作コードだけ) | 2026-11-15 |
| ws | 8.23.0 | MIT | ローカルサーバーの WebSocket(タブとの中継 `/tab`、エージェント用API `/api/ws`)。試験ではクライアントとしても使う。**実行時の依存** | 含まれる(サーバー側。依存する他のパッケージはない。任意の追加モジュール bufferutil・utf-8-validate は入れていない) | 2026-11-19 |
| @types/ws | 8.18.2 | MIT | ws の型定義(開発時のみ) | 含まれない | 2026-11-19 |
| @modelcontextprotocol/sdk | 1.32.2 | MIT(`node_modules/@modelcontextprotocol/sdk/LICENSE` と `package.json` の `license` で確認。著作権表示 Anthropic, PBC) | MCP アダプタ(`src/mcp/`。stdio の MCP サーバー: `Server`・`StdioServerTransport`・型定義)。試験ではクライアント(`Client`・`StdioClientTransport`・`InMemoryTransport`)としても使う。**実行時の依存**(MCP アダプタを使うときだけ読み込む。ローカルサーバーと画面は読み込まない) | 含まれる(MCP アダプタ側。推移的な依存あり: 下の節) | 2026-11-19 |

実行時の依存は ws と @modelcontextprotocol/sdk(MCP アダプタだけが使う)の2つ(エンジン・出力保護・静的配信・認証・パッチファイルの保存は標準の言語機能と Node.js 標準のモジュールだけを使う)。テストは Node.js 標準の `node:test` を使う。ブラウザでの試験(`npm run test:browser`)は、実行環境にある Playwright と Chromium を使う(このリポジトリの依存には含めていない)。

**選定の理由**: esbuild は、AudioWorklet 用に依存をまとめた単一ファイルを出力でき、設定が少なく、MIT で配布物に含まれない。
ws は、Node.js 22 の標準に WebSocket のサーバーがない(標準にあるのはクライアントだけ)ために採用した。既存の `http.Server` の接続要求(upgrade)をそのまま受け取れるので、接続の前に Host・Origin・トークンを自前で検査できる。他のパッケージに依存せず、MIT。

**@modelcontextprotocol/sdk の選定の理由**: MCP の公式の TypeScript SDK で、MIT。プロトコルの版の取り決め(初期化、ツール一覧、ツール呼出し、エラーの形)と stdio の輸送を自前で実装し直さずに済み、対象クライアントとの互換性を SDK に任せられる。アダプタは低水準の `Server` を使い、入力スキーマは自前の JSON Schema をそのまま渡す(zod など他のパッケージを直接は使わない)。MCP アダプタのために他の依存は足していない。

### @modelcontextprotocol/sdk の推移的な依存(確認日 2026-11-19)
SDK 1.32.2 を入れると、SDK 自身を含めて **95 パッケージ**(推移的な依存は **94**)が `node_modules` に加わる(`package-lock.json` で確認。追加前の実行時の依存は ws の1つだけ)。各パッケージの `package.json` の `license` を確認した内訳:

| ライセンス | 件数 | パッケージ |
|---|---|---|
| MIT | 85(SDK を含む) | ajv、ajv-formats、zod、express とその依存、hono、@hono/node-server、jose、cors、cross-spawn、eventsource、eventsource-parser、content-type、raw-body、pkce-challenge、express-rate-limit など |
| ISC | 7 | inherits、isexe、once、setprototypeof、which、wrappy、zod-to-json-schema |
| BSD-3-Clause | 2 | fast-uri、qs |
| BSD-2-Clause | 1 | json-schema-typed |

- コピーレフト(GPL/AGPL/LGPL 等)のものはない。すべて寛容なライセンス(MIT / ISC / BSD)。
- SDK が直接依存するのは 17 パッケージ(ajv、ajv-formats、zod、zod-to-json-schema、json-schema-typed、cross-spawn、content-type、raw-body、eventsource、eventsource-parser、pkce-challenge、jose、cors、express、express-rate-limit、hono、@hono/node-server)。残りはそれらの依存(大半は express のもの)。
- 多くは SDK の HTTP 輸送・認証(express、hono、jose、cors など)のためのもので、本製品の MCP アダプタ(stdio だけ)は実行時に読み込まない。ただし SDK の依存として宣言されているので、導入(`npm install`)では入る。配布物に同梱する場合は、これらの著作権表示とライセンス文を合わせて同梱する必要がある(配布の形と配布ライセンスは OPEN-005)。
- SDK は `zod`(^3.25 || ^4.0)と `@cfworker/json-schema` を peer 依存にも挙げている。zod は通常の依存としても入る(4 系)。`@cfworker/json-schema` は任意(optional)で、入れていない。

## 採用の手順
1. 追加する前に、ライセンスと配布物への影響(実行時に同梱されるか)を確認する。
2. この表に追記する。コピーレフト(GPL/AGPL 等)のライブラリは、配布ライセンス(OPEN-005)が決まるまで実行時の依存に加えない。
3. `package-lock.json` を更新してコミットする。
