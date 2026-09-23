# 高エンゲージメント投稿のブログ化（Phase 1: エンゲージメント率の算出と抽出）要件定義

## メタデータ

- 文書名: 高エンゲージメント投稿のブログ化（Phase 1: エンゲージメント率の算出と抽出）
- ステータス: `approved`
- 作成日: 2026-09-19
- 最終更新日: 2026-09-23
- 作成者: 遠藤
- 承認者: カオルさん（要件）/ 遠藤（技術）
- 対象リリース: Phase 1（本書の完了定義は Phase 1 まで。Phase 2 以降は §17 のロードマップのみ）
- 関連する依頼・Issue・PR:
  - Trello: [EG率算出+高EG率抽出](https://trello.com/c/5Zh53Fmx)（ラベル「高EG率のコンテンツをブログ化」）
  - 2026-09-16 GrowMate 定例MTG（Lark 妙記 `objp2t1oa28n5wc4382m6hwu`）
  - 前提仕様: [`instagram-integration-design.md`](./instagram-integration-design.md)（Phase 2 まで実装済み）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - カオルさん（クライアント）は Instagram 投稿のいいね・保存・リーチからエンゲージメント率を**スプレッドシートで手計算**し、反応が大きかったテーマを探している。
  - ブログはキーワード起点で記事を作るため、「届いた卵が割れていた」「魚粉の効果」のような**検索されないが購入判断に不可欠な情報**が記事化されない。SNS で反応が大きかったテーマ＝見込み客の関心が高いテーマを、ブログ側にも記事として置き、既存記事から内部リンクで誘導したい（2026-09-16 MTG）。
  - GrowMate の Instagram タブ（`/analytics?tab=instagram`）は元の指標（いいね・コメント・保存・リーチ）を持っているが、エンゲージメント率の列も、その順での並べ替えも、目標値に達しているかの判定も無い。
- 放置した場合の影響: 手計算の管理コストのため、インスタとブログの片方がおろそかになる状態が続く（MTG 発言「マネジメントコストがかかりすぎて…やりきれてない」）。後続の「高エンゲージメント投稿のブログ化」（Phase 2）の入力も作れない。

### 目的

- この開発で実現する状態: Instagram タブで投稿ごとのエンゲージメント率が見え、率の高い順に並べ替えられ、フォロワー規模別の目標エンゲージメント率に達した投稿だけに絞り込める。
- 利用者・事業にとっての価値: スプレッドシートの手計算が不要になる。ブログ化すべきテーマの候補を GrowMate 上で選べる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| エンゲージメント率の手計算 | スプレッドシートで手計算 | GrowMate の一覧だけで確認できる | カオルさんへの確認 | Phase 1 リリース後の定例 |
| スプレッドシートとの一致 | — | 同じ投稿・同じ元数値で、小数第1位まで一致 | 任意の投稿3件をスプレッドシートと突き合わせ | リリース時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | Instagram 連携済みの `admin` / `paid` ユーザー | 反応の大きい投稿を見つけ、ブログ化するテーマを選ぶ |
| 運用担当 | 遠藤 | 不具合時の切り戻し |
| 管理者・承認者 | カオルさん | 算出式・目標値の承認 |
| 外部サービス・連携先 | Meta Instagram Graph API | 投稿インサイト・フォロワー数の提供（既存連携） |

### 主な利用シナリオ

1. **カオルさんが**、**Instagram タブをエンゲージメント率順に並べ、上位の投稿のテーマを確認したい**。
2. **カオルさんが**、**「高エンゲージメント率」で絞り込み**、**フォロワー規模から見た目標エンゲージメント率に達した投稿だけを一覧で確認する**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
Instagram アプリ／GrowMate で数値を見る
  → スプレッドシートに いいね・コメント・保存・リーチ を転記
  → エンゲージメント率を計算して並べる
  → 目標値を超えたテーマを目で拾い、ブログ化を検討（ここで止まりがち）
```

### 導入後（To-Be）

```text
GrowMate の Instagram タブで［最新化］（投稿インサイトとフォロワー数を取得）
  → エンゲージメント率の列を確認／エンゲージメント率順に並べ替え
  → 「高エンゲージメント率」で絞り込み
  → 目標を超えたテーマをブログ化の候補にする（Phase 2 で GrowMate 内から作成できるようにする）
```

### 業務ルール

- ルール ID: BR-001
  - ルール: エンゲージメント率 ＝ （いいね ＋ コメント ＋ 保存）÷ リーチ × 100。表示は小数第1位（四捨五入）。
  - 例外: 分母はリーチ（フォロワー数ではない）。シェア・再投稿は含めない（2026-09-19 遠藤決定。Trello の式「フォロワー数（またはリーチ数）」からリーチを採用。クライアントのスプレッドシートもリーチ分母）。
- ルール ID: BR-002
  - ルール: いいね・コメント・保存・リーチのどれかが未取得、またはリーチが 0 以下の投稿はエンゲージメント率を算出しない（`-` 表示）。0% とは表示しない。
  - 例外: インサイトを取得できない投稿（プロアカウント転換前・2年超）は既存の「対象外」表示に従う。
- ルール ID: BR-003
  - ルール: 目標エンゲージメント率は、アカウントの**現在のフォロワー数**で下表から決める（区間の境界は下限を含み上限を含まない）。

    | フォロワー数 | 区分 | 目標 | 「目標達成」とする率 | 出典 |
    | --- | --- | --- | --- | --- |
    | 〜999 | ライト／ビギナー | 6.0〜10.0% 以上 | 6.0% 以上 | 2026-09-20 クライアント補足（Trello カード本文への反映は R-004） |
    | 1,000〜4,999 | ナノ | 4.0〜6.0% | 4.0% 以上 | Trello |
    | 5,000〜9,999 | — | 3.0〜4.5% | 3.0% 以上 | Trello |
    | 10,000〜49,999 | マイクロ | 2.0〜3.5% | 2.0% 以上 | Trello |
    | 50,000〜99,999 | ミドル | 1.5〜2.5% | 1.5% 以上 | Trello |
    | 100,000〜 | メガ／インフルエンサー | 0.8〜1.5% | 0.8% 以上 | 2026-09-20 クライアント補足（Trello カード本文への反映は R-004） |

  - 「目標達成」＝ 投稿のエンゲージメント率が、その区分の目標の**下限以上**（例: ナノなら 4.0% 以上）。
  - 例外: フォロワー数が未取得のときは判定しない。フォロワー数が 0 でも表の最初の区分（ライト／ビギナー）で判定する。
- ルール ID: BR-004
  - ルール: 投稿後7日以内の投稿は、［最新化］のたびにインサイトを取り直す。7日を過ぎた投稿は最後に取得した値のまま。
  - 例外: 取り直しに失敗した投稿は DB に一切書き込まず、前回の値（いいね・コメントも含む）をそのまま残す。新着投稿の失敗時に使う `upsertMediaListingPreservingInsights` はいいね・コメントを一覧 API の最新値で上書きし、率が「新しいいいね ÷ 古いリーチ」の混ざった値になるため、取り直し対象には使わない。
- ルール ID: BR-005
  - ルール: フォロワー数は Instagram 連携時と［最新化］のたびに取得して保存する。
  - 例外1: 取得に失敗したときは前回の値を残す。同期そのものは止めない。
  - 例外2（アカウント切り替え）: 別の Instagram アカウントに連携し直したとき（`existingCredential.igUserId !== profile.igUserId`）は**前回の値を残さず** `followers_count` / `followers_count_synced_at` を null にリセットしてから、新しいアカウントの値を保存する。旧アカウントの値が残ると BR-003 の区分判定と FR-004「高エンゲージメント率」が全投稿で誤る（例: 5万人のアカウントから800人のアカウントへ切り替えると、投稿は purge されるのに目標が「ミドル 1.5〜2.5%」のまま判定され、小規模アカウントのリーチ分母の率はほぼ全投稿が「目標達成」になる）。リセットは既存の backfill 状態リセット（`updateInstagramCredential` で `backfillCursor` / `backfillCompletedAt` / `lastSyncedAt` を null にするブロック）と同じ場所で行う。例外1 はこの経路には適用しない。

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: `/analytics?tab=instagram` に「エンゲージメント率」列、並び順「エンゲージメント率」、「高エンゲージメント率」の絞り込み、目標値（フォロワー数・区分・目標）の表示を追加。
- API・外部連携: 既存の［最新化］（incremental 同期）で、(1) 投稿後7日以内の既存投稿のインサイトを再取得（BR-004）、(2) フォロワー数を取得（BR-005。既存の `fetchProfile` = `GET /me?fields=...followers_count`）。連携時の OAuth callback は既にプロフィールを取得しているため、その値も保存する。新しいエンドポイント・パーミッションは使わない。
- データ・DB: `instagram_media` に生成列 `engagement_rate` を追加。`instagram_credentials` に `followers_count` / `followers_count_synced_at` を追加。
- 権限・ロール: 既存の Instagram タブと同じ（`admin` / `paid`）。
- 運用・監視: 既存の `console.error` ログのみ。

### Non-goals（今回の対象外）

| 対象外 | 理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| 投稿時点のフォロワー数での判定 | フォロワー数の履歴は保存しておらず、投稿時点の値を持たない。現在のフォロワー数で全投稿を判定する | — |
| フォロワー数の推移の保存（日次） | 判定には現在値1つで足りる。`instagram_account_insights_daily` は使わない | 推移を見たい要望が出たとき |
| 連携設定画面のプレビュー（`instagramSetup.actions.ts` の3つ目の `fetchProfile`）で取得したフォロワー数の保存 | 表示専用のライブ値であり、書き込み経路を増やさない。結果として `/setup/instagram` は常に最新の値、Instagram タブは最終［最新化］時点の値となり、同じ項目が2画面で食い違いうる。Instagram タブ側はフィールド構成ダイアログの判定基準の下に「（フォロワー数は最後に取得した時点の値）」と出すため誤読しない（FR-004） | 2画面の値の差が運用で問題になったとき |
| 目標値の区分・数値をユーザーが編集する機能 | BR-003 の表を固定値で使う。要求が無い | 業種・アカウントで目標を変えたい要望が出たとき |
| シェア・再投稿を含む率、フォロワー分母の率の併記 | 分母・式は BR-001 で決定済み。列を増やすと数字の食い違いを生む | クライアントから要望が出たとき |
| キャプションからのキーワード立案・ブログ下書き作成 | Phase 2（§17） | Phase 1 リリース後 |
| 既存記事への内部リンク提案・再作成 | Phase 3（§17） | Phase 2 リリース後 |
| 目標達成投稿の自動検出・通知 | MTG 00:23 で「まずはええと、SNS…エンゲージメント率か。テーマをピックアップする」と合意（文字起こしのまま）。自動化は Phase 2 の判断 | Phase 2 仕様作成時 |
| 7日を過ぎた投稿のインサイト再取得、定期同期（cron） | API 呼び出しが投稿数に比例して増える。Instagram 連携 Phase 2 で cron を落とした判断（`instagram-integration-design.md` §4 Phase 2 item3）を維持する | 古い投稿の率がずれて判断を誤る事例が出たとき |
| エンゲージメント率順の並べ替え用インデックス | 既存の `reach` / `views` 並べ替えも無索引で、1ユーザー数千件までは許容と判断済み（`instagramMediaService.getPage` のコメント） | 同コメントの上限（数千件）を超えたとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-09-19 遠藤）
- 含めるもの: migration・サービス・UI・同期の再取得とフォロワー数取得・単体テスト・画面確認
- 含めないもの: 仕様レビュー往復、クライアント確認待ち、本番リリース作業

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| Phase 1 | 本書の FR-001〜FR-007 | 23〜29 | 2.9〜3.6 |
| **合計** |  | **23〜29** | **2.9〜3.6** |

幅の理由: FR-005（7日以内の再取得）は同期処理のカーソル・ウォーターマーク周りに触れるため、既存テストの修正量で幅が出る。

### 内訳

| 区分 | 内容 | 工数（時間） |
| --- | --- | ---: |
| DB | 生成列 + credentials の列追加 + ロールバック + 型再生成 | 2 |
| サーバー | 並べ替えキー追加・目標判定の純関数・絞り込み・page.tsx の解析共通化・credentials の読み書き | 5 |
| UI | 列・セル表示・並び順・絞り込み・絞り込みの保存と復元・目標値表示・ダイアログ内の判定基準の表示と計算式の開閉・ui-text 更新（§6 UI用語）。判定基準と計算式は既存の `dialogExtraContent` と `details` への表示の追加だけで新規コンポーネントが無いため、6h に内包する | 6 |
| 同期 | 7日以内の既存投稿のインサイト再取得、フォロワー数の取得・保存（同期と OAuth callback） | 6〜10 |
| テスト | 単体テスト追加・既存テスト修正 | 3〜4 |
| 確認 | 画面確認・スプレッドシート突き合わせ | 1〜2 |

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: spec-review 1〜2往復
- クライアント確認・たたき台合意の見込み:
  - たたき台合意: §6 のレイアウト・状態別UI（とくに未取得時の案内文言とバッジ）をカオルさんに提示して合意する（§14 実装着手前 CP）。合意まで実装に着手しない
  - 目標値: 1,000 人未満・10 万人以上の数値は 2026-09-20 のクライアント補足で受領済みのため待ち時間は発生しない（Trello カード本文への反映は R-004 で追跡）
- 希望リリース時期との関係: MTG で「まずエンゲージメント率を出して並べ替えできるところまで出す」と合意済み。期日指定なし

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | 投稿ごとのエンゲージメント率を算出し、一覧に「エンゲージメント率」列として表示する | Must | Trello「エンゲージメント率を出すようにする」、MTG 00:28 | BR-001 / BR-002 どおりに表示される |
| FR-002 | 並び順に「エンゲージメント率」（高い順）を追加する。算出できない投稿は末尾 | Must | MTG 00:26「ポチッと押すと上行ったり下行ったり」、00:31 遠藤の提案「そのエンゲージメントを出して、あと、あのうそ、相当できるようにするところまでやってから、1回出して」（「相当」は「ソート」の誤認識）にカオルさんが「ここまではできるんじゃないかな…大丈夫ですよ」と同意 | 並び順を選ぶと率の高い順に並ぶ。ページ送りしても順序が崩れない |
| FR-003 | フォロワー数・区分・目標エンゲージメント率を、フィールド構成ダイアログ内の判定基準として表示する（一覧の上には重ねて出さない。2026-09-23 ユーザー指示、DRY） | Must | Trello「目標エンゲージメント率 / フォロワー規模別の目標・目安」、MTG 00:29「今のフォロワーを分析し…それだったらこれぐらいは欲しいよね」 | 例「フォロワー 3,200人（ナノ）の目標: 4.0〜6.0%」。フォロワー数が未取得のときは［最新化］を促す案内を表示 |
| FR-004 | 「高エンゲージメント率」の絞り込みをフィールド構成ダイアログ内に追加し、ブログ一覧の「状態でフィルター」と同じ構成（見出し「状態でフィルター」、枠付きのチェック行、既定で畳んだ `details`「絞り込まれる条件」）にし、「絞り込まれる条件」に判定の基準（フォロワー数・区分・目標）・計算式・フォロワー数の時点を入れる。目標達成の投稿には目印を付ける | Must | Trello「高エンゲージメント率を抽出するようにする」、BR-003、2026-09-21 ユーザー指摘「フォロワー数ごとの基準が無いとユーザーが分からない」 | 絞り込み ON で目標達成の投稿だけが表示される。ダイアログを開くと基準の数値が読める。一覧上でも目標達成の投稿が見分けられる |
| FR-005 | ［最新化］のたびに、投稿後7日以内の既存投稿のインサイトを取り直す | Must | FR-001 の値の正しさ（下記「現行の制約」） | 7日以内の投稿は最新化で値が更新され、率も変わる |
| FR-006 | 並び順「エンゲージメント率」と「高エンゲージメント率」を localStorage に保存し、再訪時に復元する。ブログ一覧の状態フィルターと同じ挙動にそろえる（URL 明示時は URL 優先、URL に指定が無いときだけ復元、壊れた値は「絞り込みなし」へ畳む） | Should | 既存の並び順保持（PR #555）、ブログ一覧の状態フィルター（`src/lib/constants.ts` の `parseStatusFilterConfig` / `loadStatusFilterFromStorage`、復元は `AnalyticsTable.tsx:431-464`）、2026-09-21 ユーザー指示「基本的な仕様はブログと揃えたい」 | 再訪時に前回の並び順と絞り込みが、1回の遷移で同時に復元される |
| FR-007 | Instagram 連携時と［最新化］のたびにフォロワー数を取得して保存する | Must | BR-003 の判定に必要。現状フォロワー数は連携設定画面で表示しているだけで DB に保存していない | 最新化後、目標値表示のフォロワー数が Instagram の値に更新される |

**現行の制約（FR-005 の根拠）**: incremental 同期は DB 内の最新 `posted_at` より新しい投稿しか取得せず（`instagramSyncService.syncUserData` のウォーターマーク）、backfill も既存投稿を `getExistingMediaIds` で飛ばす。つまり**インサイトは初回取得時の値で固定される**。投稿直後に［最新化］すると、リーチ・保存が伸びる前の値で率が固定され、率順の並べ替えと目標判定が実態とずれる。

**FR-005 の実装上の決定**:

- ページングを打ち切る基準を、`findWatermarkCutIndex` の「`posted_at <= watermark` の最初の位置」から「`posted_at <= min(watermark, 現在 − 7日)` の最初の位置」へ変える。現行の基準のままでは7日以内の既存投稿は必ず打ち切り範囲に入り、取得されない。
- 1回の上限 `INSTAGRAM_SYNC_MEDIA_LIMIT`（50件）は新着と取り直しの合計で数える。新しい順に並ぶため新着が優先される。API 呼び出し回数の上限は変わらない。
- 取り直した件数は既存の `synced` に数えない（別カウンタ `refreshed`）。数えると新着0件でも毎回「N件を更新しました」とトーストが出て、「更新対象の投稿はありませんでした」が出なくなる。トースト文言は変えない（取り直し件数は表示しない）。
- 新着と取り直しの振り分けは、incremental でも `instagramMediaService.getExistingMediaIds(userId, ids)` を呼び、**既存 ID に含まれるものを `refreshed`、含まれないものを `synced`** に数える。`posted_at <= watermark` の比較で代用しない（前回 50 件上限で溢れた投稿や取得に失敗して DB に入らなかった投稿を「既存」と誤判定し、新着が `refreshed` に流れて「N件を更新しました」から消える）。現行 `getExistingMediaIds` の呼び出しは `mode === 'backfill'` の分岐内だけなので、incremental でも呼ぶように出す。backfill は現行どおり既存 ID を除外する（取り直しは incremental のみ）。
- 取り直しの失敗は `failed` に数えず、`console.error('[Instagram Sync] ...')` で記録するだけにする。前回値が残るため、ユーザーに失敗を知らせる必要がない（BR-004）。
- ただし取り直しの失敗も既存の `consecutiveFailures` には加算し、既存のサーキットブレーカー（`INSTAGRAM_SYNC_CONSECUTIVE_FAILURE_LIMIT` = 5連続で `stoppedReason = 'consecutive_failures'`）をそのまま効かせる。加算しないと Meta 側の障害時に最大50件ぶんの失敗コールを毎回消費する、打ち切りの効かない経路が新設される。`failed` には加算しないため `consecutive_failures` 中断時の既存トースト文言（`${result.synced}件まで更新しました。連続で取得に失敗したため中断しました。`）は変わらない。

**FR-007 の実装上の決定**:

- ［最新化］（incremental）の開始時に `instagramService.fetchProfile` を1回呼び、`followers_count` と `followers_count_synced_at` を更新する。API 呼び出しは1回増える（`checkBudget` のレート計測に含める）。
- backfill（過去投稿の取り込み）では取得しない。直前の incremental か連携時に取得済みのため。
- OAuth callback（`app/api/instagram/oauth/callback/route.ts`）は既に `fetchProfile` を呼んでいるので、その `followersCount` を credentials 保存時に一緒に書く（追加の API 呼び出しなし）。**このとき `followers_count_synced_at` も連携時刻で同時に書く**（callback 内の既存 `now` を使う）。書き込みは `supabaseService.saveInstagramCredential` の **payload・`InstagramCredentialInsertRow` の `record`・`mapInstagramCredentialRow` の3箇所すべてに2列とも**通す。同関数は `upsert(record, { onConflict: 'user_id' })` で、`record` に含めない列は衝突時に更新されないため、型に足すだけでは書き込まれない。
- **不変条件: `followers_count` と `followers_count_synced_at` は常に同時に書き、同時に null にする**（連携時・［最新化］時・アカウント切り替え時のいずれも）。「フォロワー数はあるが取得時刻が無い」状態を作らないため、状態別UI にその行を設けない。BR-005 は「連携時と［最新化］のたびに取得して保存する」と定めており、連携直後（自動同期がまだ走っていない状態）でタブを開くユーザーもこの不変条件で救われる。
- アカウント切り替え時は BR-005 例外2 に従い、`followers_count` / `followers_count_synced_at` を null にリセットする（`fetchProfile` が `followers_count` を返さなかった場合でも旧アカウントの値を残さない）。
- 連携設定画面（`src/server/actions/instagramSetup.actions.ts` の3つ目の `fetchProfile`）のプレビュー値は DB に保存しない（§4 Non-goals）。
- 取得失敗・`followers_count` が返らないときは列を更新しない（BR-005 例外1）。`console.error('[Instagram Sync] ...')` を記録し、同期結果・トーストには影響させない。

### 入力・出力・状態遷移

- 入力値・形式・必須条件:
  - URL パラメータ `ig_sort=engagement_rate`（既存の `posted_at` / `reach` / `views` に追加）
  - URL パラメータ `ig_high`（高エンゲージメント率）。解釈はブログの状態フィルターと同じ優先順位にする。
    - `ig_high=1`: ON
    - `ig_high` がそれ以外の値（`0` 等）: OFF。**URL を優先し、保存値で復元しない**（絞り込みを外した deep link を保存値が上書きしないため）
    - `ig_high` 無し: localStorage の保存値で1回だけ復元する。保存値が無い・壊れているときは OFF。フォロワー数が未取得（目標を判定できない）ときは復元しない。復元は並び順と同じ1回の遷移にまとめる（§10 再利用表の下「「高エンゲージメント率」の保存・復元の契約」）
- 正常時の出力: 一覧に率を表示。並べ替え・絞り込みを反映。目標値を表示。
- エラー時の出力:
  - フォロワー数が未取得: 目標値の代わりに［最新化］を促す案内を表示し、「高エンゲージメント率」と目印を出さない。`ig_high=1` の状態なら絞り込み無しで一覧を返す（黙って0件にしない）。
  - 一覧取得の失敗: 既存どおり。
  - 同期の再取得失敗（FR-005）: DB に書き込まず前回値を保持。`failed` には数えず `console.error` のみ（BR-004）。
  - フォロワー数の取得失敗（FR-007）: 前回値を保持。`console.error` のみ（BR-005 例外1）。アカウント切り替え時は前回値を残さない（BR-005 例外2）。
- 状態と遷移条件: 状態は持たない（URL と DB 値から毎回決まる）。
- 冪等性・重複実行時の挙動: 再取得・フォロワー数の保存は上書きのため何度実行しても同じ結果。

### 画面設計

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| Instagram タブ | `/analytics?tab=instagram` | 既存 | 列・並び順・絞り込み・目標値表示を追加 |

#### 画面ごとの詳細

##### `/analytics?tab=instagram`

- 概要: 既存の Instagram 投稿一覧に、エンゲージメント率まわりの表示・操作を足す。
- レイアウト:

  ```text
  カード見出し:  … [⚙ フィールド構成]      ← 既存ボタン（instagram-field-config-trigger）
  [種別 ▼] [期間 開始〜終了][期間を適用][期間をクリア] [並び順 ▼(投稿日/リーチ/視聴数/エンゲージメント率)]
  フィルター: [↗ 高エンゲージメント率 ×] クリア （前回の絞り込みを復元しました）  ← ON のときだけ。ブログ一覧と同じ形。末尾は復元直後だけ
  ┌────┬──────┬────┬────┬────┬──────┬────┬────┬────┬─────────────┐
  │種別│キャプション│投稿日│リーチ│視聴数│いいね│コメント│保存│エンゲージメント率│
  │    │           │      │      │      │      │        │    │ 6.8% [目標達成]  │
  └────┴──────┴────┴────┴────┴──────┴────┴────┴────┴─────────────┘

  ［フィールド構成］ダイアログ（既存）
  ┌─────────────────────────────┐
  │ フィールド構成                                  │
  │ 表示フィールド                                  │
  │  ☑ 種別  ☑ キャプション … ☑ エンゲージメント率  │
  │ ───────────────────────────  │
  │ 状態でフィルター                                │  ← ブログ一覧（CategoryFilter.tsx）と同じ見出し
  │ ┌ ☑ ↗ 高エンゲージメント率 ─────────────┐ │  ← 本仕様で追加（dialogExtraContent）
  │ │  ▸ 絞り込まれる条件                       │ │  ← 既定は畳む（details）。ブログ一覧と同じ summary
  │ │   ・エンゲージメント率が目標の下限以上の投稿 │ │
  │ │     だけが対象です（フォロワー 3,200人（ナノ）│ │
  │ │     の目標: 4.0〜6.0%）。                  │ │
  │ │   ・エンゲージメント率は（いいね＋コメント＋ │ │
  │ │     保存）÷ リーチ × 100 です。            │ │
  │ │   ・フォロワー数は最後に取得した時点の値です。│ │
  │ └───────────────────────────┘ │
  └─────────────────────────────┘
  ```

  ダイアログ内の配置は既存 `FieldConfigurator` の構成のまま（`src/components/FieldConfigurator.tsx:268,340-344`）。上図は縦に並べて描いているが、実際は **lg 以上では「表示フィールド」が左列、「状態でフィルター」が右列**（左に境界線付き）に並び、幅が狭いときだけ下に並ぶ。右列（「状態でフィルター」節）はフォロワー数が取得済み（目標を判定できる）ときだけ出る。未取得のときは `dialogExtraContent` を渡さず、節ごと出さない（§10 再利用表「「高エンゲージメント率」の置き場所」）。

  **「高エンゲージメント率」はフィールド構成ダイアログの中に置く**（2026-09-21 ユーザー判断。ALT-004）。ブログ一覧が状態フィルターを同じ場所に置いているため（`AnalyticsTable.tsx:883-901` が `FieldConfigurator` の `dialogExtraContent` に `CategoryFilter` を渡す）。既存の種別・期間・並び順は今回は動かさない（同 ALT-004 の却下案B）。

- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | エンゲージメント率（列） | `n.n%` | — | 表示（`defaultVisible: true`） | 列設定で非表示にできる。既存ユーザーの保存済み列設定にも新設列として表示される（`normalizeFieldConfig` の新設列判定） |
  | 目標達成の目印 | バッジ「目標達成」 | — | — | 率 ≧ 目標の下限のときだけ。比較は丸め前の値で行う（表示が「4.0%」でも丸め前が 3.96% ならバッジは付かない。仕様どおり） |
  | 並び順「エンゲージメント率」 | Select の選択肢 | — | 既定は投稿日のまま | 列を非表示にすると既存の `resetSortIfHidden` で投稿日に戻る |
  | 高エンゲージメント率 | チェックボックス | — | OFF | フィールド構成ダイアログ内の「状態でフィルター」節に、ブログ一覧と同じ枠付きの行で置く。目標値を判定できるときだけ表示 |
  | 絞り込まれる条件 | `<details>`（summary「絞り込まれる条件」、本文は箇条書き3行: 「エンゲージメント率が目標の下限以上の投稿だけが対象です（フォロワー N人（区分）の目標: a〜b%）。」「エンゲージメント率は（いいね＋コメント＋保存）÷ リーチ × 100 です。」「フォロワー数は最後に取得した時点の値です。」） | — | 畳んだ状態 | チェック行の直下。ブログ一覧の「評価未設定」「未要約」の「絞り込まれる条件」と同じ構成・文言（2026-09-23 ユーザー指示「ブログ一覧のフィールド構成と UI を合わせる」）。目標値はここにだけ出す（FR-003） |
  | フィルター表示 | 「フィルター:」+ タグ「高エンゲージメント率」（× で解除）+「クリア」。復元直後だけ末尾に「（前回の絞り込みを復元しました）」 | — | — | 「高エンゲージメント率」が ON のときだけ一覧の上に出す。ブログ一覧のフィルター表示（`AnalyticsTable.tsx` の「フィルター:」行）と同じ構成・文言。解除ボタンは hover で文字を出さない（`title` ではなく `aria-label`）。色は生のパレットではなくトークン（`bg-secondary` 等）。目標値は出さない（FR-003）。フォロワー数が未取得のときは代わりに下表の案内を出す |

- 状態別UI:

  | 内部状態 | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 率を算出できる投稿 | `6.8%`（目標達成ならバッジ） | — | — |
  | 元数値のどれかが未取得／リーチ 0 | `-` | — | 並べ替えでは末尾。目標判定しない |
  | インサイト取得対象外（転換前・2年超） | 既存の「対象外」表示 | — | 並べ替えでは末尾。目標判定しない |
  | フォロワー数を取得済み | 目標値を表示（全6区分のどれかに必ず当たる） | 「高エンゲージメント率」 | — |
  | フォロワー数が未取得（既存の連携ユーザーが本機能リリース後にまだ［最新化］していない） | 「［最新化］するとフォロワー数を取得し、目標エンゲージメント率を表示します」 | ［最新化］ | 「高エンゲージメント率」・目印なし |
  | フォロワー数は取得済みだが、投稿の元数値が恒常的に取れない（100フォロワー未満のアカウント等。§10 制約条件の公式引用） | 目標値は表示され、各投稿は `-`（上の「元数値のどれかが未取得」と同じ扱い） | 「高エンゲージメント率」 | 専用の案内文言・分岐は作らない。ON にすると下行の0件表示になる（R-005） |
  | 高エンゲージメント率 ON で該当0件 | 既存の0件表示文言のうち**絞り込みあり側**（「表示条件に一致する投稿がありません。…」）。`ig_high` を既存の `hasFilter` 判定（`InstagramTab.tsx:365`）に含めることでこちらに入る。文言自体は変えない。絞り込み中であることは一覧の上のフィルター表示で分かる | フィルター表示のタグの × か「クリア」、またはフィールド構成ダイアログのチェックを外す | — |
  | 高エンゲージメント率 ON で復元された直後 | 一覧の上のフィルター表示の末尾に「（前回の絞り込みを復元しました）」が出る（ブログ一覧と同じ）。利用者が絞り込みを操作すると消える | フィルター表示のタグの × か「クリア」 | — |

- ツールチップ文言:
  - 列: 出さない。一覧のセル（エンゲージメント率と既存の率の列）はホバーで文字を出さない（2026-09-23 ユーザー指示）。式はフィールド構成ダイアログ内の「絞り込まれる条件」で示す。「対象外」の理由のツールチップは既存のまま残す
  - 目標値: 出さない（2026-09-23 に一覧の上の目標値の行ごと廃止）。フォロワー数の時点はダイアログ内の「（フォロワー数は最後に取得した時点の値）」で示す
- 画面遷移: 変更なし
- UI用語: `.agents/skills/growmate-ui-ux/ui-text.md` の用語辞書を次のとおり更新する。
  - 「エンゲージメント率」は**既存行（`ui-text.md` の「エンゲージメント率 ｜ 読み始め率 ｜ ✅」行）の補足を書き換え**、GA4 由来（`engagementRate` をそのまま出す）と Instagram 由来（本書 BR-001 の式で GrowMate が算出）の2定義を**同一行に併記**する。新規行を足さない（辞書の原則「同じ対象は必ず同じ語で呼ぶ」に反し、同じ語が2行に分かれるため）。
  - 「目標エンゲージメント率」「目標達成」「高エンゲージメント率」（絞り込み名）は辞書に無い新しい語なので新規行として追加する。

#### 誤読しやすい罠

- 同じ `/analytics` のブログ一覧側には GA4 の「エンゲージメント率」（`engagementRate`）がある。**Instagram タブの列と同じ名前だが定義が違う**。タブが分かれており、クライアント自身がこの呼び方をしているため名前は揃えるが、フィールド構成ダイアログ内の「絞り込まれる条件」で式を必ず出す（R-002）。
- **絞り込みの置き場所が2箇所に分かれる。** 今回追加する「高エンゲージメント率」はフィールド構成ダイアログ内、既存の種別・期間はタブ上部の行にある。ブログ一覧は絞り込みがすべてダイアログ内にあるため、Instagram タブだけこの不揃いが残る（ALT-004 で受容）。
- 目標の判定には**現在の**フォロワー数を使う。フォロワーが区分をまたいで増減すると、過去の投稿の「目標達成」も変わる。

### 権限

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| admin | ○ | ○（最新化） | — | — |
| paid | ○ | ○（最新化） | — | — |
| trial / unavailable | × | × | — | — |

サーバー側の認可は既存のまま（`app/analytics/page.tsx` の `canAccessGa4`、同期 Server Action の `canAccessInstagram`）。新しい Server Action・Route Handler・RPC は追加しない。

## 7. Gherkin受け入れ条件

```gherkin
Feature: Instagram 投稿のエンゲージメント率と目標判定

  Rule: エンゲージメント率 = (いいね + コメント + 保存) ÷ リーチ × 100

  Scenario: 投稿のエンゲージメント率を表示する
    Given いいね 90・コメント 5・保存 25・リーチ 2000 の投稿がある
    When Instagram タブを開く
    Then その投稿のエンゲージメント率に「6.0%」と表示される

  Scenario: 元の数値が欠けている投稿は率を出さない
    Given 保存数を取得できていない投稿がある
    When Instagram タブを開く
    Then その投稿のエンゲージメント率は「-」と表示される

  Scenario: エンゲージメント率の高い順に並べ替える
    Given 率が 3.0% と 7.5% の投稿と、率を算出できない投稿がある
    When 並び順で「エンゲージメント率」を選ぶ
    Then 7.5% の投稿、3.0% の投稿、率を算出できない投稿の順に並ぶ

  Scenario: 並び順「エンゲージメント率」が再訪時に復元される
    Given 並び順に「エンゲージメント率」を選んで Instagram タブを離れた
    When もう一度 Instagram タブを開く
    Then 並び順は「エンゲージメント率」で復元される

  Scenario: 「高エンゲージメント率」が再訪時に復元される
    Given 「高エンゲージメント率」をオンにして Instagram タブを離れた
    When もう一度 Instagram タブを開く
    Then 「高エンゲージメント率」はオンで復元される

  Scenario: 並び順と「高エンゲージメント率」が1回の遷移で同時に復元される
    Given 並び順「エンゲージメント率」と「高エンゲージメント率」ON の両方を保存して Instagram タブを離れた
    When もう一度 Instagram タブを開く
    Then 並び順は「エンゲージメント率」、「高エンゲージメント率」はオンで、どちらも同時に復元される
    And 一方の復元がもう一方を打ち消さない

  Scenario: 並び順が既定のままでも「高エンゲージメント率」は復元される
    Given 並び順は「投稿日」のまま、「高エンゲージメント率」をオンにして Instagram タブを離れた
    When もう一度 Instagram タブを開く
    Then 「高エンゲージメント率」はオンで復元される
    And 並び順は「投稿日」のまま

  Scenario: 復元された直後に絞り込み中であることが一覧の上に出る
    Given フォロワー数が 3,200 人（目標 4.0〜6.0%）である
    And 「高エンゲージメント率」をオンにして Instagram タブを離れた
    When もう一度 Instagram タブを開く
    Then 一覧の上に「フィルター:」と「高エンゲージメント率」のタグが表示される
    And その末尾に「（前回の絞り込みを復元しました）」と表示される

  Scenario: URL の指定が保存値より優先される
    Given 「高エンゲージメント率」をオンにして Instagram タブを離れた
    When ig_high=0 を指定した URL を開く
    Then 「高エンゲージメント率」はオフで表示され、全投稿が出る

  Scenario: 保存値が壊れていても絞り込まない
    Given localStorage の「高エンゲージメント率」の保存値が壊れている
    When Instagram タブを開く
    Then 「高エンゲージメント率」はオフで表示され、全投稿が出る

  Rule: フォロワー規模別の目標の下限以上を「目標達成」とする

  Scenario Outline: フォロワー数から目標エンゲージメント率を決める
    Given フォロワー数が <フォロワー数> 人である
    When Instagram タブを開く
    Then フィールド構成ダイアログの判定基準に「<目標>」と表示される

    Examples:
      | フォロワー数 | 目標        |
      | 0            | 6.0〜10.0%  |
      | 999          | 6.0〜10.0%  |
      | 1000         | 4.0〜6.0%   |
      | 4999         | 4.0〜6.0%   |
      | 5000         | 3.0〜4.5%   |
      | 10000        | 2.0〜3.5%   |
      | 50000        | 1.5〜2.5%   |
      | 99999        | 1.5〜2.5%   |
      | 100000       | 0.8〜1.5%   |

  Scenario: 絞り込みの基準がダイアログの中で読める
    Given フォロワー数が 3,200 人（目標 4.0〜6.0%）である
    When フィールド構成を開く
    And 「絞り込まれる条件」を開く
    Then 「フォロワー 3,200人（ナノ）の目標: 4.0〜6.0%」と表示される
    And 「フォロワー数は最後に取得した時点の値です。」と表示される

  Scenario: 絞り込まれる条件は既定で畳まれている
    Given フォロワー数が 3,200 人（目標 4.0〜6.0%）である
    When フィールド構成を開く
    Then 条件は畳まれていて、「絞り込まれる条件」とだけ表示される

  Scenario: 計算式を開くと読める
    Given フォロワー数が 3,200 人（目標 4.0〜6.0%）である
    And フィールド構成を開いている
    When 「絞り込まれる条件」を開く
    Then 「エンゲージメント率は（いいね＋コメント＋保存）÷ リーチ × 100 です。」と表示される

  Scenario: 目標を達成した投稿だけに絞り込む
    Given フォロワー数が 3,200 人（目標 4.0〜6.0%）である
    And 率が 3.5%・4.0%・6.8% の投稿がある
    When 「高エンゲージメント率」をオンにする
    Then 4.0% と 6.8% の投稿だけが表示される
    And 表示された投稿に「目標達成」の目印が付く

  Scenario: フォロワー数をまだ取得していない
    Given 本機能のリリース前から連携していて、リリース後にまだ最新化していない
    When Instagram タブを開く
    Then 最新化するとフォロワー数を取得して目標を表示する旨が表示される
    And 「高エンゲージメント率」と「目標達成」の目印は表示されない
    And 保存済みの「高エンゲージメント率」があっても復元されない

  Scenario: フォロワー数が未取得のまま「高エンゲージメント率」付きの URL を開く
    Given フォロワー数を取得していない
    And 投稿が3件ある
    When ig_high=1 が付いた URL を開く
    Then 絞り込みは適用されず、投稿が3件すべて表示される
    And 「高エンゲージメント率」と「目標達成」の目印は表示されない

  Scenario: 最新化でフォロワー数が更新される
    Given 保存済みのフォロワー数が 4,900 人である
    And Instagram 上のフォロワー数が 5,100 人に増えている
    When 最新化する
    Then フィールド構成ダイアログの判定基準に「3.0〜4.5%」と表示される

  Scenario: フォロワー数の取得に失敗しても前回の値で判定する
    Given 保存済みのフォロワー数が 3,200 人である
    When 最新化でフォロワー数の取得が失敗する
    Then 投稿の同期は通常どおり完了する
    And フィールド構成ダイアログの判定基準は「4.0〜6.0%」のまま表示される

  Scenario: 別の Instagram アカウントに連携し直す
    Given フォロワー 50,000 人のアカウントで連携していて、保存済みのフォロワー数が 50,000 人である
    When フォロワー 800 人の別の Instagram アカウントで連携し直す
    Then フィールド構成ダイアログの判定基準に「6.0〜10.0%」（800 人の区分）と表示される
    And 旧アカウントのフォロワー数では判定されない

  Rule: 投稿後7日以内の投稿は最新化のたびに取り直す

  Scenario: 投稿直後の値で率が固定されない
    Given 2日前の投稿を最新化で取得済みで、その後いいねと保存が増えた
    When 最新化する
    Then その投稿のエンゲージメント率が増えた後の数値で表示される

  Scenario: 7日を過ぎた投稿は取り直さない
    Given 10日前の投稿を取得済みである
    When 最新化する
    Then その投稿のインサイトは取り直されない

  Scenario: 取り直しに失敗しても前回の値を残す
    Given 2日前の投稿の値を取得済みである
    When 最新化でその投稿のインサイト取得が失敗する
    Then その投稿のエンゲージメント率は前回の値のまま表示される

  Scenario: 対象外のロールは使えない
    Given trial ロールのユーザーである
    When /analytics?tab=instagram を開く
    Then 権限が無い旨の画面に移る
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 投稿のエンゲージメント率を表示する | FR-001 | BR-001 |
| 元の数値が欠けている投稿は率を出さない | FR-001 | BR-002 |
| エンゲージメント率の高い順に並べ替える | FR-002 | BR-002 |
| 並び順「エンゲージメント率」が再訪時に復元される | FR-006 | 既存の並び順保存（PR #555） |
| 「高エンゲージメント率」が再訪時に復元される | FR-006 | ブログ一覧の状態フィルターと同じ挙動 |
| 並び順と「高エンゲージメント率」が1回の遷移で同時に復元される | FR-006 | §10 再利用表「高エンゲージメント率」の保存・復元の契約3（1本の effect・1回の `router.replace`） |
| 並び順が既定のままでも「高エンゲージメント率」は復元される | FR-006 | 同上 契約3（並び順と `ig_high` の復元可否は別々に判定） |
| 復元された直後に絞り込み中であることが一覧の上に出る | FR-003, FR-006 | §6 項目定義「目標エンゲージメント率」、ALT-004 |
| URL の指定が保存値より優先される | FR-006 | 同上（URL 優先） |
| 保存値が壊れていても絞り込まない | FR-006 | 同上（既定は絞り込みなし） |
| フォロワー数から目標エンゲージメント率を決める | FR-003 | BR-003 |
| 絞り込みの基準がダイアログの中で読める | FR-004 | BR-003、2026-09-21 ユーザー指摘 |
| 計算式は既定で畳まれている | FR-004 | BR-001、2026-09-21 ユーザー指示（開閉できるようにする） |
| 計算式を開くと読める | FR-004 | 同上 |
| 目標を達成した投稿だけに絞り込む | FR-004 | BR-003 |
| フォロワー数をまだ取得していない | FR-003, FR-007 | BR-005 |
| フォロワー数が未取得のまま「高エンゲージメント率」付きの URL を開く | FR-004 | BR-003（判定しない） |
| 最新化でフォロワー数が更新される | FR-007 | BR-005 |
| フォロワー数の取得に失敗しても前回の値で判定する | FR-007 | BR-005 例外1 |
| 別の Instagram アカウントに連携し直す | FR-007 | BR-005 例外2 |
| 投稿直後の値で率が固定されない | FR-005 | BR-004 |
| 7日を過ぎた投稿は取り直さない | FR-005 | BR-004 |
| 取り直しに失敗しても前回の値を残す | FR-005 | BR-004 |
| 対象外のロールは使えない | 権限 | CLAUDE.md Core Rules |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | クエリ本数は増えない（credentials の読み取りは既存。`page.tsx:205-215` が `instagramMediaService.getPage` と `supabaseService.getInstagramCredential` を `Promise.all` で並列実行済み）。ただし `ig_high=1` のときだけ、目標下限の決定に credential が要るため両者が credential → `getPage` の逐次になり、この経路のレイテンシは `max(a,b)` から `a+b` になる。FR-006 の自動復元により、一度 ON にしたユーザーの再訪時はこの経路が既定になる | 画面確認 | 1ユーザー数千件までは無索引で許容（既存判断を踏襲） |
| 可用性・信頼性 | フォロワー数が取れなくても一覧・同期は動く | 単体テスト | BR-005 |
| セキュリティ・プライバシー | フォロワー数は公開情報。新たな機密情報の扱いなし | — | 対象外 |
| 認証・認可 | 既存の Instagram タブ・同期と同じ | コードレビュー | §6 権限 |
| 監査・ログ | フォロワー数取得失敗・取り直し失敗を `console.error` で記録 | 単体テスト | 既存パターン |
| 障害対応 | デプロイ巻き戻し | — | 停止機構は作らない（CLAUDE.md） |
| バックアップ・復旧 | 生成列は元数値から再計算、フォロワー数は次回の最新化で取り直せるため対象外 | — | 対象外 |
| 運用・監視 | 追加なし | — | 対象外 |
| 拡張性・互換性 | 既存の保存済み列設定・並び順保存と共存 | 単体テスト | FR-006 |
| アクセシビリティ | チェックボックスにラベル、バッジは色だけに頼らず文字「目標達成」 | 画面確認 | growmate-ui-ux |
| コスト | Graph API 呼び出しが［最新化］1回あたり「フォロワー数 1回 ＋ 投稿後7日以内の既存投稿数」増える（毎日1投稿なら最大8回）。既存の時間予算・レート閾値（`checkBudget`）の範囲内 | 単体テスト | FR-005, FR-007 |

### AI機能の追加観点

対象外（Phase 1 に LLM 呼び出しは無い）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ:
  - `instagram_media.engagement_rate`: 生成列（`GENERATED ALWAYS AS (...) STORED`）。`like_count` / `comments_count` / `saved` / `reach` がすべて非 NULL かつ `reach > 0` のとき `(like_count + comments_count + saved)::numeric / reach * 100`、それ以外は NULL。**丸めずに保存**し、表示時に小数第1位へ丸める（目標との比較・並べ替えは丸め前の値で行う）。
  - `instagram_credentials.followers_count int`（NULL 可）/ `followers_count_synced_at timestamptz`（NULL 可）。
    - `followers_count_synced_at` を新設する理由（既存 `last_synced_at` を使わない理由）: `last_synced_at` は同期そのものの完了時刻で、BR-005 例外1（フォロワー数の取得に失敗しても同期は完了する）のときにフォロワー数が更新されないまま進む。また OAuth callback はフォロワー数と `followers_count_synced_at` を保存するが `last_synced_at` は触らない（`last_synced_at` を進めるのは incremental 完了時だけ）ため、連携直後は `last_synced_at` が null のまま値が入る。よって §6 ツールチップの「いつ時点の値か」には `last_synced_at` を使えない。
  - 目標値の表（BR-003）はコード上の定数とし、判定は純関数（例: `getInstagramEngagementTarget(followersCount)` → `{ tier, min, max } | { reason: 'unknown' | 'below_range' | 'above_range' }`）に置く。DB には持たない。
- データの所有者: 各ユーザー（既存 `instagram_media` / `instagram_credentials` の RLS のまま）
- 保持期間・削除条件: 既存に従う（連携解除時の削除も既存処理）
- 移行・既存データとの互換性:
  - 生成列は既存行も追加時点で自動計算される。バックフィル不要。元数値が欠けた既存行は NULL（`-` 表示）。
  - 移行対象行数の概算: `instagram_media` は「1ユーザーあたり数千件までは許容」を上限として設計している（`instagramMediaService.getPage` の JSDoc）。全体は 連携ユーザー数 × 最大数千件 で、本番の実行数は未確認。`instagram_credentials` は連携ユーザー数と同じ行数（列追加のみでデフォルト値なしのため書き換えは発生しない）。
  - 既存の連携ユーザーは `followers_count` が NULL。次回の［最新化］で入る。それまでは「最新化すると…」の案内を出す（§6 状態別UI）。再連携は不要。
  - アカウント切り替え（別の Instagram アカウントで連携し直す）: 既存処理が `purgeInstagramData` で投稿を消し、`backfillCursor` / `backfillCompletedAt` / `lastSyncedAt` を null に戻す。本書で追加する `followers_count` / `followers_count_synced_at` も同じブロックで null に戻す（BR-005 例外2）。
- RLS・Service Role・ユーザー境界: 一覧取得・credentials の読み書きとも既存どおり Service Role クライアント経由で、明示的に `user_id` を指定する。
- 絞り込み: `ig_high=1` のとき、サーバーで目標の下限を決めて `getPage` に渡し、`gte('engagement_rate', 下限)` を DB クエリに足す。下限の決定には `getInstagramCredential` の `followers_count` が要るため、この経路だけ `page.tsx:205-215` の `Promise.all`（`getPage` と `getInstagramCredential` の並列）が credential → `getPage` の逐次になる（クエリ本数は増えない。§8 性能）。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Instagram Graph API | 7日以内の既存投稿のインサイト再取得（FR-005） | 既存の `GET /{media-id}/insights`、`instagram_business_manage_insights`（新規パーミッションなし） | DB に書き込まず前回値を保持（BR-004） | [IG Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)・[Insights](https://developers.facebook.com/docs/instagram-platform/insights/)（確認日 2026-09-20。引用は §10 制約条件） |
| Instagram Graph API | フォロワー数の取得（FR-007） | 既存の `GET /me?fields=...followers_count`（`fetchProfile`）、`instagram_business_basic` | 前回値を保持（BR-005 例外1）。アカウント切り替え時は null リセット（例外2） | [IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/)（確認日 2026-09-20。`followers_count` のフィールド定義・権限を確認。引用は §10 制約条件4）。あわせて既存仕様 `instagram-integration-design.md` §2 スコープ表（アカウント情報） |

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js App Router / Supabase / 既存 Instagram 同期
- 再利用する既存実装:

  | 対象 | 方針 | 根拠 path |
  | --- | --- | --- |
  | 一覧取得・並べ替え | 拡張（`sort` に `engagement_rate` 追加、目標下限による絞り込みを追加） | `src/server/services/instagramMediaService.ts` `getPage` |
  | 並べ替えキーの型・解析 | 拡張。`app/analytics/page.tsx:151` の独自解析は `parseInstagramSortKey` に置き換えて1箇所にする | `src/types/instagram.ts` `InstagramMediaSortKey`、`src/lib/constants.ts` `parseInstagramSortKey` |
  | 列定義・列設定 | 拡張（`INSTAGRAM_COLUMNS` に追加するだけで保存済み設定にも出る。`fieldConfig.schema.ts` も `INSTAGRAM_COLUMNS` から作られる） | `src/lib/constants.ts`、`src/lib/field-config.ts` `normalizeFieldConfig` |
  | 率の表示 | 再利用（`formatInstagramRate` だけを使う。`calculateInstagramRate` は計算の中で丸めるため、この列には使わない。一覧のセルにツールチップは付けない） | `src/lib/instagram-format.ts`、`InstagramMediaTable.tsx` `RateCell` |
  | 目標判定の純関数 | 新規（同ファイルに追加。既存に同等物なし） | `src/lib/instagram-format.ts` |
  | 一覧の型・マッパー | 拡張（`InstagramMediaListItem.engagementRate: number \| null`、`mapMediaRow` に追加） | `src/types/instagram.ts`、`instagramMediaService.ts` `mapMediaRow` |
  | 並べ替えキーの列挙箇所 | 拡張。**列 id と sort key はどちらも `engagement_rate`** にする（並び順の復元処理が `visibleIds.includes(stored)` で判定するため）。対象: `InstagramMediaSortKey`、`parseInstagramSortKey`、`page.tsx` の解析、`InstagramTab.tsx` の SelectItem、`InstagramMediaTable.tsx` の `SORTABLE_COLUMN_IDS` と `sortColumnId`（現行は三項演算子で、該当しないと `'views'` になる。追加しないと視聴数の列を隠したときに率の並べ替えが解除され、率の列を隠しても解除されない） | 左記 |
  | `ig_high` の受け渡し | 拡張。**並び順キーと同様に列挙箇所を漏らさない**（1つ落ちると patch 未指定の href で `ig_high` が毎回消える）。対象: `AnalyticsHrefState`（`app/analytics/build-href.ts:11-27`）、`InstagramHrefPatch`（同 `:29-36`）、`buildInstagramHref` の `ig_*` を組み立てる2つの分岐（同 `:81-99`。`patch.tab==='blog'` 側も含む）、`InstagramFilterPatch`（同 `:108-114`）、`InstagramTab` props のインライン patch 型（`app/analytics/components/InstagramTab.tsx:57-63`）、`app/analytics/page.tsx` のパラメータ取り出し（`page.tsx:115-120`）と `buildPageHref`（同 `:235-266`）、`AnalyticsClient` の `hrefState`（`app/analytics/AnalyticsClient.tsx:149-163`）と `InstagramTab` への props、**`InstagramMediaTable` の props**（`app/analytics/components/InstagramMediaTable.tsx:33-47`。現行は5つだけ。`igHigh`・変更ハンドラ・ダイアログ内に出す判定基準の文言（`string | null`。null は「目標を判定できない」＝表示しない、を兼ねる）の3つを足し、`InstagramTab.tsx:585-591` から渡す）、**`InstagramTab` の props にフォロワー数 `followersCount: number | null` と取得時刻 `followersCountSyncedAt: string | null`**（`InstagramTab.tsx:36-66` には現行フォロワー関係の props が無い。`page.tsx` が読む credential から、既存の `instagramLastSyncedAt` と同じく `page.tsx` → `AnalyticsClient.tsx` の props → `InstagramTab` の経路で渡す。「目標を判定できるか」は `followersCount !== null` で決め、契約3 の復元可否と §6 のチェックボックス表示条件はこの値を使う。取得時刻は §6 目標値のツールチップの日付に使う） | 左記 |
  | 目標値の文言の整形 | 新規（1関数。ダイアログ内の判定基準（FR-003 / FR-004「フォロワー N人（区分）の目標: a〜b%」）を作る。`InstagramTab` が `followersCount` から目標判定の純関数経由で文言を作り、`InstagramMediaTable` へ渡す。2箇所で別々に組み立てない（§6 項目定義「高エンゲージメント率の補足」） | `src/lib/instagram-format.ts`（目標判定の純関数と同居。現行の export は `formatCount` / `formatPostedAt` / `calculateInstagramRate` / `formatInstagramRate` / `formatSkipRate` / `formatDurationMs` のみで同等物なし） |
  | 並び順の保存・復元 | **拡張**（既存の復元 effect に `ig_high` を合流させる。下行のとおり1本の effect で両方を戻す） | `InstagramTab.tsx` `saveInstagramSort` / 復元 effect（`InstagramTab.tsx:323-337`） |
  | 絞り込まれる条件の開閉 | 再利用。ブログ一覧の状態フィルターと同じ `details` + `summary`「絞り込まれる条件」（既定で畳む）と、同じ枠付きの行。新しい開閉コンポーネントは作らない | `src/components/CategoryFilter.tsx`（「評価未設定」「未要約」の行） |
  | 「高エンゲージメント率」の置き場所 | 再利用（拡張なし）。`FieldConfigurator` の既存 props `dialogExtraContent` に渡すだけ（ブログ一覧と同じ使い方）。Instagram 側は現在 children（render prop）だけを渡しているので、`dialogExtraContent` を足す。チェックの値・変更ハンドラ・判定基準の文言は `InstagramMediaTable` が持たず、`InstagramTab` から props で受ける（上の「`ig_high` の受け渡し」行）。**「絞り込み」見出しは Instagram 側が `dialogExtraContent` の中で描く**（`FieldConfigurator` は右列の枠だけを描き見出しを描かない。`src/components/FieldConfigurator.tsx:340-344`。ブログ側も `CategoryFilter` が自前で見出しを描く。`src/components/CategoryFilter.tsx:101`）。**目標を判定できない（判定基準の文言が null）ときは `dialogExtraContent` を渡さず、「絞り込み」節ごと出さない**（`FieldConfigurator.tsx:340` は `dialogExtraContent` 未指定なら右列自体を描かない）。トリガーは既存の `instagram-field-config-trigger` ボタンをそのまま使う | `src/components/FieldConfigurator.tsx`（`dialogExtraContent`）、`src/components/AnalyticsTable.tsx`（ブログ側の使い方）、`app/analytics/components/InstagramMediaTable.tsx`、`app/analytics/components/InstagramTab.tsx`（トリガー） |
  | 「高エンゲージメント率」の保存・復元 | 拡張。`ANALYTICS_STORAGE_KEYS` に `IG_HIGH_ONLY: 'analytics.instagramHighOnly'` を追加し、解釈は純関数（壊れた値・欠けた値は `false` へ畳む。既定を「絞り込みあり」にしない）。**ブログ側の `parseStatusFilterConfig` / `loadStatusFilterFromStorage`（`src/lib/constants.ts:542` / `:561`）と同じ設計**（localStorage に触らない純関数にして node environment でテストできるようにする）。契約は表の下の4点 | `src/lib/constants.ts`、`src/components/AnalyticsTable.tsx`、`InstagramTab.tsx` |
  | フォロワー数の取得 | 再利用（`fetchProfile` は `followers_count` を取得済み） | `src/server/services/instagramService.ts` `fetchProfile` |
  | credentials の型・読み書き | 拡張（`InstagramCredential` に `followersCount` / `followersCountSyncedAt`、`updateInstagramCredential` 相当で部分更新） | `src/types/instagram.ts`、`src/server/services/supabaseService.ts` |
  | 連携時の保存 | 拡張（既に取得済みの `profileResult` から保存）。**`upsert(record, { onConflict: 'user_id' })` は `record` に無い列を衝突時に更新しない**ため、`saveInstagramCredential` の payload 型・`record`（`InstagramCredentialInsertRow`）・`mapInstagramCredentialRow` の3箇所すべてに列を通す。型追加だけでは書き込まれない | `app/api/instagram/oauth/callback/route.ts`、`src/server/services/supabaseService.ts` `saveInstagramCredential` / `mapInstagramCredentialRow` |
  | アカウント切り替え時の状態リセット | 拡張（`followers_count` / `followers_count_synced_at` を既存のリセット対象に足す） | `app/api/instagram/oauth/callback/route.ts`（`existingCredential.igUserId !== profile.igUserId` の分岐）、`supabaseService.updateInstagramCredential` |
  | 新着と取り直しの振り分け | 拡張（`getExistingMediaIds` を incremental でも呼ぶ。現行は `mode === 'backfill'` の分岐内だけ） | `src/server/services/instagramMediaService.ts` `getExistingMediaIds`、`instagramSyncService.ts` |
  | 再取得の upsert | 再利用（`upsertMedia`。失敗時は書き込まない） | `instagramSyncService.ts` / `instagramMediaService.ts` |
  | 率の計算を TS で持つ案 | **採用しない**。DB 側で並べ替え・目標比較をするため、計算は生成列の1箇所に置く（ALT-001） | — |

- 「高エンゲージメント率」の保存・復元の契約（上表の同名行の詳細）:

  1. **保存の集約**: 保存は ON / OFF いずれの切り替えでも**必ず1箇所**で行う（ブログの `pushFilterQuery` 内集約と同じ。`AnalyticsTable.tsx:368-370` verbatim「**状態フィルターの永続化はここに集約する。** 呼び出し側（トグル・タグ解除・クリア）ごとに書くと、増えたときに書き漏れる」）。トグル・解除の各所に書かない。OFF を保存しないと、外した絞り込みが再訪時に復活して解除できなくなる。
  2. **保存書式**: `ig_sort` と同じ生文字列に統一し、`'1'`（ON）/ `'0'`（OFF）だけを書く（ブログ側の `JSON.stringify(config)` 形式は値が3つある状態フィルター用で、真偽値1つには使わない）。読み取り純関数は `'1'` のみを ON とし、それ以外・未設定・壊れた値は `false` へ畳む。
  3. **復元**: **並び順と `ig_high` は1本の effect・1回の `router.replace` で同時に戻す**（patch に `igSort` と `igHigh` の両方を載せる）。2回に分けると後の replace が先の replace の条件を落とす — `buildFilterHref` はその描画時点の `hrefState`（`AnalyticsClient.tsx:149-163`）から URL を全再構築するため、patch に無い条件は復元前の state 由来の値に戻る（`AnalyticsTable.tsx:448-449` verbatim「**カテゴリと状態を1回の push で戻す。** 2回に分けると後の push が先の push の内容を落とす（URL が正本なので、渡さなかった条件は消える）」と同じ理由）。復元するのは URL に `ig_sort` / `ig_high` がそれぞれ無いときだけで、どちらも復元対象が無ければ遷移しない。さらに**フォロワー数が未取得（目標を判定できない）ときは `ig_high` を復元しない**（`InstagramTab.tsx:331-334` verbatim「**非表示の列を指す並び順は復元しない。** 復元しても resetSortIfHidden がすぐ既定へ戻すので、無駄な画面遷移が1回増えるだけになる」と同じ理由。チェックボックスが画面に無いのに URL だけ `ig_high=1` になる無駄な遷移を作らない。判定できるかどうかは §6 状態別UI のチェックボックス表示条件と同じ値で決める）。**並び順と `ig_high` の復元可否は別々に判定する。** 現行の復元 effect は「URL に `ig_sort` がある」「保存値が `posted_at`」「並び順が指す列が非表示」のどれかで effect 全体を return する（`app/analytics/components/InstagramTab.tsx:328` / `:330` / `:334`）。この3条件は**並び順を patch に載せるかどうかの判定だけ**にとどめ、effect 全体を return させない。そのまま統合すると、よくある「並び順は既定のまま（保存値 `posted_at`）で高エンゲージメント率 ON」の組み合わせで `ig_high` が復元されない。同様に `ig_high` 側の条件（URL に `ig_high` がある・保存値が OFF・目標を判定できない）も並び順の復元を止めない。
  4. **0件表示の判定**: `ig_high` を既存の `hasFilter`（`InstagramTab.tsx:365`。現行は `igStart` / `igEnd` / `igType` のみ）に含める。含めないと「高エンゲージメント率」で0件になったとき「まだ投稿がありません。「過去の投稿をインポート」を押してください」（同 `:369`）が出て、無関係なインポートへ誘導する（§6 状態別UI）。

### 制約条件

- 納期・予算・人員: 遠藤1名
- 法令・契約・審査: Meta App Review で承認済みのパーミッションの範囲内
- 変更できない既存仕様: 既存の率の列（いいね率・保存率等）は変更しない
- 外部API（Meta 公式ドキュメント。いずれも確認日 2026-09-20）:

  1. 指標の遅延と保持期間 — 出典: <https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/>
     - 公式引用（verbatim）: "Data used to calculate metrics can be delayed up to 48 hours." / "Metrics data is stored for up to 2 years."
     - 引用から導いた解釈（引用と分離）: BR-004 の再取得期間「投稿後7日以内」は 48 時間の遅延より長いため、遅延が原因で取り直しの機会を逃すことはない。2年の保持は §6 状態別UI の「2年超は対象外」（既存の `retention_expired`）と整合する。
  2. 100フォロワー未満のアカウント — 出典: <https://developers.facebook.com/docs/instagram-platform/insights/>
     - 公式引用（verbatim）: "Some metrics are not available on Instagram accounts with fewer than 100 followers." / "If insights data you are requesting does not exist or is currently unavailable the API will return an empty data set instead of `0` for individual metrics."
     - 引用から導いた解釈（引用と分離）: **どの指標が 100 フォロワー未満で提供されないかは公式に列挙が無く、未確認**。欠けた指標は BR-002 の `-` 表示で扱い、専用の分岐・案内文言は作らない（§6 状態別UI・R-005）。空データは `0` ではないため、`reach` を 0 と誤読して率を 0% と算出することはない（BR-002 の「リーチ 0 以下は算出しない」とも重ならない）。
  3. レート上限 — 出典: <https://developers.facebook.com/docs/graph-api/overview/rate-limiting>
     - 公式引用（verbatim）: "Calls within 24 hours = 4800 * Number of Impressions"
     - 引用から導いた解釈（引用と分離）: §8 コストの「［最新化］1回あたり最大8回増（毎日1投稿の場合）」はこの上限を制約しない。既存の `checkBudget`（レート計測）の範囲内。
  4. `followers_count` のフィールド定義 — 出典: <https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/>
     - 公式引用（verbatim）: `followers_count` の説明は "Total number of Instagram users following the user."。フィールド種別は "Public"、Instagram Login 経路の必要権限は `instagram_business_basic`。
     - 引用から導いた解釈（引用と分離）: 綴り `followers_count` は `instagramService` の `PROFILE_FIELDS` と一致し、必要権限は §9 外部連携表および既存の `INSTAGRAM_OAUTH_SCOPES` に含まれる。よって FR-007 は**新規パーミッション不要**で、§4 対象範囲・本節の前提と矛盾しない。なお同ページに「フォロワー数が少ないと `followers_count` が返らない」旨の記載は無く、**BR-005 例外1（返らないときは列を更新しない）は公式に裏付けられた挙動ではなく防御的な実装方針**である（本書はこれを公式根拠として主張していない）。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| Instagram 連携 Phase 2 | 実装済み | 本番稼働中 | — |
| 期間の既定を全期間へ変更（2026-09-16） | develop 反映済み | `getPage` コメント | — |

## 11. トレードオフ判断

### ALT-001: エンゲージメント率をどこで計算するか

- 判断: DB の生成列で計算する
- 比較した案:
  - 案A: `instagram_media` の生成列（STORED）
  - 案B: 表示時に TS（`calculateInstagramRate`）で計算
  - 案C: 同期時に TS で計算して通常列に保存
- 採用案: 案A
- 採用理由: 並べ替え・ページングと「高エンゲージメント率」の絞り込みを DB で行う必要がある。生成列なら元数値の更新（FR-005 の再取得）に自動で追従し、既存行のバックフィルも不要。
- 却下した案と理由: 案B はページをまたいだ並べ替えができない。案C は元数値を更新する全経路（upsert 3種）で計算を忘れる余地がある。
- 影響: migration 1本。生成列は upsert の対象に含められないが、既存の upsert は列を明示しているため影響なし（先例: `gsc_article_evaluations.next_evaluation_date`）。
- 将来変更する条件: 式を変えるときは生成列を作り直す（migration）。
- 判断者・判断日: 遠藤 2026-09-19

### ALT-002: 「高エンゲージメント」の基準

- 判断: フォロワー規模別の目標（Trello の表）の下限以上
- 比較した案:
  - 案A: フォロワー規模別の目標の下限以上
  - 案B: アカウント全投稿の平均以上
- 採用案: 案A
- 採用理由: Trello に「目標エンゲージメント率 / フォロワー規模別の目標・目安」として判定基準が明記されている。MTG でもカオルさんが自分の率を目標の数値（3%・5%）と比べている（00:29）。
- 却下した案と理由: 案B は MTG 発言「その平均以上」（`docs/context/client-vision-from-lark.md` §2 根拠表・§1.10.6「閾値はフォロワー分析結果の平均以上」）を「アカウント全投稿の平均」と読んだ解釈だが、この「平均以上」が文脈上**フォロワー規模別の目標値**を指すことを 2026-09-19 に確認済み。アカウント全投稿の平均という解釈は採らない（初版で案B を採用していたが同日撤回）。
- 影響: フォロワー数の保存（FR-007）が必要になる。1,000 未満と 10 万以上は 2026-09-20 のクライアント補足で埋まり、フォロワー数が取得できていれば必ずどれかの区分に当たる（R-004）。
- 将来変更する条件: クライアントが目標値の表を変えたとき（定数を変える）。
- 判断者・判断日: 遠藤 2026-09-19

### ALT-004: 「高エンゲージメント率」の置き場所

- 判断: フィールド構成ダイアログの中に置く。既存の種別・期間・並び順は動かさない
- 比較した案:
  - 案A: 新規の「高エンゲージメント率」だけをダイアログへ入れる
  - 案B: 種別・期間もダイアログへ移し、Instagram タブ全体をブログと同じ構成にそろえる
  - 案C: タブ上部の行にチェックボックスを置く（初版の案）
- 採用案: 案A（2026-09-21 ユーザー判断）
- 採用理由: ブログ一覧は状態フィルターを `FieldConfigurator` の `dialogExtraContent` に置いており、新規追加分をそこへ入れれば置き場所の規約が一致する。案C は Instagram だけ規約が違う状態を新たに作る
- 却下した案と理由: 案B は要件（エンゲージメント率の算出・抽出）に無い既存UIの移設で、工数と確認範囲が増える。案C は上記
- 影響: Instagram タブは絞り込みがダイアログ内（高エンゲージメント率）と上部の行（種別・期間）に分かれたままになる（§6 誤読しやすい罠で明示）。チェックはダイアログを開かないと見えないため、ON のときは一覧の上にブログ一覧と同じフィルター表示（タグ・クリア・復元の表示）を出す（§6 項目定義。復元直後に一覧が黙って減ったように見えるのを防ぐ）
- 将来変更する条件: 種別・期間もダイアログへ寄せる要望が出たとき（案B へ移行）
- 判断者・判断日: ユーザー 2026-09-21

### ALT-003: インサイトの再取得範囲

- 判断: 投稿後7日以内を［最新化］のたびに再取得
- 比較した案:
  - 案A: 再取得しない（初回取得値で固定。取得日時を表示して注意喚起）
  - 案B: 投稿後7日以内を再取得
  - 案C: 全投稿を再取得
- 採用案: 案B
- 採用理由: 案A では投稿直後に最新化した投稿の率が伸びる前の値で固定され、並べ替え（FR-002）と目標判定（FR-004）が実態とずれる。案C は投稿数に比例して API を消費し、時間予算で途中終了しやすい。
- 却下した案と理由: 上記
- 影響: ［最新化］1回あたりの API 呼び出しが直近7日の投稿数だけ増える。
- 将来変更する条件: 7日の前後で率が大きく動く事例が出たら期間を見直す（OPEN-001）。
- 判断者・判断日: 遠藤 2026-09-19

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 目標の表はフォロワー数を分母にした目安で、本機能の率はリーチを分母にしているため、同じ投稿でも尺度が異なる | リーチがフォロワー数より大きく下回る／上回る投稿で、目標達成の判定が目安の想定と食い違う | 分母・目標値ともクライアントの運用（スプレッドシートはリーチ分母、目標は Trello の表）に合わせた。ダイアログ内の計算式と判定基準で示す | 遠藤 | 受容 |
| R-002 | GA4 の「エンゲージメント率」と名前が同じで混同される | 同じ `/analytics` にタブ違いで両方ある | フィールド構成ダイアログ内の「絞り込まれる条件」で式を出す（一覧のセルのツールチップは 2026-09-23 に廃止）。`ui-text.md` の既存「エンゲージメント率」行に GA4 由来と Instagram 由来の2定義を併記する（§6 UI用語） | 遠藤 | 対策済み（設計） |
| R-003 | Instagram アプリの表示やスプレッドシートと率が一致しない | Meta 側の数値更新タイミング、7日超の投稿は再取得しない | 成功指標で3件突き合わせ（一覧のセルの「GrowMate 独自計算」注記は 2026-09-23 に廃止） | 遠藤 | 未対応 |
| R-004 | 1,000 人未満（6.0〜10.0% 以上）と 10 万人以上（0.8〜1.5%）の目標値が Trello カード本文に未記載 | 出典が MTG 外のクライアント補足だけのため、後から経緯をたどれない／別の数値に書き換わったときに気づけない | 数値そのものは 2026-09-20 のクライアント補足で受領済み（BR-003 出典欄・§16 変更履歴に記録）。定数として実装し、次回定例で Trello カード本文へ反映してもらう。表を変えるときは定数を変える（ALT-002） | 遠藤 | 受容（実装は受領済みの数値で進める） |
| R-005 | 100 フォロワー未満のアカウントでは一部のインサイト指標が公式に提供されない（§10 制約条件の公式引用2） | 元数値が欠けるため BR-002 で全投稿が `-` になり、目標値は表示されるのに「高エンゲージメント率」が常に0件になる | どの指標が落ちるかは公式に列挙が無いため断定しない（未確認）。専用の分岐・案内文言は作らず BR-002 の `-` 表示と既存の0件表示で扱う（§6 状態別UI）。実際の取得状況は §14 リリース前 CP の実機確認で見る | 遠藤 | 受容 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| — | なし | — | — | — | — |

旧 Q-001（1,000 人未満・10 万人以上の目標値）は、2026-09-20 のクライアント補足で数値を受領したため確認質問から外した。残る作業は Trello カード本文への反映（出典の正式化）だけで、回答を待つ必要がないため R-004 として追跡する（判断の記録は §16 レビュー記録）。

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 再取得期間を7日から変えるか | 実データで率がいつ落ち着くかを見てから決める方が正確 | Phase 1 リリース後1か月 | 遠藤 |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体:
  - 目標判定の純関数: 境界値（0 / 999 / 1000 / 4999 / 5000 / 9999 / 10000 / 49999 / 50000 / 99999 / 100000 / 1000000）、NULL（未取得）
  - 目標達成の判定: 下限と同値で達成、下限未満で未達成、率 NULL は判定しない
  - `parseInstagramSortKey`: `'engagement_rate'` を受け付ける／不明値は `posted_at`（`tests/unit/lib/instagram-sort-storage.test.ts` に追加）
  - `app/analytics/page.tsx` の並び順解析が `parseInstagramSortKey` 経由になる（`engagement_rate` が落ちない）
  - `instagramMediaService.getPage`: `sort=engagement_rate` で `engagement_rate` 降順・NULL 末尾、下限指定時に `gte(engagement_rate, 下限)`、下限未指定なら絞り込み無し
  - 同期（`tests/unit/server/services/instagramSyncService.test.ts`）: incremental で投稿後7日以内の既存投稿がインサイト取得対象になる／7日超は対象外／取り直しは `synced` ではなく `refreshed` に数える／新着0件・取り直しありのときトーストが「更新対象の投稿はありませんでした」のまま／取り直し失敗時は DB に書き込まない（いいね・コメントも上書きしない）／incremental 開始時にフォロワー数を保存する／フォロワー数取得失敗でも同期は完了し、列を更新しない／backfill では取得しない・挙動は変わらない
  - 同期（新着と取り直しの振り分け）: `posted_at` がウォーターマーク以前でも DB に存在しない投稿は `synced`（新着）に数える（`getExistingMediaIds` の結果で振り分けていることの確認。前回上限で溢れた投稿・取得に失敗して入らなかった投稿が `refreshed` に流れない）
  - 同期（サーキットブレーカー）: 取り直しの失敗で `consecutiveFailures` が加算され、5連続で `stoppedReason = 'consecutive_failures'` になる／同じケースで `failed` は増えないため `consecutive_failures` のトースト文言が変わらない
  - OAuth callback: 取得済みプロフィールの `followersCount` を credentials に保存する／**`followers_count_synced_at` も連携時刻で併せて保存される**（`saveInstagramCredential` の `record` に2列とも含まれること。片方だけ入る状態を作らない）／**アカウント切り替え時（`igUserId` 不一致）に `followers_count` / `followers_count_synced_at` が null にリセットされる**（`fetchProfile` が `followers_count` を返さなかった場合も旧アカウントの値が残らない）
  - 目標達成の絞り込み: フォロワー数が未取得のとき `ig_high=1` でも `gte(engagement_rate, ...)` を付けず全件返す（黙って0件にしない）／「高エンゲージメント率」と目印を出さない
  - URL（`build-href.test.ts`。置き場所は `tests/unit/app/analytics/`）: `ig_high` がタブ切り替え・ページ送り・並べ替え変更で引き継がれる
  - 「高エンゲージメント率」の保存値の解釈（`instagram-sort-storage.test.ts` に追加）: `'1'` は `true`、`'0'`・それ以外の文字列・壊れた値・未設定は `false`（ブログの `parseStatusFilterConfig` と同じ「既定は絞り込みなし」。§10 再利用表の契約2）
  - 保存・復元の配線（同上）: 保存値が並び順・「高エンゲージメント率」の両方にあるとき、復元は**1回の遷移で両方が URL に載る**（`igSort` と `igHigh` を同じ patch に載せていることの確認。2回に分けると後の replace が先の条件を落とす）／フォロワー数が未取得のときは `ig_high` を復元しない（並び順だけを復元する）／**保存値の並び順が `posted_at`、URL に `ig_sort` がある、または並び順が指す列が非表示のときでも、`ig_high` だけは復元される**（並び順側の3条件が effect 全体を止めないことの確認。契約3）／どちらも復元対象が無ければ遷移しない
  - 表示: 率の丸め（6.04→6.0、6.06→6.1。浮動小数の境界値 x.x5 はテスト例に使わない）、NULL は `-`
- 統合・実画面確認: `/analytics?tab=instagram` で列・並べ替え・絞り込み・未取得時の案内・列非表示時の並び順リセットを確認。あわせてフィールド構成ダイアログを開き、(1)「状態でフィルター」の見出しと枠付きの「高エンゲージメント率」がブログ一覧と同じ見た目で出る、(2)「絞り込まれる条件」が既定で畳まれ、開くと判定基準と計算式が読める、(3) フォロワー数が未取得のときは「状態でフィルター」節ごと出ない、を確認する（§7「絞り込みの基準がダイアログの中で読める」「計算式は既定で畳まれている」「計算式を開くと読める」）。この表示は props の受け渡しと既存の `details` だけのため、**表示のための単体テストは新設しない**（文言の数値は目標判定の純関数の境界値テストと、一覧側・ダイアログ側で同じ整形関数を使うことで担保する）
- 文言チェック: `npm run verify:ui-text` を実行する。**`npm run verify` には含まれない**（`package.json` の `verify` は `npm audit` / `lint` / `test:coverage` / `build` / `knip` のみ）ため個別に実行する。`scripts/check-ui-text.sh` は `ui-text.md` の用語辞書表から検査ルールを生成するので、辞書を更新すればそのまま効く
- Gherkin との対応: §7 対応表のとおり
- 外部API・失敗系・境界条件: リーチ 0、元数値 NULL、フォロワー数の境界（0・999/1000・99999/100000）・未取得・取得失敗
- セキュリティ・権限・RLS: 新しい公開経路なし。既存の認可が効いていることを確認
- 非機能要件の測定: 対象外

### リリース方針

- リリース単位: Phase 1 を1 PR
- Feature Flag / allowlist: 作らない（CLAUDE.md Core Rules）
- データベース変更の適用順序: migration（生成列 + credentials の列追加）→ 型再生成 → アプリデプロイ
- migration の所要時間・ロック: `alter table public.instagram_media add column engagement_rate ... generated always as (...) stored` は**テーブル全行の書き換えと ACCESS EXCLUSIVE ロック**を伴い、適用中は `instagram_media` の読み書きが待たされる。対象行数は §9「移行対象行数の概算」のとおり 連携ユーザー数 × 最大数千件。`instagram_credentials` の2列はデフォルト値なしの列追加のため書き換えは発生しない
- 本番確認項目: カオルさんのアカウントで［最新化］→ フォロワー数と目標が表示される／任意の3投稿をスプレッドシートと突き合わせ

### ロールバック方針

- アプリケーションの戻し方: デプロイ巻き戻し
- DB変更の戻し方:
  - `alter table public.instagram_media drop column if exists engagement_rate;`
  - `alter table public.instagram_credentials drop column if exists followers_count, drop column if exists followers_count_synced_at;`
- データ不整合時の復旧: 生成列は元数値から再計算、フォロワー数は次回の最新化で取り直せるため不要
- ロールバック判断者: 遠藤

## 14. 実装手順・チェックポイント

### 手順

1. 本書のレビュー（`takt -w spec-review`）
2. UI たたき台の提示・合意（下記 実装着手前 CP）
3. 実装（`takt -w spec-to-pr`）
4. 品質ゲート（`npm run verify` と `npm run verify:ui-text`）
5. 画面確認・スプレッドシート突き合わせ
6. PR作成・レビュー・マージ
7. 次回定例で目標値を Trello カード本文へ反映（R-004。実装のブロッカーではない）

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 実装着手前 | §6 のレイアウト・状態別UI（とくにフォロワー数未取得時の案内文言、「目標達成」バッジ、フィールド構成ダイアログ内の「高エンゲージメント率」とその直下の判定基準（ALT-004。Instagram タブだけ絞り込みが2箇所に分かれる）、目標値の行の「（高エンゲージメント率のみ表示中）」）をカオルさんに提示し合意 | カオルさん | 承認済み（2026-09-21。遠藤の指示で更新。提示に使った材料は図解 HTML の UIモック） |
| リリース前 | スプレッドシートとの突き合わせ3件。あわせてカオルさんのアカウントで元数値（いいね・コメント・保存・リーチ）が取得できていることを確認（R-005） | 遠藤 | 未確認 |

**実装着手前 CP の扱い**: 本 CP は**仕様レビューのブロッカーにしない／実装前ゲートとして残置する**。本書のレビュー（spec-review）はこの CP が未確認のままでも完了してよく、実装着手は `spec-to-pr` 側で止める。根拠は `docs/context/client-vision-from-lark.md` §1.8（2026-04-22 定例）「**開発着手前に UI のたたき台を共有し、合意してから実装する**ことが明確化された。完成後レビューでは手戻りが大きく、過去に機会損失（契約見送り）につながったとの指摘がある。」／同 §2 根拠表 verbatim「開発前でいいのでこういう感じですを見せてほしい」「開発してからだと遅い」、および `.agents/skills/growmate-ui-ux/SKILL.md` 開発ワークフロー3「**着手前 — たたき台**（中〜大規模のみ）: ワイヤーまたは主要状態を提示し合意（§1.8）。合意前にコードを書かない。」

## 15. 完了条件

- Definition of Done:
  - FR-001〜FR-007 が実装され、§7 の全シナリオを満たす（FR-006 は優先度 Should だが、2026-09-21 のユーザー指示「基本的な仕様はブログと揃えたい」が本差分の要件そのものであり、部分実装だと「並び順は戻るのに絞り込みは戻らない」中途半端な状態になるため DoD に含める。新規 localStorage キー・読み取り純関数・`ig_high` の URL 配線・単体テストを伴う追加実装があり、工数は §5 の UI 6h に内包する）
  - `npm run verify` が通る
  - `npm run verify:ui-text` が通る（`npm run verify` には含まれない。§13 文言チェック）
  - migration にロールバック手順がコメントで記載されている
  - `.agents/skills/growmate-ui-ux/ui-text.md` が §6 UI用語のとおり更新されている（既存の「エンゲージメント率」行の補足に Instagram 由来の定義を併記し**新規行は足さない**／「目標エンゲージメント率」「目標達成」は新規行として追加）
- 検証方法・証跡: 単体テスト結果、`/analytics?tab=instagram` の画面確認、スプレッドシート突き合わせ3件
- 完了確認者・確認日: 遠藤 / 未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0（作成時セルフレビュー） | 2026-09-19 | 1 / 4 / 3 | 全件反映（取り直し失敗時の上書き、打ち切り基準、トーストの件数、並べ替えキーと `ig_high` の受け渡し箇所、型・丸め、localStorage の出典） | なし |
| 1（`spec-review` audit） | 2026-09-20 | 2 / 9 / 3 | 全14件を本書へ反映（下記「第1回レビューの反映内容」） | 下記「残置・未確認として合意した論点」3件（うち2 は第2回で解消） |
| 2（`spec-review` audit 再監査） | 2026-09-20 | 0 / 1 / 1 | 全2件を本書へ反映（下記「第2回レビューの反映内容」）。第1回の14件は全件 `resolved` と確認された | 残置合意なし（🟡 は修正済み）。未確認のまま持ち越すのは下記「残置・未確認」3 の1件のみ |
| 3（`spec-review` audit。2026-09-21 差分＝「目標達成のみ」の保存・復元） | 2026-09-21 | 1 / 5 / 3 | 全9件を本書へ反映（下記「第3回レビューの反映内容」）。`persists` / `reopened` はゼロ | 残置合意なし（全件を本文で解消）。🟡#2(b)（復元通知）は「そろえない」を選び §4 Non-goals へ理由付きで記録した |
| 4（`spec-review` audit。2026-09-21 差分＝ALT-004 と保存・復元の再監査） | 2026-09-21 | 0 / 3 / 3 | 全6件を本書へ反映（下記「第4回レビューの反映内容」） | 残置合意なし（全件を本文で解消）。公式ドキュメント照合は未実施（下記「公式ドキュメント照合（第4回）」） |
| 5（`spec-review` audit。2026-09-21 差分＝ダイアログ内の判定基準の表示と計算式の `details` 開閉） | 2026-09-21 | 0 / 3 / 4 | 全7件を本書へ反映（下記「第5回レビューの反映内容」）。第1〜4回の31件は全件 `resolved`、`persists` / `reopened` はゼロ | 残置合意なし（全件を本文で解消）。公式ドキュメント照合は未実施（下記「公式ドキュメント照合（第5回）」） |

#### 第1回レビューの反映内容（2026-09-20）

| finding_id | 反映先 |
| --- | --- |
| SPEC-NEW-followers-account-switch-stale 🔴 | BR-005 例外2 を新設（アカウント切り替え時は `followers_count` / `followers_count_synced_at` を null リセット）。FR-007 実装上の決定・§7 Gherkin「別の Instagram アカウントに連携し直す」・§7 対応表・§9 移行（アカウント切り替え）・§10 再利用表2行・§13 単体テストを追加 |
| SPEC-NEW-missing-ui-draft-checkpoint 🔴 | §14 手順2 と チェックポイント「実装着手前」を追加（確認者カオルさん・未確認）。§5 カレンダー上の前提も更新。扱いは下記「残置・未確認」1 |
| SPEC-NEW-official-preconditions-missing 🟡 | §10 制約条件に公式引用3件（URL・確認日 2026-09-20・verbatim・解釈を分離）。§9 外部連携表の公式根拠列を公式 URL へ差し替え。§6 状態別UI に元数値が恒常的に取れないアカウントの行を追加。§12 R-005 を新設。§16 公式ドキュメント照合を「実施」へ更新 |
| SPEC-NEW-refreshed-classification-undefined 🟡 | FR-005 実装上の決定に「incremental でも `getExistingMediaIds` で振り分ける（`posted_at` 比較では代用しない）」を追記。§10 再利用表・§13 単体テストを追加 |
| SPEC-NEW-consecutive-failures-undefined 🟡 | FR-005 実装上の決定に「取り直しの失敗も `consecutiveFailures` に加算し既存のサーキットブレーカーを維持、`failed` には加算しない」を明記。§13 単体テストを追加 |
| SPEC-NEW-fr006-orphaned-from-dod 🟡 | §15 DoD を「FR-001〜FR-007」へ（FR-006 を含める理由も併記）。§7 に Gherkin「並び順『エンゲージメント率』が再訪時に復元される」と対応表の行を追加 |
| SPEC-NEW-ighigh-unknown-followers-no-gherkin 🟡 | §7 に Gherkin「フォロワー数が未取得のまま『目標達成のみ』付きの URL を開く」と対応表の行、§13 に単体テストを追加 |
| SPEC-NEW-third-fetchprofile-path-unspecified 🟡 | §4 Non-goals に「連携設定画面のプレビューで取得したフォロワー数の保存」を理由付きで追加。FR-007 実装上の決定からも参照 |
| SPEC-NEW-migration-rowcount-and-rewrite 🟡 | §9 移行に「移行対象行数の概算」、§13 リリース方針に「migration の所要時間・ロック」を追加 |
| SPEC-NEW-verify-ui-text-not-in-verify 🟡 | §13 に「文言チェック」を追加、§15 DoD と §14 手順4 に `npm run verify:ui-text` を明記 |
| SPEC-NEW-q001-state-contradicts-template 🟡 | 監査の修正案 (a) を採用。Q-001 を §12 確認質問から外し R-004（リスク）へ移した。判断根拠は下記「Q-001 の扱い」 |
| SPEC-NEW-alt002-rejection-contradicts-source 🟢 | ALT-002「却下した案と理由」を差し替え（`client-vision-from-lark.md` の「その平均以上」が文脈上フォロワー規模別の目標を指すことを 2026-09-19 に確認済み、という文面へ） |
| SPEC-NEW-followers-synced-at-rationale 🟢 | §9 データに `followers_count_synced_at` を新設する理由（`last_synced_at` を使えない理由）を追記 |
| SPEC-NEW-uitext-existing-row-not-new-row 🟢 | §6 UI用語と §15 DoD を「既存行の補足を書き換えて2定義を併記（新規行を足さない）／『目標エンゲージメント率』『目標達成』は新規行」へ具体化 |

**Q-001 の扱い**: 監査の修正案 (a)（確認質問から外して R-004 へ移す）を採った。数値そのものは 2026-09-20 のクライアント補足で受領済みで、残るのは Trello カード本文への反映＝出典の正式化だけであり、回答を待つ必要がない。テンプレート（`docs/templates/requirement-definition.md`）が確認質問を「回答が出るまで実装に進めない事項／仕様レビューのブロッカー」と定義しているため、ブロッカーでない事項を確認質問に置き続けると同じ矛盾を再演する。修正案 (b)（未回答に戻してブロッカー扱い）は採らない。

#### 第2回レビューの反映内容（2026-09-20）

| finding_id | 反映先 |
| --- | --- |
| SPEC-NEW-followers-synced-at-on-connect 🟡 | FR-007 実装上の決定の OAuth callback 項に「`followers_count_synced_at` も連携時刻で同時に書く（3箇所とも2列を通す）」を追記し、**不変条件「2列は常に同時に書き、同時に null にする」**を新設。§6 ツールチップの目標値文言を「最後に［最新化］した時点」→「**最後に取得した時点**」へ改め（BR-005 の「連携時と［最新化］のたびに」と整合。連携直後で一度も［最新化］していないユーザーに事実と異なる説明を出さない）、§13 の OAuth callback テストに「`followers_count_synced_at` も併せて保存される」を追加 |
| SPEC-NEW-iguser-doc-now-verified 🟢 | §10 制約条件に公式引用4件目（IG User リファレンス。`followers_count` の定義・種別・必要権限）を URL・確認日・verbatim・解釈の分離付きで追加。§9 外部連携表のフォロワー数行の公式根拠列を当該 URL へ差し替え。§16 公式ドキュメント照合に同 URL を追加し、404 一覧と「残置・未確認」2 を解消済みへ更新 |

#### 第3回レビューの反映内容（2026-09-21）

| finding_id | 反映先 |
| --- | --- |
| SPEC-NEW-restore-effect-replace-clobber 🔴 | §10 再利用表「並び順の保存・復元」を**拡張**へ改め、同表の下に「目標達成のみ」の保存・復元の契約3として「並び順と `ig_high` は1本の effect・1回の `router.replace` で同時に戻す」を明記（`AnalyticsTable.tsx:448-449` の verbatim を根拠に併記）。§7 に Gherkin「並び順と『目標達成のみ』が1回の遷移で同時に復元される」と対応表の行、§13 に「保存値が両方あるとき復元は1回の遷移で両方 URL に載る」テストを追加 |
| SPEC-NEW-restored-empty-state-mismatch 🟡 | (a) §10 契約4 に「`ig_high` を既存の `hasFilter`（`InstagramTab.tsx:365`）に含める」を追記し、§6 状態別UI「目標達成のみ ON で該当0件」の表示・主操作を具体化。(b) 復元通知は**そろえない**と決め、§4 Non-goals へ理由付きで追加（下記「復元通知を Non-goals にした理由」）。§6 状態別UI にも「復元された直後」の行を追加して通知を出さないことを明示 |
| SPEC-NEW-ighigh-save-contract-undefined 🟡 | §10 契約1（保存は ON / OFF いずれも1箇所に集約）・契約2（保存書式は生文字列 `'1'` / `'0'`、読み取りは `'1'` のみ ON）を新設。§13 の解釈テストを同書式へ確定 |
| SPEC-NEW-restore-skip-unknown-followers 🟡 | §10 契約3 に「フォロワー数が未取得のときは `ig_high` を復元しない」を追記（`InstagramTab.tsx:331-334` の非表示列スキップと同じ理由）。§7「フォロワー数をまだ取得していない」に `And 保存済みの「目標達成のみ」があっても復元されない` を追加、§13 にも同テストを追加 |
| SPEC-NEW-dod-rationale-stale 🟡 | §15 DoD の FR-006 を含める理由を「2026-09-21 ユーザー指示が本差分の要件そのもので、部分実装だと中途半端になる／追加実装はあり工数は §5 の UI 6h に内包」へ差し替え |
| SPEC-NEW-perf-rationale-wrong 🟡 | §8 性能の根拠を「クエリ本数は増えない（credential の読み取りは既存。`page.tsx:205-215`）。`ig_high=1` のときだけ `Promise.all` が逐次になる」へ差し替え、§9 絞り込みにも同じ順序依存を追記 |
| SPEC-NEW-function-name-typo 🟢 | `parseStatusFilter` → `parseStatusFilterConfig`（実名。`src/lib/constants.ts:542`）に統一し、FR-006 根拠欄の参照先も `src/lib/constants.ts` の2関数＋`AnalyticsTable.tsx:431-464` へ直した（§10・§13・FR-006 の3箇所） |
| SPEC-NEW-ighigh-wiring-list-incomplete 🟢 | §10 再利用表「`ig_high` の受け渡し」に `AnalyticsHrefState` ほか欠けていた列挙箇所を `file:line` 付きで追記 |
| SPEC-NEW-changelog-out-of-order 🟢 | §16 変更履歴の 2026-09-21 行を表末尾へ移動し、日付昇順へ戻した |

**復元通知を Non-goals にした理由**（🟡#2(b) の判断）: 2026-09-21 のユーザー指示は「基本的な仕様はブログと揃えたい」で、要件は保存・復元の**挙動**の一致であり通知 UI ではない。MVP 最優先（`workflows/rules/mvp-scope.md`）に従い、要件がトレースできない UI は足さない。ブログ側が通知を足したのはカテゴリ＋状態フィルターが複数あり何が復元されたか画面から読み取りにくいためで、Instagram 側の絞り込みは「目標達成のみ」のチェックボックス1つで、解除も同じチェックボックスで足りる。**第4回で訂正**: 当初は「チェックが ON で表示されているため画面上で判別できる」としていたが、ALT-004 でチェックはフィールド構成ダイアログ内に移り、ダイアログを開かないと見えない。このため通知は作らないまま、常に表示している目標値の行の末尾に「（目標達成のみ表示中）」を付けて ON であることを一覧の上に出す（§6 項目定義）。将来検討する条件（誤認の事例が出たとき）とあわせて §4 Non-goals に記録した。

**公式ドキュメント照合（第3回）**: `spec-audit.md` は「公式ドキュメント照合: **実施**（2026-09-21、WebFetch）」と記録しており、§10 制約条件1〜4 の verbatim 引用が4 URL すべてで一致、`reach` / `saved` / `likes` / `comments` に非推奨告知なしと確認されている。本差分（localStorage の保存・復元）は外部 API 面を持たないため、§10 の引用・確認日は 2026-09-20 のまま据え置く。

**状態別UI に「フォロワー数あり・取得時刻なし」の行を足さなかった理由**: 第2回 audit が指摘した欠落状態は、FR-007 の不変条件（2列を常に同時に書く）を明記したことで発生しない。発生しない状態のための UI 分岐・案内文言を仕様へ足すのは要件発明にあたるため、状態の作り込みを禁じる側（不変条件）で閉じた。

#### 第4回レビューの反映内容（2026-09-21）

| finding_id | 反映先 |
| --- | --- |
| SPEC-NEW-ighigh-state-invisible-outside-dialog 🟡 | 監査の推奨 (a) を採用。新しいコンポーネント・通知は作らず、§6 項目定義「目標エンゲージメント率」に「ON のときだけ末尾に（目標達成のみ表示中）」を追加し、§6 レイアウト図・状態別UI（該当0件／復元された直後）・§4 Non-goals の理由・ALT-004 の影響・上記「復元通知を Non-goals にした理由」を事実（チェックはダイアログを開かないと見えない）に合わせて改めた。§7 に Gherkin「復元された直後に絞り込み中であることが一覧の上に出る」と対応表の行を追加。(b)（表示を足さず R-006 で受容）は、既定の動きで §4 自身が挙げる「投稿が消えた」誤認が起き、ユーザー指示「ブログと揃えたい」（ブログはダイアログ外に ON の状態を出す）とも合わないため採らない |
| SPEC-NEW-ighigh-wiring-missing-table-and-followers-props 🟡 | §10 再利用表「`ig_high` の受け渡し」に `InstagramMediaTable` の props（`igHigh`・変更ハンドラ・表示可否）と、`InstagramTab` の props「目標を判定できるか」（`page.tsx` → `AnalyticsClient.tsx` → `InstagramTab`）を追加。「目標達成のみ」の置き場所の行に「値とハンドラは `InstagramTab` から props で受ける」を追記（**第5回で差し替え**: 「表示可否」は判定基準の文言へ、「目標を判定できるか」は `followersCount` / `followersCountSyncedAt` へ。下記「第5回レビューの反映内容」） |
| SPEC-NEW-restore-early-return-couples-keys 🟡 | §10 契約3 に「並び順と `ig_high` の復元可否は別々に判定する。`InstagramTab.tsx:328` / `:330` / `:334` の3条件は並び順の patch からだけ外し、effect 全体を return させない」を明記。§13 保存・復元の配線テストに「保存値が `posted_at`・URL に `ig_sort` がある・列が非表示でも `ig_high` だけは復元される」を、§7 に Gherkin「並び順が既定のままでも『目標達成のみ』は復元される」と対応表の行を追加 |
| SPEC-NEW-dialog-layout-ascii-mismatch 🟢 | §6 レイアウト図の下に「lg 以上では左列＝表示フィールド、右列＝絞り込み（既存 `FieldConfigurator` の構成のまま）。幅が狭いときだけ下に並ぶ」を注記 |
| SPEC-NEW-wiring-paths-abbreviated 🟢 | §10 再利用表の `build-href.ts` / `AnalyticsClient.tsx` / `page.tsx` / `InstagramTab.tsx` を `app/analytics/` 起点のフルパスへ直した |
| SPEC-NEW-cp-scope-omits-placement 🟢 | §14 実装着手前 CP の確認内容に「フィールド構成ダイアログ内の『目標達成のみ』（ALT-004）と目標値の行の『（目標達成のみ表示中）』」を追記。確認質問は新設しない（§12 の「なし」を維持） |

**公式ドキュメント照合（第4回）**: 未実施。`spec-audit.md` 冒頭の記録どおり、今回の差分は ALT-004 と localStorage の保存・復元だけで外部 API に関わる部分が無く、§10 制約条件の引用文も書き換わっていない。照合済みの記録は下記「公式ドキュメント照合」（2026-09-20）と上記「公式ドキュメント照合（第3回）」（2026-09-21）。

#### 第5回レビューの反映内容（2026-09-21）

| finding_id | 反映先 |
| --- | --- |
| SPEC-NEW-dialog-criteria-values-unwired 🟡 | §10 再利用表「`ig_high` の受け渡し」を改め、`InstagramTab` の props を真偽値「目標を判定できるか」から `followersCount` / `followersCountSyncedAt` へ広げ（`page.tsx` → `AnalyticsClient.tsx` → `InstagramTab`。判定可否は `followersCount !== null`）、`InstagramMediaTable` の props の「表示可否」を判定基準の文言（`string \| null`。null が「表示しない」を兼ねる）へ差し替えた。同表に「目標値の文言の整形」行を新設し、一覧側（FR-003）とダイアログ内（FR-004）が `src/lib/instagram-format.ts` の同じ1関数を使い、「目標エンゲージメント率: 」と「目標: 」の違いは引数で表すと明記。§6 項目定義「目標達成のみの補足」からも参照 |
| SPEC-NEW-formula-details-mixes-follower-note 🟡 | 監査の修正案 (a) を採用。`details` 本文を式だけ（「（いいね＋コメント＋保存）÷ リーチ × 100」）にし、フォロワー数の但し書き「（フォロワー数は最後に取得した時点の値）」は判定基準の行の下へ移した。§6 項目定義・§6 レイアウト図・§7 Gherkin の3箇所をそろえた。(b)（summary を「エンゲージメント率と目標の出し方」に改め2文にする）は採らない。理由: フォロワー数は BR-003 の区分判定の入力で BR-001 の式に登場しないため、計算式の開示に同居させる限り R-001 / R-002 の分母の誤読を招く余地が残る。(a) なら summary 文言と既存 Gherkin の判定基準の文字列を変えずに済む |
| SPEC-NEW-dialog-additions-absent-from-test-plan 🟡 | §13「統合・実画面確認」にダイアログ内の (1) 判定基準が一覧側と同じ値で出る (2) 計算式が既定で畳まれ開くと読める (3) フォロワー数未取得時は節ごと出ない、を追加。表示のための単体テストは新設しない旨と、その理由（props の受け渡しと既存 `details` のみ。数値は純関数の境界値テストと共通の整形関数で担保）を明記 |
| SPEC-NEW-filter-section-heading-owner-undefined 🟢 | §10 再利用表「「目標達成のみ」の置き場所」に「『絞り込み』見出しは Instagram 側が `dialogExtraContent` の中で描く（`FieldConfigurator.tsx:340-344` は見出しを描かない。ブログ側 `CategoryFilter.tsx:101` と同じ）」「目標を判定できないときは `dialogExtraContent` を渡さず節ごと出さない（`FieldConfigurator.tsx:340`）」を追記。§6 レイアウト図の注記にも同旨を追加。`details` の参照行を `CategoryFilter.tsx:118-131` → `:119-133` へ直した（§6 項目定義・§10 再利用表の2箇所） |
| SPEC-NEW-gherkin-then-before-when 🟢 | §7「計算式は畳まれていて、開くと読める」を「計算式は既定で畳まれている」（Given → When フィールド構成を開く → Then）と「計算式を開くと読める」（Given → When 開く → Then）の2本に分け、§7 対応表も2行にした |
| SPEC-NEW-details-text-punctuation 🟢 | 指摘2の (a) 採用で `details` 本文が1文になったため、`ui-text.md`「表記ルール > 1. 句点」の「1 文で完結する…付けない」に従い句点なしで確定し、§6 項目定義に根拠を併記。§6 レイアウト図・§7 Gherkin も同文言 |
| SPEC-NEW-estimate-not-updated-for-dialog-additions 🟢 | §5 内訳の UI 行に「ダイアログ内の判定基準の表示と計算式の開閉」を加え、既存の `dialogExtraContent` と `details` への表示の追加だけで新規コンポーネントが無いため 6h に内包する旨を添えた（工数は据え置き） |

**公式ドキュメント照合（第5回）**: 未実施。`spec-audit.md` 冒頭の記録どおり、今回の差分（§5 / §6 / §7 / §10 再利用表 / §13 / §16）は外部 API 面を持たず、§9 外部連携表・§10 制約条件1〜4 の verbatim 引用と確認日 2026-09-20 は変更していない。照合済みの記録は下記「公式ドキュメント照合」（2026-09-20）と上記「公式ドキュメント照合（第3回）」（2026-09-21）。

#### 残置・未確認として合意した論点

1. **実装着手前 UI たたき台 CP は残置**（§14）。クライアント合意事項（`client-vision-from-lark.md` §1.8）に基づく実装前ゲートとして本書に残すが、**仕様レビューのブロッカーにはしない**。spec-review はこの CP が未確認のままでも完了してよく、実装着手を止めるのは `spec-to-pr` 側。
2. ~~`followers_count` の公式フィールド定義は未確認~~ → **第2回 audit（2026-09-20）で解消**。正しい IG User リファレンス URL（`.../instagram-graph-api/reference/ig-user/`）を再探索して取得し、`followers_count` の定義・フィールド種別・必要権限を照合した（§10 制約条件4）。第1回時点で 404 だった旧 URL 群に残る照合作業は無い。
3. **100 フォロワー未満で提供されない指標の特定は未確認**（R-005）。公式（`.../instagram-platform/insights/`）に「一部の指標が利用不可」とあるだけで**どの指標かの列挙が無く、外部から回答を得られない**ため断定しない。BR-002 の `-` 表示で吸収し専用の分岐は作らない。実機の取得状況は §14 リリース前 CP で確認する。

#### 公式ドキュメント照合

- **実施**（2026-09-20、WebFetch）。取得できた URL と verbatim 引用、および引用から導いた解釈は §10 制約条件に記載。
  - <https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/> — 48時間の遅延・2年の保持
  - <https://developers.facebook.com/docs/instagram-platform/insights/> — 100フォロワー未満で一部指標が利用不可・データ不在時は空データ（`0` ではない）
  - <https://developers.facebook.com/docs/graph-api/overview/rate-limiting> — `Calls within 24 hours = 4800 * Number of Impressions`
  - <https://developers.facebook.com/docs/instagram-platform/changelog> — 本書が使う `reach` / `saved` / `likes` / `comments` の非推奨・提供終了の告知は無い（2026-04-22 は `reposts_count` / `saved_count` / `shares_count` の追加）
  - <https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/> — `followers_count` のフィールド定義・種別（Public）・必要権限（`instagram_business_basic`）（**第2回 audit で追加**。第1回に 404 だった IG User リファレンスの正しい URL）
- 取得できなかった URL（404）: `.../reference/instagram-user/`、`.../api-reference/instagram-user`、`.../api-reference/instagram-media/insights`。いずれも上記の代替 URL で同じ情報を照合できたため、**残る照合作業は無い**（上記「残置・未確認」2）。

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | カオルさん | 未承認 |  |  |
| 技術レビュー | 遠藤 | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-19 | 初版 | 2026-09-16 定例・Trello カードから作成 | 遠藤 |
| 2026-09-19 | 「高エンゲージメント」の基準を「アカウント平均以上」から「フォロワー規模別の目標の下限以上」へ変更。フォロワー数の保存（FR-007）を追加、平均 RPC を削除 | Trello の目標値の表が判定基準として明記されていたため | 遠藤 |
| 2026-09-20 | 目標値の表に 1,000 人未満（6.0〜10.0% 以上）と 10 万人以上（0.8〜1.5%）を追加。範囲外で判定しない分岐を削除 | クライアント補足の受領 | 遠藤 |
| 2026-09-20 | 第1回 `spec-review` の指摘14件を反映（BR-005 例外2＝アカウント切り替え時のフォロワー数リセット、§14 実装着手前 UI たたき台 CP、公式ドキュメント引用の追加、`refreshed` の振り分けと `consecutiveFailures` の明記、Gherkin 3本と対応表、Non-goals 1件、移行行数とロック、`verify:ui-text`、Q-001 → R-004、ALT-002 却下理由、`followers_count_synced_at` の理由、`ui-text.md` の既存行併記） | `spec-review` audit 第1回（詳細は §16 レビュー記録） | 遠藤 |
| 2026-09-20 | 第2回 `spec-review` の指摘2件を反映（OAuth callback で `followers_count_synced_at` も同時に保存する不変条件、目標値ツールチップを「最後に取得した時点」へ改める、IG User リファレンスによる `followers_count` の公式照合） | `spec-review` audit 第2回（詳細は §16 レビュー記録） | 遠藤 |
| 2026-09-21 | 「目標達成のみ」をフィールド構成ダイアログ内（`dialogExtraContent`）に置く。ALT-004 を追加し、§6 レイアウト・項目定義・FR-004・誤読しやすい罠・§10 再利用表を更新 | ユーザー判断（ブログ一覧と置き場所の規約をそろえる。案A） | 遠藤 |
| 2026-09-21 | 「目標達成のみ」を localStorage に保存・復元する（ブログ一覧の状態フィルターと同じ挙動）。Non-goals から該当行を削除し、FR-006・Gherkin 3本・単体テスト・工数（UI 5→6h）を更新。ステータスを `review` に戻す | ユーザー指示「基本的な仕様はブログと揃えたい」（2026-09-21） | 遠藤 |
| 2026-09-21 | 第3回 `spec-review` の指摘9件を反映（復元は1本の effect・1回の `router.replace`、保存契約の明文化、判定不能時は `ig_high` を復元しない、`hasFilter` への `ig_high` 追加、復元通知を Non-goals 化、§8 性能の根拠差し替え、`parseStatusFilterConfig` の関数名、`ig_high` 配線箇所の列挙、変更履歴の並び順） | `spec-review` audit 第3回（詳細は §16 レビュー記録） | 遠藤 |
| 2026-09-21 | §14 実装着手前 CP（UI たたき台の合意）を承認済みに更新 | 遠藤の指示（2026-09-21） | 遠藤 |
| 2026-09-21 | 計算式を既定で畳んだ `details`（summary「エンゲージメント率の出し方」）に入れて開閉できるようにする。ブログ一覧の状態フィルターと同じ既存パターン | ユーザー指示「計算式は開閉できるように」（2026-09-21） | 遠藤 |
| 2026-09-21 | フィールド構成ダイアログ内の「目標達成のみ」の直下に判定基準（フォロワー数・区分・目標・計算式）を表示する。FR-004・§6 レイアウト図・項目定義・Gherkin・§14 CP を更新 | ユーザー指摘「フォロワー数ごとの高エンゲージメント率の基準が無いとユーザーが分からない」（2026-09-21） | 遠藤 |
| 2026-09-21 | 第4回 `spec-review` の指摘6件を反映（ON のとき目標値の行に「（目標達成のみ表示中）」、`InstagramMediaTable` の props と「目標を判定できるか」の配線、並び順と `ig_high` の復元可否を別々に判定、ダイアログ内レイアウトの注記、配線表のフルパス、実装着手前 CP に ALT-004） | `spec-review` audit 第4回（詳細は §16 レビュー記録） | 遠藤 |
| 2026-09-21 | 第5回 `spec-review` の指摘7件を反映（判定基準の値の配線と一覧側・ダイアログ側で共用する整形関数、計算式の本文を式だけにしフォロワー数の但し書きを判定基準の行へ移す、§13 実画面確認の追加、「絞り込み」見出しの描画主体と未取得時は節ごと出さないこと、Gherkin の分割、句点、§5 内訳） | `spec-review` audit 第5回（詳細は §16 レビュー記録） | 遠藤 |
| 2026-09-23 | 出典の修正のみ（要件は変更なし）。§17「対象外」行の根拠「MTG で『それはできてる』と発言」を「本ラベルの範囲外」に差し替え。FR-002・Non-goals の MTG 引用を妙記の原文どおりに直す。§2 シナリオ1から出典の無い「週に一度の振り返りで」を削除 | 妙記の再照合で、13:38 の発言は対象が特定できず、11:57〜12:22 で既存の広告起点機能とは別物と合意していたため（`client-vision-from-lark.md` §1.10.7） | 遠藤 |
| 2026-09-23 | 一覧のセル（エンゲージメント率と既存の率の列）のホバー時のツールチップと点線の下線を外す。§6 ツールチップ文言・誤読しやすい罠・§10 再利用表・R-002・R-003 を更新。式はフィールド構成ダイアログ内の「エンゲージメント率の出し方」で示す。「対象外」の理由のツールチップは残す | ユーザー指示「一覧でホバーした時、文字出すのやめてほしい」（2026-09-23 画面確認時） | 遠藤 |
| 2026-09-23 | 絞り込みの名前を「目標達成のみ」から「高エンゲージメント率」へ変更し、ON 時の表示を「（高エンゲージメント率のみ表示中）」にする（§16 より前の本文を置換。判定基準・目印「目標達成」は変えない） | ユーザー指示「フィールド構成の文字は『目標達成のみ』ではなく『高エンゲージメント率』」（2026-09-23 画面確認時） | 遠藤 |
| 2026-09-23 | 一覧の上の目標値の行（「フォロワー N人（区分）の目標エンゲージメント率: a〜b%」と (i) のツールチップ）を廃止し、目標値はフィールド構成ダイアログ内の判定基準にだけ出す。一覧の上には絞り込み ON 時の「高エンゲージメント率のみ表示中」とフォロワー数未取得時の案内だけを残す。FR-003・§6・§7・§10・ALT-004・R-001 を更新。`followers_count_synced_at` は画面に出さなくなったが、2列同時書き込みの不変条件は維持する。実装着手前 CP でカオルさんに見せた UI たたき台からの変更 | ユーザー指示「この文字を一覧に出す必要なし」「フィールド構成に書かれている。同じ文言を出したくない。DRY」（2026-09-23 画面確認時） | 遠藤 |
| 2026-09-23 | フィールド構成ダイアログと一覧の上の表示をブログ一覧に合わせる。ダイアログは見出し「状態でフィルター」・枠付きの行・`details`「絞り込まれる条件」（判定基準・計算式・フォロワー数の時点を箇条書き）にし、常時表示だった判定基準と「エンゲージメント率の出し方」を畳んだ「絞り込まれる条件」へまとめる。一覧の上は「フィルター:」+ タグ（× で解除）+「クリア」+ 復元直後の「（前回の絞り込みを復元しました）」にする。これに伴い §4 Non-goals の「復元しました通知」行を削除。FR-004・§6・§7・§10・§13・ALT-004・R-002 を更新 | ユーザー指示「ブログ一覧のフィールド構成と UI は合わせたい。UI/UX の基礎」（2026-09-23 画面確認時） | 遠藤 |

## 17. フェーズ全体のロードマップ（参考・本書の完了定義外）

ラベル「高EG率のコンテンツをブログ化」全体の分割。Phase 2 以降は着手時に別の仕様書を作る（本書の §4 Non-goals と対応）。

| Phase | 内容 | 出典 | 着手時に決めること |
| --- | --- | --- | --- |
| **1（本書）** | エンゲージメント率の算出・並べ替え・目標達成の抽出 | Trello「エンゲージメント率を出す」「高エンゲージメント率を抽出する」「目標エンゲージメント率」 | — |
| 2 | 目標達成の投稿のキャプションからキーワード案とブログ下書きを作り、コンテンツ一覧に入れる | Trello「キャプションを元に、キーワード立案+コンテンツを作成する」、MTG「勝手に作って提案しました…この中にポコッと入る」 | 作成のきっかけ（投稿ごとのボタン／自動）、生成物の範囲（キーワード＋構成まで／本文まで）、既存ブログ作成フロー（step1〜7）との関係 |
| 3 | 過去記事のうち新しいテーマに触れている箇所を探し、内部リンクの挿入と書き直しを提案する | Trello「過去のコンテンツで内部リンクが必要なコンテンツをあぶりだし、再作成する」、MTG「魚粉について触れてるから内部リンク入れた方がいい」 | 既存記事本文の取得元、提案の出し先（一覧／記事詳細）、書き直しの範囲 |
| 対象外 | 広告クエリ＋オーガニッククエリ＋競合差分からの立案 | Trello 冒頭の式 | 本ラベルの範囲外（2026-09-23 遠藤判断。本ラベルは Phase 1〜3 の Instagram 起点の立案に限る）。キーワード起点の立案は別に扱い、競合差分は [`blog-pre-steps-cannibalization-keyword-gap-design.md`](./blog-pre-steps-cannibalization-keyword-gap-design.md)（未実装）の範囲 |
