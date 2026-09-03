# 月次メンテナンス

毎月 1 回、依存関係と負債の手入れを 1 PR にまとめる。この文書が手順の正本で、実行時はこのファイルをそのままプロンプトに渡す（例: 「`docs/runbooks/monthly-maintenance.md` の手順で 2026-09 の月次メンテナンスを実施して PR を作ってください」）。

過去の PR: #516（2026-08）、#494（2026-08）の本文書式を踏襲する。

## 前提

- ブランチ: `maintenance/YYYY-MM-monthly`（`develop` から切る）
- 機能追加・仕様変更をしない。挙動が変わる修正が必要になったら別 PR に切り出す
- 各ステップの結果は「対応した / 対応不要 / 見送り（理由）」のいずれかで PR 本文に残す。黙って省略しない

## 手順

### 1. セキュリティ監査

```bash
npm audit --omit=dev --audit-level=high
npm audit
```

- 本番依存（`--omit=dev`）の high 以上は必ず対応する
- dev 依存の high 以上は CI をブロックしないが、サプライチェーン検知として記録する
- `npm audit fix` で直らないものは、影響範囲と見送り理由を書く

### 2. 依存パッケージ更新

```bash
npm outdated
```

- minor / patch は更新する。同一ファミリー（`@tiptap/*` など）は同時に上げる
- major は原則スキップし、パッケージ・現在版・最新版・理由を表にする
- 更新後に各パッケージの CHANGELOG で破壊的変更が無いことを確認し、PR 本文に「確認済み」と書く

### 3. 未使用コード整理

```bash
npm run knip
```

- 未使用 export / 依存を削除する。削除に迷うものは残して理由を書く

### 4. hotspot レビュー（負債の計測）

```bash
npm run hotspots
# 500 行超（max-lines）の warn 件数。lint 出力を grep すると出力フィルタ（rtk）で件数が化けるので JSON で数える
npx eslint . -f json -o /tmp/eslint.json; node -e "console.log(require('/tmp/eslint.json').flatMap(f=>f.messages).filter(m=>m.ruleId==='max-lines').length)"
```

`npm run hotspots` の上位 5 件について、1 件 1 行で判定と理由を PR 本文に書く。判定は次の 3 値。

| 判定 | 意味 | 次の動き |
| --- | --- | --- |
| 分割する | 責務が複数混在し、churn かテスト無しの少なくとも一方がある | `docs/plans/<slug>.md` を要件定義テンプレートから起こし、`takt -w spec-review` に回す。**この PR では分割しない** |
| 今回は放置 | 大きいが単一責務で churn が低い、または近く廃止予定 | 理由を書く。翌月も上位に残れば再判定 |
| 次回再判定 | 進行中の機能開発と衝突する | 衝突する仕様書名を書く |

判定の材料:

- 実行行数（空行・コメント除外。eslint `max-lines` の近似で、JSX 内コメント等で数行ズレる。順位判断に使い、閾値判定は lint 側）
- 90 日 churn（触られている頻度。高いほど分割の効果が大きい）
- テスト参照（`vi.mock` で丸ごと差し替えているだけのファイルは「なし」扱い。無い巨大ファイルは分割前にキャラクタライズテストの要否を仕様書で判断する）
- `max-lines` warn 件数の前月比（`tests/` も含む数。増えていれば新規コードの肥大化、減っていれば分割の効果）

判定結果が「分割する」の仕様書は、翌月以降の月次メンテで進捗を確認する。

### 5. 品質ゲート

```bash
npm run verify
```

- audit → lint → test:coverage → build → knip の全通過が PR の前提
- `test:coverage` の閾値（`vitest.config.ts`）が上がった場合、config の差分をこの PR に含める
- 閾値を下回った場合は数値合わせのテストを書かず、原因（未テストの大きな追加）を PR 本文に書いて相談する

### 6. PR

PR 本文の節構成:

1. 概要
2. npm audit 結果（検出件数・対応内容・未対応）
3. npm outdated 対応（アップグレード表 / スキップ表）
4. knip 結果
5. hotspot レビュー（上位 5 件の判定表、`max-lines` warn 件数の前月比）
6. 既存機能への影響
7. 確認済み事項（verify の各ゲート）

CodeRabbit のレビュー指摘は、依存更新に起因するものだけ対応し、既存コードへの指摘は hotspot レビューの材料として記録する。
