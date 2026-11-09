# Midnight Preprod Wallet CLI

[English](README.md)

Midnight Preprod上でウォレットの流れを学習・検証するための、機能を絞ったWallet SDKリファレンスCLIです。

```text
シード → アドレス → NIGHT・shieldedトークン・DUST → 送金
```

このプロジェクトで確認できる内容：

- 1つのシードからの鍵・アドレス導出
- unshielded NIGHTとshieldedトークンの同期・送金
- 両方の出力を含むアトミックな複合送金
- 登録済みNIGHT UTxOを裏付けとしたDUST生成
- DUST生成登録の解除と生成先変更
- DUSTによる手数料支払いとNIGHT送金の確定

> [!IMPORTANT]
> このプロジェクトはPreprodでの学習用であり、本番用やMainnet用のウォレットではありません。`.wallet-seed` をバックアップし、他人へ共有しないでください。シードを失うとウォレットを復元できません。

## 前提条件

- Node.js 22以上
- pnpm
- Docker
- BlockfrostのMidnight Preprod Project ID

このリポジトリが対象とする **Preprodは、現在もLedger `8.1.3`** です。Wallet SDK `1.2.0`、ledger `8.1.3`、Proof Server `8.1.3` を1つの互換セットとして固定しています。Preprodの接続先を使う間は、Mainnet用のLedger 9版へ置き換えないでください。

MainnetとPreviewはLedger 9へ移行済みで、node `2.1.101`、Wallet SDK `2.0.0`、Proof Server `9.0.0`を使用します。これらはWallet SDK 2 APIへの移行が必要であり、現在のPreprod専用CLIの対象外です。このプロジェクトはBlockfrostへ接続するため、Midnight nodeをローカル実行せず、node `2.1.101`のバイナリも必要ありません。

将来PreprodがLedger 9へ移行した時点で、互換セット全体をまとめて更新します。そのネットワーク更新後は、PreprodのDUST生成登録も再度行う必要があります。

## セットアップ

[Blockfrost](https://blockfrost.io/)でMidnight Preprodプロジェクトを作成し、Project IDを取得します。別ネットワーク用のProject IDではPreprodへ接続できません。

```bash
pnpm install
cp .env.example .env
```

`.env` にProject IDを設定します。

```dotenv
BLOCKFROST_PROJECT_ID=your_project_id
```

ウォレットを接続する前にローカルコードを検証します。

```bash
pnpm typecheck
pnpm test
```

最初のウォレットコマンド実行時に、32バイトのランダムシードが `.wallet-seed` へ生成されます。以後は同じシードとウォレットが使われます。

## Proof Serverの起動

コマンド一覧で「必要」と記載したコマンドの実行中は、別のターミナルで起動したままにします。

```bash
docker run --rm \
  -p 6300:6300 \
  -e MIDNIGHT_PROOF_SERVER_VERBOSE=true \
  midnightntwrk/proof-server:8.1.3
```

動作確認：

```bash
curl http://localhost:6300/health
```

## 基本操作

### 1. アドレスの確認

```bash
pnpm address
```

表示された `Unshielded` アドレス（`mn_addr_preprod1...`）を[Midnight Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/)へ入力します。Shieldedアドレスは使用しません。

### 2. NIGHT着金の確認

```bash
pnpm balance
```

Faucetから受け取れるのはunshielded tNIGHTだけです。shielded残高は別のトークンであり、token typeとbase unit量で表示されます。

### 3. DUST生成へのNIGHT登録

```bash
pnpm register-dust
```

`Registration finalized` が表示されれば登録完了です。登録してもNIGHTの総量は減りません。DUSTは時間経過で生成され、トランザクション手数料に使われます。

### 4. NIGHTの送金

```bash
pnpm send <recipient-unshielded-address> <amount-in-night>
```

例：

```bash
pnpm send mn_addr_preprod1... 3
```

SDKはトランザクションの確定を待ち、完了後に `Transfer finalized` を表示します。

### 5. shielded送金と複合送金

```bash
pnpm send-shielded <shielded-address> <token-type> <base-units>
pnpm send-combined \
  <unshielded-address> <night-amount> \
  <shielded-address> <token-type> <base-units>
```

NIGHTはunshieldedトークンです。`send-shielded` は、コントラクトが発行した、または別のウォレットから受け取った既存のshieldedトークンを使用します。FaucetのNIGHTをshielded資産へ変換するコマンドではありません。`pnpm balance` に表示されるtoken typeと利用可能なbase unit量を指定してください。小数桁はトークン発行者が定義するため、CLIではNIGHT量ではなく整数のbase unit量を受け取ります。

複合送金は、unshielded NIGHTと既存のshieldedトークンを1つのアトミックなトランザクションで送ります。両者を変換する処理ではありません。両方の出力が成功するか、どちらも実行されないかのいずれかになります。初回のshielded同期はunshielded同期より大幅に時間がかかる場合があります。

### 6. 履歴の確認

```bash
pnpm history
pnpm history <history-hash>
```

送信コマンドが表示するLedger `Identifier` は、ノードが送信済みトランザクションを追跡するための識別子です。履歴では別の `History hash` を使用します。履歴を絞り込む場合は、`pnpm history` に表示された `History hash` を指定してください。送信時のIdentifierでは検索できません。

## DUST同期

Wallet SDK 1.xは、Preprod全体のDUST履歴を再生してローカル状態を構築します。初回同期には数時間かかる場合があります。shielded、unshielded、DUSTの状態はウォレットとネットワークごとに `.wallet-state/` へ保存され、長時間のDUST同期は10,000イベントごとにチェックポイントが作られます。次回は保存地点から再開します。

```text
syncing... 723829/723829 transactions; DUST events 76745/1838604 (1015s)
```

- `1006:: Abnormal Closure`：WebSocket切断後にSDKが再試行。進捗が続く間は待機
- `1000:: Normal Closure`：コマンド終了時の正常切断。エラーではない

## コマンド一覧

| コマンド | 内容 | Proof Server |
| --- | --- | --- |
| `pnpm address` | アドレスの導出・表示 | 不要 |
| `pnpm balance` | 残高の同期・表示 | 不要 |
| `pnpm register-dust` | NIGHT UTxOのDUST生成登録 | 必要 |
| `pnpm send <address> <amount>` | unshielded NIGHTの送金 | 必要 |
| `pnpm send-shielded <address> <token-type> <base-units>` | 既存shieldedトークンの送金 | 必要 |
| `pnpm send-combined <u-address> <night> <s-address> <token-type> <base-units>` | NIGHTとshieldedトークンを1トランザクションで送金 | 必要 |
| `pnpm deregister-dust` | 利用可能な登録済みNIGHT UTxOすべてのDUST生成を停止 | 必要 |
| `pnpm redesignate-dust <dust-address>` | 利用可能な登録済みNIGHT UTxOすべての生成先を変更 | 必要 |
| `pnpm history [history-hash]` | 確定済み履歴の表示 | 不要 |
| `pnpm test` | 単体テスト | 不要 |

`deregister-dust` と `redesignate-dust` は、現在利用可能な登録済みNIGHT UTxOすべてを対象にします。どちらも手数料を支払えるDUST残高が必要です。変更先のウォレットで `pnpm address` を実行し、表示された `DUST` アドレスを使用します。

ノード接続が切れた場合、同じ確定済みトランザクションを最大3回送信します。すべて失敗した場合は、作り直す前に `pnpm balance` で同期してください。応答だけ失われ、最初の送信がノードへ届いている可能性があります。

## シード設定

標準の `.wallet-seed` はGitの管理対象外で、ファイル権限は `600` です。保存場所は `.env` で変更できます。

```dotenv
WALLET_SEED_FILE=/safe/path/to/midnight-wallet.seed
WALLET_STATE_DIR=/safe/path/to/midnight-wallet-state
```

CI環境では、32バイトのシードを64桁の16進文字列で指定できます。

```dotenv
WALLET_SEED=<64 hexadecimal characters>
```

旧版は末尾が `...0001` の公開テストシードを使用していました。旧テスト資産を移す場合は、先に新しいウォレットアドレスを作成して控え、旧シードを一時的に `WALLET_SEED` へ設定し、新しいアドレスへ送金した後に環境変数を削除します。公開シードを実資産に使用してはいけません。

## セキュリティ範囲

このCLIは、浮動小数点を使わない金額検証、ログ内Project IDのマスク、所有者だけが読めるウォレット状態ファイル、トランザクション構築失敗時の予約済みコイン解放、トランザクション確定待ちに対応しています。ウォレット状態から所有コインが分かるため、外部へ公開してはいけません。Mainnet利用には、鍵の暗号化またはハードウェア保護、バックアップと移行に対応した永続ストレージ、運用監視、送金上限、復旧試験、Mainnet統合試験が追加で必要です。

## プロジェクト範囲

このリポジトリはブラウザ拡張ウォレットではなく、小さく再利用しやすいWallet SDKリファレンスに保ちます。DUSTスポンサー、swap、WASM証明、ウォレット側DApp Connector、複数アカウント、承認UI、本番用の鍵管理は対象外です。将来のDAppはこのCLIやシードを直接利用せず、DApp Connector APIを通して既存ウォレットへ接続します。

CLI表示は `src/commands/`、Node.jsから再利用できる操作は `src/lib.ts` に分離しています。この操作層はシードを管理する信頼済みスクリプト向けです。ブラウザDAppでは使用せず、DApp Connector APIを通してウォレットへ接続してください。

## 謝辞

この独立した非公式プロジェクトでは、[Midnight AcademyのCLIウォレット課題](https://academy.midnight.network/learn/midnight-wallet/51-hands-on-build-a-cli-wallet-capstone-f15e7446-5ed5-82c3-a006-81a25ff9c09a)と[公式Wallet SDK Developer Guide](https://docs.midnight.network/sdks/official/wallet-developer-guide)を学習資料として参照しました。Midnight FoundationおよびHackQuestとの提携や、両者による承認を示すものではありません。

## ライセンス

このプロジェクトは[MIT License](LICENSE)の下で公開されています。
