# マイホーム（連携の異常だけを出す画面）仕様書

## メタデータ

- 文書名: マイホーム: 機能カードを廃し、連携の異常だけを出す画面へ置き換え
- ステータス: `implemented`
- 作成日: 2026-09-09
- 最終更新日: 2026-09-09
- 作成者: shoma-endo（Claude Code 同席）
- 承認者: shoma-endo
- 対象リリース: `feature/pc-first-app-shell` に続けて develop へ
- 関連する依頼・Issue・PR: [`pc-first-app-shell-spec.md`](pc-first-app-shell-spec.md)（サイドバー導入。本仕様はその Non-goal「マイホームの再設計」を引き受ける）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- サイドバー導入後、`/`（マイホーム）のカード（管理者機能・設定・コンテンツ一覧・Google Ads 分析）とアカウント情報カードは、すべてサイドバーのナビ項目・ユーザーブロックと重複した。
- 参考にした記事「アプリの『HOME タブ』は本当に必要？」（note、2025-10-15）が引く Apple の見解では、他タブの機能を文脈なく 1 画面に複製した HOME は情報階層を混乱させ、冗長性と方向感覚の喪失を生む。今の `/` はまさにその状態。
- 一方、同記事は次の 4 条件を満たすなら HOME を置いてよいとする: 役割が明確 / 階層上の位置づけが説明できる / 利用者の次の一歩が見える / 名前に甘えない。
- GrowMate には「利用者が反応すべき変化」が既に存在する（連携の再連携要求、未読の改善提案）。改善提案は toast（`GscNotificationHandler`）が全画面で常時出している。

### 目的

- `/` を「連携の異常」だけを出す画面に作り替え、機能一覧の複製をやめる。
- 異常 → 該当する設定画面への直接遷移、という導線を常設する。改善提案は toast と二重になるため置かない（2026-09-09 ユーザー決定）。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| `/` に出る要素のうちサイドバーと重複するもの | 5 | 0 | 目視 | 実装時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | paid / admin | ログイン直後に連携の異常があれば分かる。無ければ無いと分かる |
| 利用者 | trial | Google Ads の異常だけが出る（他の連携は使えない） |

### 主な利用シナリオ

1. **paid 利用者が**、**GSC の再連携が必要なとき**、その旨と「再連携する」導線を見て設定へ進む。
2. **誰でも**、**異常が無いとき**、「確認が必要なことはありません」だけを見て、サイドバーから目的の画面へ進む。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
/ → アカウント情報カード ＋ 機能カード 4 枚（サイドバーと重複）→ もう 1 クリックで目的画面
改善提案 → 全画面で toast（閉じると消える）
```

### 導入後（To-Be）

```text
/ → [連携の異常 0〜n 件]
      各項目 → 該当する設定画面へ 1 クリック
      何も無い日 → 「確認が必要なことはありません」だけ
改善提案 → 従来どおり全画面の toast（/ でも同じ）
```

### 業務ルール

- ルール ID: HOME-01
- ルール: `/` に出す項目は「利用者が反応すべき変化」に限る。ナビ項目の複製（設定・一覧・管理者・チャットへの単なるリンク）や、同じ画面に出ている toast と同内容の項目は置かない。
- 例外: なし

- ルール ID: HOME-02
- ルール: 出す項目の権限は、遷移先画面のサーバー側ゲート（`proxy.ts`）と同じにする。遷移先に入れない役割にはその項目を出さない。
- 例外: なし

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**。本画面は既存データだけで組み、新しい集計・テーブル・cron は作らない。

### 対象範囲

- 画面・操作: `/` の作り替え、ユーザーブロックにメールアドレス表示（ツールチップ）。サイドバー項目名は「マイホーム」のまま（2026-09-09 ユーザー決定。見出しもナビと同じ「マイホーム」にし、役割は見出し下の説明文で示す）
- データ: 既存の取得経路のみ（下記 §7）
- 権限: HOME-02 のとおり

### Non-goals

- KPI 数字（表示回数・セッション・広告費・直近チャット）: 何を出すか未定義。要件が出てから別仕様で扱う。
- 「未連携」の常時表示（WordPress / GSC / GA4 を繋いでいない案内）: 繋ぐ意思の無い利用者に毎日出続けるため「変化」ではない。空状態の 1 行（「連携がまだの場合は設定から」）に留める。
- 評価完了・GA4 評価結果の通知: 「完了」を検出するための既読管理が無く、新テーブルが要る。
- 未読の改善提案の項目: 当初は置く案だったが、同じ画面右下に同内容の toast（`GscNotificationHandler`、閉じるまで常時）が出るため二重になる。toast に任せ、本画面には置かない（2026-09-09 ユーザー決定）。
- 「新規チャットを開始」カード: 遷移先がサイドバー「チャット」と同じで HOME-01 に反する。置かない（同日決定）。
- 見出し下の説明文（「今日確認が必要なことだけをまとめています。」）: 見出しとカードで足りる。置かない（同日決定）。
- 記事詳細・チャット画面側の変更: なし。
- 日付表示・履歴: 出すのは現在の状態だけ。
- `/setup/*` の既存文言「再認証」→「再連携」への是正: 辞書逸脱だが本仕様の範囲外。別途まとめて直す。

## 5. 受け入れ条件

```gherkin
Feature: 今日の確認（/）

  Scenario: paid が再連携要求を持っている
    Given paid でログインし、GSC が再連携待ちである
    When "/" を開く
    Then 「Google Search Console の再連携が必要です」と「再連携する」ボタンが表示される
    When 「再連携する」を押す
    Then "/setup/gsc" へ遷移する

  Scenario: 異常が無い
    Given paid でログインし、全連携が正常である
    When "/" を開く
    Then 「確認が必要なことはありません」だけが表示される
    And 設定・コンテンツ一覧・管理者・チャットへのカードは表示されない
    And 改善提案の項目は表示されない（toast が担う）

  Scenario: trial
    Given trial でログインする
    When "/" を開く
    Then GSC・GA4・Instagram の項目は表示されない
    And Google Ads が再連携待ちなら、その項目だけは表示される

  Scenario: サイドバー
    Given ログインしている
    Then サイドバーの先頭項目は「マイホーム」のままで、"/" を開いたときアクティブになる
    And アカウント情報カードは無く、ユーザーブロックのアバターにマウスを載せるとメールアドレスが出る

  Scenario: 取得失敗
    Given 連携状態の取得に失敗する
    When "/" を開く
    Then 画面は落ちず、取得できた項目だけを表示し、上部に「一部の情報を取得できませんでした。ページを再読み込みしてください。」と 1 行出す
```

## 6. 機能要件

### 画面設計（たたき台）

PC（lg 以上、サイドバー展開時）:

```text
┌────────────┬────────────────────────────────────────────────┐
│ GrowMate   │  マイホーム                                     │
│────────────│                                                │
│ メイン      │  ┌──────────────────────────────────────────┐  │
│▏⌂ マイホーム │  │ ⚠ Google Search Console の再連携が必要です  │  │
│  ▤ 事業者情報│  │   検索順位の取得が止まっています。 [再連携する]│  │
│  ✉ チャット  │  └──────────────────────────────────────────┘  │
│ 分析        │  ┌──────────────────────────────────────────┐  │
│  ≡ コンテンツ一覧  │ ⚙ Google Analytics 4 のプロパティが選ばれていません │
│  ⚡ Google Ads 分析│   連携は済んでいますが、対象サイトが未選択です。[プロパティを選ぶ]│
│ 管理        │  └──────────────────────────────────────────┘  │
│  ⚙ 設定     │                                                │
│  ⛨ 管理者   │                          （右下: 改善提案の toast）│
│────────────│                                                │
│ (顔) 氏名   │                                                │
│      役割 ⇥ │                                                │
└────────────┴────────────────────────────────────────────────┘
```

空状態:

```text
  マイホーム

  ┌──────────────────────────────────────────────┐
  │ ✓ 確認が必要なことはありません                   │
  │   連携がまだの場合は 設定 から始められます。      │  ← 未連携があり paid/admin のときだけ。
  └──────────────────────────────────────────────┘     それ以外は「新しい提案や連携の異常があるとここに出ます。」
```

- 幅: `max-w-3xl mx-auto px-4 py-8 space-y-4`（`/setup/gsc` `/setup/ga4` と同じ列幅）。
- 各項目は既存 `Card`（`src/components/ui/card.tsx`）。左に lucide アイコン、見出し（`text-base font-semibold`）、1 行の説明（`text-sm text-muted-foreground`）、右にボタン 1 つ（`Button` default）。再連携項目は `border-destructive/40`＋赤アイコン、プロパティ未選択・提案・チャットは既定（`/setup` が未選択を再連携と色分けしているのに合わせる）。sm 未満はボタンをカード下段に落とし全幅にする（`Button` は `whitespace-nowrap` で縮まない）。
- lg 未満: 同じカードが 1 列。
- 取得失敗の注意書きは `ERROR_MESSAGES.HOME.PARTIAL_FETCH_FAILED`（文言の直書き禁止）。既存の inline エラー（`border-destructive/30 bg-destructive/5`）と同じ見た目。

### 項目の定義と表示条件

| # | 項目 | 表示条件 | 見出し / 説明 | ボタン → 遷移先 |
| --- | --- | --- | --- | --- |
| 1 | GSC 再連携 | paid/admin かつ `gscStatus.connected && needsReauth` | Google Search Console の再連携が必要です / 検索順位の取得が止まっています。 | 再連携する → `/setup/gsc` |
| 2 | GA4 再連携 | paid/admin かつ `ga4Status.connected && needsReauth`（GSC だけ連携した利用者は `unlinked` かつ `needsReauth` になるため `connected` 必須） | Google Analytics 4 の再連携が必要です / アクセス解析の取得が止まっています。 | 再連携する → `/setup/ga4` |
| 3 | GA4 プロパティ未選択 | paid/admin かつ `ga4Status.connectionStage === 'linked_unselected'` | Google Analytics 4 のプロパティが選ばれていません / 連携は済んでいますが、対象サイトが未選択です。 | プロパティを選ぶ → `/setup/ga4` |
| 4 | Google Ads 再連携 | 全役割 かつ `googleAdsStatus.needsReauth` | Google Ads の再連携が必要です / 広告データの取得が止まっています。 | 再連携する → `/setup/google-ads` |
| 5 | Instagram 再連携 | `canAccessInstagram(role)` かつ `instagramStatus.needsReauth` | Instagram の再連携が必要です / 投稿データの取得が止まっています。 | 再連携する → `/setup/instagram` |
| 6 | 空状態 | 1〜5 が 0 件 | 確認が必要なことはありません / paid・admin で未連携がある（`hasUnlinked`）: 連携がまだの場合は 設定 から始められます。（「設定」はリンク）。それ以外: 新しい提案や連携の異常があるとここに出ます。（全部連携済みの人に毎日「設定」を出さない。trial は `/setup` に入れないので常にこちら） | なし |
| 7 | 取得失敗 | 連携状態または件数の取得で例外 | 一部の情報を取得できませんでした / ページを再読み込みしてください。 | なし |

- 順序: 1〜5 の順。放置するとデータが止まるものが上。
- 利用者向けの語は辞書どおり「再連携」（`ui-text.md`: 「再連携 | 再認証、再接続 | 目視」）。既存の `/setup/*` 画面は「再認証が必要です」と書いており辞書から逸脱しているが、本仕様では直さない（§4 Non-goal）。

### サイドバーの変更

- 項目名・アイコン・`href` は変えない（「マイホーム」/ `Home` / `/`）。
- ユーザーブロックのアバターを `button`（`aria-label="アカウント情報"`、`title` にメール）にし、ツールチップに氏名（役割）とメールアドレスを出す（アカウント情報カードの代替）。Radix Tooltip はタッチで開かないため、スマホでは `title` も効かずメールに到達できない。PC ファースト仕様の既知の限界として受容（§10）。

## 7. 設計

| ファイル | 役割 |
| --- | --- |
| `app/page.tsx` | server component に作り替え。`authMiddleware` → `roleUnavailable` なら `/unavailable`（`/` は proxy の公開パスで proxy が振り分けないため。無いと `/login` ⇄ `/` の無限リダイレクト）→ 役割判定 → 連携状態（GSC/GA4 は `resolveHomeGoogleCredential`（`src/server/lib/home-google-credential.ts`。実際にトークンリフレッシュを試みてから `toGscConnectionStatus` / `toGa4ConnectionStatus` に渡す）、`getGoogleAdsConnectionStatus`、`canAccessInstagram` なら `getInstagramConnectionStatus`）を `Promise.all` ＋ `settle()`（例外を `ok:false` に落とす）で並列取得。失敗は項目 7 に落とす |
| `app/_components/TodayChecklist.tsx`（新規、server component） | 項目 1〜7 の描画。props は取得済みの状態と役割だけ。クリックは `Link` のみでクライアント状態を持たない |
| `src/lib/home-today.ts`（新規、純粋ロジック） | `buildHomeToday({ role, gsc, ga4, googleAds, instagram })` → `{ items, fetchFailed, hasUnlinked }`。`null` は取得失敗、`undefined` は役割上取得しない。表示条件（HOME-02）をここに集約し `tests/unit/lib/home-today.test.ts` で検査 |
| `src/components/AppShell.tsx` | ユーザーブロックのアバターにメールのツールチップ |
| `.agents/skills/growmate-ui-ux/ui-text.md` | 変更なし（「マイホーム」「改善提案」は既存の語。新語は増やさない） |
| `docs/plans/pc-first-app-shell-spec.md` | Non-goal「マイホームの再設計」を本仕様へ委譲した旨を追記 |

### 設計判断

- **server component で組む**: 表示は取得済みデータの並べ替えだけで、クライアント状態が無い。`/setup` と同じ取得関数を再利用し、新しい Server Action は作らない。
- **表示条件を純粋関数に切り出す**: 役割 × 状態の組み合わせを単体テストで固定する（コンポーネントテスト基盤が無いため。`app-nav.ts` と同じ方針）。
- **「未連携」を出さない**（§4 Non-goal）。
- **命名**: ナビ項目は「マイホーム」のまま（ユーザー決定）。記事の「ネーミングに甘えない」は、名前ではなく画面構造（連携の異常しか置かない）で役割を示すことで満たす。見出しはナビと同じ「マイホーム」にし（ナビ項目と遷移先の h1 を揃える規約）、説明文は置かない。

## 8. 非機能・セキュリティ

- 認可は各遷移先の `proxy.ts` ゲートが担う。本画面の表示条件はそれと同じ（HOME-02）。
- GSC/GA4・Google Ads とも、access token の期限が近いとリフレッシュ（Google OAuth 呼び出し）と保存が走る（GSC/GA4 は `home-google-credential.ts`、Google Ads は `googleAds.actions.ts`。頻度はトークン寿命ごと）。GSC/GA4 は同一 credential（アクセストークン）を共有するため、マイホームでは呼び出しを1回にまとめる。
- `/` は `proxy.ts` の公開パスなので、利用停止ロール（`unavailable`）の `/unavailable` への振り分けは page が担う。
- 取得失敗はログ（`console.error`）＋項目 9 で表示。サイレント失敗にしない。

## 9. 検証

- `npm run verify`、`npm run verify:ui-text`、`npm run verify:doc-paths`
- 単体: `tests/unit/lib/home-today.test.ts`（役割 × 状態: trial は 4 のみ、paid の空状態、admin の全項目、`linked_unselected`、GSC だけ連携の GA4、取得失敗）
- 手動（admin）: `/` で項目の表示と各ボタンの遷移先、空状態、サイドバー「マイホーム」のアクティブ表示、アバターのメールツールチップ。lg 未満で 1 列。

## 10. リスク・未決定事項

- 「再連携が必要」の判定（`needsReauth`）は `/setup` と同じ関数を使うが、`/setup` はクライアント側で WordPress 状態を追加取得している。本画面では WordPress を扱わない（異常の概念が「未設定」しか無いため。§4 Non-goal）。
- DB 障害と「未連携」の区別: `getGscCredentialByUserId` は DB エラーでも `null` を返す（`/setup` と同じ）。本画面では未連携として表示され、項目 7 にはならない。service 側で `console.error` は出る。strict 変種の新設は見送り（受容）。Google Ads は `needsReauth:false` の `error`（未連携・一時的なリフレッシュ失敗等）を取得失敗として拾う（`isGoogleAdsFetchFailed`）。`needsReauth:true` は再連携待ちの正当な状態として区別する。
- Google側の一時的な 5xx/429 リフレッシュ失敗を「未連携」「再連携要」のいずれとも区別し、項目 7（取得失敗）に落とす（GSC/GA4 は `home-google-credential.ts`が`isGoogleOAuthReauthError`で、Google Ads は `googleAds.actions.ts`が`isGoogleAdsReauthError`で、それぞれステータスコード優先の判定を行う。`googleTokenService.refreshAccessToken` がステータスに関わらず同一文言のエラーを投げるため、文字列一致だけでは区別できないことが判明したための対策）。
- スマホ（ドロワー内のユーザーブロック）ではメールアドレスに到達できない（ツールチップ非対応）。必要になったら事業者情報かアカウント画面に出す。
- `transient` エラー（DB 一時障害）時に `/login` ⇄ `/` を往復しうるのは旧クライアント版からの既存挙動。本仕様では扱わない。
