# Midnight Preprod Wallet CLI

[English](README.md)

Midnight Preprodで、アドレス導出、残高・履歴確認、DUST生成管理、NIGHT・既存shieldedトークンの送金を試すための小さなWallet SDKリファレンスCLIです。

> [!IMPORTANT]
> Preprodでの学習・検証用です。シードをバックアップし、`.wallet-seed`・`.env`・`.wallet-state/` を公開しないでください。本番・Mainnet用ウォレットではありません。

## 前提条件

- Node.js 22以上、pnpm、Docker
- [Blockfrost](https://blockfrost.io/)のMidnight **Preprod** Project ID
- PreprodのLedger `9.1.0.1` に対応するWallet SDK `2.0.0`・Proof Server `9.0.0`

nodeとIndexerはBlockfrostへ接続し、Proof Serverだけをローカルで動かします。Indexerは `4.4.101` 対応が必要です。[Ledger 9互換性ガイド](https://docs.midnight.network/relnotes/ledger-9)も参照してください。

## セットアップ

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env` にProject IDを設定します。

```dotenv
BLOCKFROST_PROJECT_ID=your_project_id
```

実ウォレットやPreprodへ接続せずにコードを検証できます。

```bash
pnpm typecheck
pnpm test
```

最初の有効なウォレットコマンドでランダムシードを `.wallet-seed` に生成し、所有者だけが読み書きできる権限で保存します。以後は同じシードを使います。

## Proof Serverの起動

下表で「必要」と記載したコマンドの実行中は、別ターミナルで起動したままにします。ポート6300を使う旧サーバーがある場合は先に停止してください。Ledger 9には `9.0.0` が必要です。

```bash
docker run --rm \
  -p 127.0.0.1:6300:6300 \
  midnightntwrk/proof-server:9.0.0
```

`status: ok` が返ることを確認します。

```bash
curl --fail http://localhost:6300/health
```

## 最初の送金

1. `pnpm address` で **Unshielded** アドレス（`mn_addr_preprod1...`）を確認します。
2. [Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/)でtNIGHTを受け取ります。
3. `pnpm balance` で同期完了と残高を確認します。
4. `pnpm register-dust` でDUST生成へ登録します。NIGHT残高は維持され、生成されたDUSTが手数料に使われます。登録用の生成DUSTが不足するとSDKに表示された場合は、待って再実行します。
5. `pnpm send <送信先Unshieldedアドレス> <NIGHT量>` で少額を送ります。
6. `Transfer finalized` を待ち、`pnpm history` で履歴を確認します。

PreprodのLedger 9移行ではcNIGHTに裏付けられていない登録が解除されました。既存のFaucet tNIGHTも再登録が必要な場合があります。利用可能なコインがすべて登録済みなら、`register-dust` がその旨を表示します。

## コマンド一覧

| コマンド                                                                       | 内容                                               | Proof Server |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ------------ |
| `pnpm address`                                                                 | Unshielded・Shielded・DUSTアドレスを表示           | 不要         |
| `pnpm balance`                                                                 | 同期して残高を表示                                 | 不要         |
| `pnpm history [history-hash]`                                                  | 確定済み履歴の一覧・個別検索                       | 不要         |
| `pnpm register-dust`                                                           | 利用可能な未登録NIGHT UTxOを登録                   | 必要         |
| `pnpm send <address> <night>`                                                  | unshielded NIGHTを送金                             | 必要         |
| `pnpm send-shielded <address> <token-type> <base-units>`                       | 既存shieldedトークンを送金                         | 必要         |
| `pnpm send-combined <u-address> <night> <s-address> <token-type> <base-units>` | 両トークンをアトミックに送金                       | 必要         |
| `pnpm deregister-dust`                                                         | 利用可能な登録済みNIGHT UTxOすべてのDUST生成を停止 | 必要         |
| `pnpm redesignate-dust <dust-address>`                                         | 利用可能な登録済みNIGHT UTxOすべての生成先を変更   | 必要         |

NIGHT量は小数点以下6桁まで指定できます。shielded量は発行者のbase unitによる正の整数です。64桁のtoken typeは `pnpm balance` からコピーします。NIGHTとshieldedトークンを変換する機能はありません。複合送金は両方の出力を1つのトランザクションへ含めます。

`deregister-dust`・`redesignate-dust` は利用可能な登録済みNIGHT UTxOすべてを変更し、手数料用のDUSTが必要です。変更先のDUSTアドレスは、受取側ウォレットの `pnpm address` で取得します。

履歴検索には `pnpm history` が表示する **History hash** を指定します。送信時の **Identifier** とは別の値です。日時はUTC、手数料はspecks（1 DUST = 10¹⁵ specks）で表示します。

## 保存状態と履歴

状態と履歴はウォレット・ネットワークごとに `.wallet-state/`、または `WALLET_STATE_DIR` へ非公開ファイルとして保存し、次の起動で同期を再開します。長時間のDUST同期は10,000イベントごとにチェックポイントを保存します。

旧チェックポイントに履歴ファイルがない場合、次の起動時にNIGHT・shielded履歴を一度再構築します。DUSTのチェックポイントは保持しますが、通常より時間がかかる場合があります。履歴ファイルが読めない場合は、黙って初期化せずエラーにします。

`history` は確定ブロックから時刻を補い、不足する手数料・ブロック情報をIndexerから取得して保存します。取得できない項目は警告とともに未取得と表示します。通常取引以外には通常の手数料フィールドがないため `not applicable` と表示します。

## トラブル対処

- **DUST証明の拒否（`170`）**：Proof Server `9.0.0` とIndexerの互換性を確認し、DUST同期後にトランザクションを作り直します。[DUSTのトラブル対処](https://docs.midnight.network/guides/manage-dust#dust-troubleshooting)も参照してください。
- **切断後、送信結果が不明**：送信が届いている可能性があるため、作り直す前に残高と履歴を確認します。同じウォレットのコマンドは1つずつ実行してください。
- **保存状態を復元できない**：状態ディレクトリを別の場所へ移し、同じシードで再同期します。元のファイルは保管し、同期初期化のためにシードを削除しないでください。

## シードと保存先の設定

`.env` で保存先を変更できます。

```dotenv
WALLET_SEED_FILE=/safe/path/to/midnight-wallet.seed
WALLET_STATE_DIR=/safe/path/to/midnight-wallet-state
```

`WALLET_SEED` に32バイトのシードを64桁の16進文字列で設定すると、ファイルより優先します。コミット・共有しないでください。旧版の公開テストシードを非公開の資産に使わないでください。

## コードと対象範囲

CLI表示は `src/commands/`、再利用可能な操作は `src/lib.ts` にあります。操作層はシードを管理する信頼済みNode.jsスクリプト向けです。ブラウザDAppでは、DApp Connector APIを通して既存ウォレットへ接続します。

本番用の鍵管理、複数アカウント、swap、DUSTスポンサー、ウォレット側DApp Connectorは対象外です。金額には `bigint` を使い、ログのProject IDをマスクし、保存ファイルに所有者権限を設定しますが、本番用ウォレットの安全性を保証するものではありません。

## 謝辞

[Midnight AcademyのCLIウォレット課題](https://academy.midnight.network/learn/midnight-wallet/51-hands-on-build-a-cli-wallet-capstone-f15e7446-5ed5-82c3-a006-81a25ff9c09a)と[Wallet SDK Developer Guide](https://docs.midnight.network/sdks/official/wallet-developer-guide)を学習資料とした独立・非公式プロジェクトです。Midnight Foundation・HackQuestとの提携や承認を示すものではありません。

## ライセンス

このプロジェクトは[MIT License](LICENSE)の下で公開されています。
