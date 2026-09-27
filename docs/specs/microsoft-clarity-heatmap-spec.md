# Microsoft Clarity によるヒートマップ導入 要件定義

## メタデータ

- 文書名: Microsoft Clarity によるヒートマップ導入
- ステータス: `implemented`
- 作成日: 2026-09-27
- 最終更新日: 2026-09-27
- 作成者: 遠藤
- 承認者: 遠藤
- 対象リリース: 単独リリース（他機能と依存なし）
- 関連する依頼・Issue・PR:
  - Lark タスク t100492「ヒートマップ入れる」（説明: 「↓Clarityでユーザー行動分析できる（ヒートマップ）https://clarity.microsoft.com/」）
  - 対象の解釈は 2026-09-27 遠藤決定: 「GrowMate 本体にタグを入れ、Strict マスキングにしてプライバシーポリシーも直す」。その後、プライバシーポリシーへの追記は行わないことにした（2026-09-27 遠藤決定「プライバシーポリシーに書かなくて良い。プライバシーポリシーは Google や Instagram の審査用に作ったもので、一般公開はしないため基本的には誰も見ない想定」。§11 ALT-003）。顧客ブログのヒートマップを GrowMate に表示する案は採らない（§11 ALT-001）

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか: GrowMate の開発・運営側が、利用者がどの画面のどこを操作し、どこで迷っているかを把握する手段を持っていない。画面改善の判断が利用者の声と推測だけに依存している。
- 放置した場合の影響: 使われていない導線や、押しても反応しない箇所（デッドクリック）・苛立ちクリック（レイジクリック）に気づけない。

### 目的

- この開発で実現する状態: GrowMate の全画面に Microsoft Clarity を導入し、開発・運営側が Clarity の管理画面でヒートマップと操作の再生を見られる。
- 利用者・事業にとっての価値: 画面改善の優先順位を実際の操作データで決められる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 本番の操作データ取得 | なし | 本番反映後に Clarity 管理画面でセッションが記録される | Clarity 管理画面の Dashboard / Recordings | 本番反映の翌日（運用完了条件。§15） |
| マスキング | なし | 記録された再生で画面の文字・画像・入力欄がすべて伏せ字 | Clarity の Recordings を1件以上目視 | 本番反映の翌日（運用完了条件。§15） |
| CSP 違反 | なし | Clarity 由来の CSP 違反がブラウザコンソールに出ない | 本番画面の DevTools コンソール | 本番反映直後（運用完了条件。§15） |

成功指標はすべてマージ後に運用担当（遠藤）が測る。spec-to-pr の完了条件には含めない（§15 実装完了条件を参照）。

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | GrowMate の全利用者（ロール問わず）と未ログインの訪問者 | 画面の使い方は変わらない。操作情報が Microsoft に送信される。画面の文字・画像・入力欄は伏せ字になるが、閲覧したページの URL（絞り込み条件を含む）とクリックしたリンクの URL は伏せ字にならない（§9「URL の伏せ字」） |
| 運用担当 | 遠藤 | Clarity プロジェクトの作成、マスキング設定、Vercel 環境変数の設定 |
| 管理者・承認者 | 遠藤 | 仕様の承認。プライバシーポリシーを変更しないため、クライアントの文言確認は不要（ALT-003） |
| 外部サービス・連携先 | Microsoft Clarity | 操作情報の収集・ヒートマップと再生の提供 |

### 主な利用シナリオ

1. **運用担当が**、**画面改善を検討するとき**、**Clarity 管理画面で対象ページのヒートマップを開き、クリックとスクロールの分布を確認したい**。
2. **運用担当が**、**利用者から「ボタンが効かない」と問い合わせを受けたとき**、**Clarity の再生で操作の流れを確認したい**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
利用者が画面を操作する → 操作の記録は残らない → 改善判断は問い合わせと推測
```

### 導入後（To-Be）

```text
利用者が画面を操作する
  → ブラウザで Clarity が画面の内容を伏せ字化し、操作情報を Microsoft へ送信（URL は伏せ字にならない）
  → 運用担当が Clarity 管理画面でヒートマップ・再生を見る
  → 画面改善の優先順位を決める
```

### 業務ルール

- ルール ID: BR-001
- ルール: 画面に表示される文字・画像・入力欄の内容は、送信前にすべて伏せ字にする。Clarity 管理画面の設定に依存せず、コード側で全体を伏せ字にする。対象はルートレイアウト（`app/layout.tsx`）と、ルートレイアウトの代わりに描画されるエラー画面（`app/global-error.tsx`）の両方の `<body>`（FR-003）。
- 例外: なし。一部の見出しやナビゲーションを見えるようにする（伏せ字の解除）は今回行わない（§4 Non-goals）。URL は Clarity の仕様で伏せ字の対象外（§9「URL の伏せ字」）で、URL パラメータの伏せ字化の依頼は今回行わない（§4 Non-goals）。

- ルール ID: BR-002
- ルール: Clarity は本番環境でのみ動かす。プロジェクト ID の環境変数が未設定の環境（ローカル・プレビュー）では読み込まない。
- 例外: 実装時の動作確認では、ローカルに一時的に環境変数を設定してよい。
- 決定者・根拠: Claude案・未確認。2026-09-27 遠藤決定（メタデータ）は「GrowMate 本体にタグを入れる」までで、本番限定は含まない。コードで環境を判定する仕組みは作らず、運用担当が Vercel の Production にだけ環境変数を設定する（§10 依存関係）ことで成り立つ。遠藤の要件承認（§16 承認）で確定する。

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: 全ページ（ルートレイアウト配下）に Clarity の読み込みスクリプトを追加する。画面の見た目・操作は変わらない。`app/layout.tsx` と `app/global-error.tsx` の `<body>` に伏せ字の属性を付ける（FR-003）。プライバシーポリシー（`/privacy`）は変更しない（ALT-003）。
- API・外部連携: Microsoft Clarity（ブラウザからの送信のみ。サーバーからの API 呼び出しはない）。
- データ・DB: なし。
- 権限・ロール: 全ロールと未ログインの訪問者が対象（§6 権限）。
- 運用・監視: Clarity プロジェクトの作成と Strict マスキング設定、Vercel の本番環境変数の設定（運用担当の手作業）。

### Non-goals（今回の対象外）

| 対象外にするもの | 対象外にする理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| 顧客ブログのヒートマップを GrowMate 画面に表示する | Clarity Data Export API はヒートマップ・再生を返さず、1プロジェクト1日10リクエスト・直近1〜3日分に制限される（§9 公式根拠）。顧客サイトごとのタグ設置も必要で、目的に対して費用が見合わない | クライアントから顧客向け機能として明示的に依頼されたとき |
| 見出し・ナビゲーションの伏せ字解除（`data-clarity-unmask`） | どの要素なら個人・顧客情報を含まないかの洗い出しが必要。全体伏せ字でもクリック位置と画面構造は見える | 伏せ字のせいでヒートマップが読めないと運用担当が判断したとき |
| 同意バナー（Cookie 同意の取得） | 利用者は日本の事業者で、Clarity が同意シグナルを求める EEA・英国・スイスの利用者は想定していない。公式は、これらの地域からの利用者がいなければ同意シグナルを送る必要はないとしている（§9 公式根拠「同意」）。Clarity 管理画面の Cookie 設定は既定（オン）のまま使う | EEA・英国・スイスの利用者を受け入れるとき。または Clarity が同意シグナルの要求を他の地域へ広げたとき（公式 FAQ "enforcement may extend to other regions in the future"） |
| プライバシーポリシー（`/privacy`）への Clarity 利用の追記（FR-005） | 2026-09-27 遠藤決定。`/privacy` は Google・Instagram の審査用で一般公開しない想定（§11 ALT-003）。利用規約 4.4(b) の開示義務を満たさない点は R-003 で受容 | `/privacy` を一般公開するとき |
| 画面フッター等への導入表示（Clarity 公式の「Site Disclosure」推奨） | 公式は推奨（"We recommend"）であり必須ではない。プライバシーポリシーにも記載しない方針（ALT-003）と合わせて行わない | クライアントが画面上での表示を求めたとき |
| Google Analytics との連携（Clarity の GA 連携） | GrowMate 本体に GA タグは入っていない | GrowMate 本体に GA を入れるとき |
| `@microsoft/clarity` npm パッケージ | Clarity 管理画面の tracking code（§6、Q-001）をインラインで入れれば足りる。依存追加は不要 | Clarity のカスタムイベント・タグ API を使うとき |
| Clarity 停止用の専用スイッチ | 環境変数を外して再デプロイすれば止まる（既存手段） | なし |
| URL パラメータの伏せ字化（Clarity サポートへの依頼） | 依頼の要件がない。URL がそのまま送信されることは R-002 で受容する。公式は Clarity サポートへの依頼で対応するとしている（§9「URL の伏せ字」） | クライアントが求めたとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-09-27 遠藤）
- 含めるもの: 読み込みスクリプト追加、CSP 変更、環境変数定義、実装時の確認（§13）
- 含めないもの: 仕様レビュー往復、クライアントの文言確認待ち、Clarity プロジェクト作成と Vercel 環境変数設定（運用担当の手作業、約0.5時間）

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 実装 | 読み込みスクリプト・CSP・環境変数 | 2 | 0.25 |
| 検証 | `npm run verify`、ブラウザでの読み込み確認と CSP ヘッダーの確認（実装完了条件）。本番での CSP 違反なし・送信確認は運用完了条件（§15） | 1〜2 | 0.125〜0.25 |
| **合計** |  | **3〜4** | **0.4〜0.5** |

幅の理由: `'strict-dynamic'` 下での読み込みが想定どおり通るか（§12 R-001）。通らなければ CSP の調整に時間を使う。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: 1日以内
- クライアント確認・たたき台合意の見込み: なし（プライバシーポリシーを変更しないため。ALT-003）
- 希望リリース時期との関係: 指定なし

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | 全ページで Clarity の読み込みスクリプトを実行する | Must | Lark t100492、2026-09-27 遠藤決定 | プロジェクト ID の環境変数を設定した状態で任意のページを開くと、ハイドレーション後の DOM に `script#microsoft-clarity` があり、Network に `https://www.clarity.ms/tag/<プロジェクト ID>` の取得があり、コンソールに CSP 違反が出ない（実装完了条件。確認方法とブラウザが使えない場合の代替は §13）。本番で `https://www.clarity.ms/collect` への POST が発生する（運用完了条件。§15） |
| FR-002 | プロジェクト ID の環境変数が未設定なら読み込まない | Must | BR-002 | 環境変数未設定で起動したとき、ページの HTML と DOM に `microsoft-clarity` のスクリプトがなく、`clarity.ms` への通信も起きない（`<body>` の `data-clarity-mask` は FR-003 により残る） |
| FR-003 | 画面全体を伏せ字にする | Must | BR-001、2026-09-27 遠藤決定（Strict マスキング） | `app/layout.tsx` と `app/global-error.tsx` の `<body>` に `data-clarity-mask="true"` が付く（実装完了条件）。Clarity の再生で文字・画像が伏せ字になる（運用完了条件。§15） |
| FR-004 | CSP で Clarity の通信を許可する | Must | Clarity 公式 CSP 要件（§9） | CSP ヘッダーの差分が `connect-src`・`img-src` へのホスト追加だけで、既存の CSP 指定（nonce・`'strict-dynamic'`・既存ホスト）は変えない（実装完了条件）。本番で Clarity 由来の CSP 違反がコンソールに出ない（運用完了条件。§15） |
| FR-005 | プライバシーポリシーに Microsoft Clarity の利用を追記する | Won't | 2026-09-27 遠藤決定「プライバシーポリシーに書かなくて良い。プライバシーポリシーは Google や Instagram の審査用に作ったもので、一般公開はしないため基本的には誰も見ない想定」（§11 ALT-003） | `/privacy` を変更しない |

### FR ごとの実装上の決定

- FR-001 / FR-002（spec-review audit（2026-09-27）で公式ドキュメント・既存コードと照合済み。根拠: Next.js 同梱ドキュメント `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` の「Reading the nonce」（`(await headers()).get('x-nonce')` と `<Script strategy="afterInteractive" nonce={nonce}>` の例）、`src/lib/supabase/middleware.ts:26-29`、`app/layout.tsx:14`）
  - 環境変数名は `NEXT_PUBLIC_CLARITY_PROJECT_ID`。`src/env.ts` の `clientEnvSchema` に任意項目（`z.string().min(1).optional()`）として追加し、`clientRuntimeEnv`・`clientKeys` にも足す。
  - `app/layout.tsx` の `RootLayout` を `async` 関数にし、`next/headers` の `headers` を import する（現在は同期関数で `headers()` を使っていない。`app/layout.tsx:14`）。
  - `RootLayout` で `(await headers()).get('x-nonce')` から nonce を取得し（戻り値の `null` は `undefined` にして渡す）、`next/script` の `<Script id="microsoft-clarity" strategy="afterInteractive" nonce={nonce}>` に Clarity の読み込みスクリプト（インライン）を渡す。スクリプト本文は **§6「Clarity 読み込みスクリプト」に転記した Clarity 管理画面の tracking code**を使い、そのうちプロジェクト ID の箇所に `NEXT_PUBLIC_CLARITY_PROJECT_ID` の値を渡す。プロジェクト ID が未設定なら `<Script>` を描画しない。nonce の読み方は上記 Next.js 同梱ドキュメント「Reading the nonce」に従う。
  - `x-nonce` はリクエストヘッダーとして `src/lib/supabase/middleware.ts` の `updateSupabaseSession` が全リクエストに付けている（既存）。
- FR-001 の補足（`next/script` の出力）: `strategy="afterInteractive"` の `<Script>` はサーバー描画時に `<script>` 要素を出さない（`node_modules/next/dist/client/script.js:319-335` で `return null`）。要素はハイドレーション後に `useEffect`（`:217-224`）→ `loadScript` の `document.body.appendChild`（`:131`）で作られる。そのため FR-001 の完了確認は SSR の HTML ではなく、ブラウザでの動作（DOM・Network・コンソール）で行う。完了確認を満たすために `beforeInteractive` や生の `<script>` へ書き換えない。
- FR-003: `app/layout.tsx` の `<body>` に `data-clarity-mask="true"` を常に付ける（環境変数の有無に関わらない。Clarity が無ければ無害）。`app/global-error.tsx:23` の `<body style={{ padding: 24 }}>` にも `data-clarity-mask="true"` を付ける（理由: `global-error.tsx` は自前の `<html>`・`<body>` を描画し、ルートレイアウトを置き換える。Next 同梱ドキュメント `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:163`: "Global error UI must define its own `<html>` and `<body>` tags … This file replaces the root layout or template when active."。読み込み済みの Clarity はエラー画面でも記録を続け、`:35` で `{error?.message}` を表示するため）。公式: `data-clarity-mask` は "That node and its children's contents are masked. This overrides anything set on the Clarity website."（§9）。加えて運用担当が Clarity 管理画面のマスキングモードを Strict にする（二重化。コード側が正）。
- FR-004: `proxy.ts` の `buildCspHeader` で `connect-src` と `img-src` に `https://*.clarity.ms https://c.bing.com` を追加する。公式の例は `default-src` への追加だが、`proxy.ts:37-38` は `img-src`・`connect-src` を個別に指定しており、個別指定のあるディレクティブには `default-src` が適用されないため、この2つに足す。`script-src` は変更しない（nonce 付きスクリプトが挿入したスクリプトは `'strict-dynamic'` で許可され、`'strict-dynamic'` 下ではホスト指定は無視されるため）。
- FR-005: 実装しない（§11 ALT-003）。`app/privacy/page.tsx` は変更しない。

### Clarity 読み込みスクリプト（Q-001 回答済み・2026-09-27）

Clarity 管理画面（プロジェクト「GrowMate」、Web サイト URL `https://www.growmate.tokyo`（本番の表示先。`growmate.tokyo` は www へリダイレクト。2026-09-27 に修正）、プロジェクト ID `yoo4bko8re`）の「手動でインストールする」→「追跡コードを取得する」の内容をそのまま転記する（2026-09-27 取得）。プロジェクト ID は HTML に出る公開値。

```html
<script type="text/javascript">
(function(c,l,a,r,i,t,y){
c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "yoo4bko8re");
</script>
```

- 実装では `<script>` タグの中身（即時関数）を `next/script` の子に渡し、最後の引数 `"yoo4bko8re"` を `NEXT_PUBLIC_CLARITY_PROJECT_ID` の値に置き換える（値は `JSON.stringify` で文字列リテラル化して埋め込む）。
- 同じプロジェクトのマスキングモードは 2026-09-27 に「厳密」（Strict）へ変更済み（管理画面に「マスク表示モードを設定しました」を確認）。

### 入力・出力・状態遷移

- 入力値・形式・必須条件: `NEXT_PUBLIC_CLARITY_PROJECT_ID`（Clarity のプロジェクト ID。任意）
- 正常時の出力: ブラウザから Clarity への操作情報の送信
- エラー時の出力: Clarity の読み込み・送信に失敗しても画面の動作には影響しない（`afterInteractive` の非同期読み込み）。利用者には何も表示しない
- 状態と遷移条件: 該当なし
- 冪等性・重複実行時の挙動: ルートレイアウトで1回だけ描画する。クライアント側の画面遷移で再読み込みされない（`next/script` の `id` で重複を防ぐ）

### 画面設計

画面の追加・変更はない（`/privacy` も変更しない。ALT-003）。

### 権限

新規機能の既定（`admin` / `paid` のみ）の例外とする。

- 理由: 本件は利用者に提供する機能ではなく、サービス全体の利用状況を把握する計測である。タグはルートレイアウトで全ページに入れ、ロールで出し分けない。全ロールと未ログインの訪問者を対象にしないと、画面改善の判断材料にならない。
- 根拠: 2026-09-27 遠藤決定「GrowMate 本体にタグを入れ」（メタデータ）。GrowMate 本体全体に入れる決定のため、ロールによる出し分けを含まない。

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| admin / paid / trial / unavailable / 未ログイン | 計測対象（画面上の変化なし） | 該当なし | 該当なし | 該当なし |

Clarity 管理画面の閲覧権限は Clarity 側のプロジェクトメンバーで管理する（GrowMate のロールとは無関係）。

## 7. Gherkin受け入れ条件

```gherkin
Feature: Microsoft Clarity による操作計測

  Rule: プロジェクト ID が設定された環境でのみ計測する

  Scenario: 本番で任意のページを開くと Clarity が読み込まれる
    Given Clarity のプロジェクト ID が環境変数に設定されている
    When 利用者が GrowMate の任意のページを開く
    Then Clarity の読み込みスクリプトが実行される
    And Clarity への操作情報の送信が発生する
    And ブラウザのコンソールに Clarity 由来の CSP 違反が出ない

  Scenario: プロジェクト ID が未設定の環境では読み込まない
    Given Clarity のプロジェクト ID が環境変数に設定されていない
    When 利用者が GrowMate の任意のページを開く
    Then Clarity の読み込みスクリプトは含まれない
    And Clarity への通信は発生しない

  Rule: 画面の内容は伏せ字にして送る

  Scenario: 記録された再生で画面の内容が読めない
    Given Clarity が読み込まれている
    When 利用者がチャット画面で本文を表示する
    Then Clarity の再生では本文の文字が伏せ字になっている
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 本番で任意のページを開くと Clarity が読み込まれる | FR-001, FR-004 | 2026-09-27 遠藤決定 |
| プロジェクト ID が未設定の環境では読み込まない | FR-002 | BR-002 |
| 記録された再生で画面の内容が読めない | FR-003 | BR-001 |

確認する時期の区分（§15）:

- spec-to-pr（実装完了条件）で確認する: 「本番で任意のページを開くと Clarity が読み込まれる」のうち、ローカルのブラウザでハイドレーション後の DOM に `script#microsoft-clarity` があり、Network に `https://www.clarity.ms/tag/<プロジェクト ID>` の取得があり、コンソールに CSP 違反が出ないこと（ブラウザが使えない場合の代替は §13）。「プロジェクト ID が未設定の環境では読み込まない」。「プライバシーポリシーに Clarity の利用が書かれている」。
- マージ後に運用担当が確認する（運用完了条件）: 「本番で任意のページを開くと Clarity が読み込まれる」のうち、Clarity への送信（`collect` への POST）と CSP 違反が無いこと。「記録された再生で画面の内容が読めない」（Clarity 管理画面でしか確認できない）。

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 初期表示を妨げない | `strategy="afterInteractive"` で非同期読み込み | 確定 |
| 可用性・信頼性 | Clarity 障害時も GrowMate の動作に影響しない | 読み込み失敗は画面の動作に関与しない構造 | 確定 |
| セキュリティ・プライバシー | 画面の文字・画像・入力欄を送信しない。URL（ページ URL・クリックしたリンクの URL）は伏せ字の対象外で、そのまま送信される（§9「URL の伏せ字」）。CSP は既存の nonce・`'strict-dynamic'` を維持し、許可ホストの追加のみ | `data-clarity-mask="true"`（FR-003）、Clarity 再生の目視、CSP ヘッダーの差分確認 | 確定。GrowMate の画面 URL にトークン等を含むページが無いことを確認済み（ページ側で `code`・`token` 等のクエリを読む箇所なし。OAuth コールバックは Route Handler）。ただし `/analytics?category=` は顧客の WordPress カテゴリ名を URL に載せており（`app/analytics/AnalyticsClient.tsx:262-265`）、伏せ字なしで送信される。この点はプライバシーポリシーに書く（FR-005）。URL パラメータの伏せ字化は今回行わない（§4 Non-goals） |
| 認証・認可 | 変更なし | - | 対象外 |
| 監査・ログ | 変更なし | - | 対象外 |
| 障害対応 | Clarity を止めたいときは Vercel の環境変数を外して再デプロイ | - | 確定（既存手段） |
| バックアップ・復旧 | データを持たない | - | 対象外 |
| 運用・監視 | Clarity 管理画面で確認 | - | 確定 |
| 拡張性・互換性 | Clarity は "It requires some modern browser APIs but should never throw exceptions on older browsers." | - | 公式記載 |
| アクセシビリティ | 画面の見た目・操作は変わらない | - | 対象外 |
| コスト | Clarity は無料 | - | 確定 |

AI 機能ではないため「AI機能の追加観点」は対象外。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: GrowMate の DB には何も保存しない。操作情報は Microsoft Clarity 側に保存される。
- データの所有者: Clarity プロジェクトの管理者（運用担当）
- 保持期間・削除条件: Clarity 側の保持期間に従う。公式 FAQ（https://learn.microsoft.com/en-us/clarity/faq 、2026-09-27 確認）: "Clarity retains recordings for 30 days from the time of recording. However, Favorite recordings and randomly selected sample of recordings are retained for up to 9 months."
- 移行・既存データとの互換性: 該当なし
- RLS・Service Role・ユーザー境界: 該当なし

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Microsoft Clarity | 操作情報の収集、ヒートマップ・再生の表示 | ブラウザからのスクリプト読み込みと送信のみ。API キー不要 | 送信されないだけで画面は通常どおり動く | 下記 |

公式根拠（2026-09-27 確認）:

- CSP: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp — "Example: `default-src 'self' https://*.clarity.ms https://c.bing.com 'unsafe-inline';`"。本件は `'unsafe-inline'` を使わず、nonce + `'strict-dynamic'` のまま `connect-src`・`img-src` にホストを足す。
- マスキング: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking — "Strict: The entire content is masked." / "Balanced: Only sensitive content is masked. We classify numbers and email addresses as sensitive content." / "Content in the input boxes is masked in all modes and can't be customized." / `data-clarity-mask`: "That node and its children's contents are masked. This overrides anything set on the Clarity website." / "The masking ensures it's never uploaded to Clarity."
- URL の伏せ字: https://learn.microsoft.com/en-us/clarity/faq（2026-09-27 確認）— "Does Clarity support masking URL Parameters? Yes. Contact Clarity support to request URL parameter masking." / "For URLs, Masking only applies to page URL. Currently, it doesn't apply to other URLs that Clarity captures such as: - Referrer URLs - Clicked URLs (the URLs that are captured when a user clicks on the page)."
  - 解釈: `data-clarity-mask` が伏せ字にするのは DOM の中身だけで、ページ URL は Clarity サポートへ依頼しない限り伏せ字にならない。クリックしたリンクの URL・参照元 URL は依頼しても対象外。URL がそのまま送信されることは R-002 で受容する（開示は ALT-003 により行わない）。サポートへの依頼は §4 Non-goals。
- 開示: https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure — "Ensure your Privacy Policy properly communicates to your users on how you're using Clarity" と、記載すべき事項（Clarity の利用、収集データと目的、Microsoft Privacy Statement へのリンク）。
- 利用規約: https://clarity.microsoft.com/terms（2026-09-27 取得）
  - 4.4(b): "Your privacy notice will disclose that third parties such as Microsoft may collect Personal Data from individuals visiting Your websites and offer appropriate opt-out choices as required by Data Protection Law. You will disclose in your privacy notice the fact that Microsoft collects or receives Personal Data from you to provide Microsoft Advertising, and provide a link to the Microsoft Privacy Statements: https://privacy.microsoft.com/en-us/privacystatement." → FR-005 の文言に反映。
  - 4.4(c)(i): "You and Microsoft are independent Controllers of the Personal Data Processed in connection with the Offering." → Microsoft は委託先ではなく独立した管理者。プライバシーポリシー §5 末尾の「業務委託契約の目的達成に必要な最小限」の文は Microsoft には当てはまらないため、FR-005 の段落で Microsoft 側の利用を別に書く。
  - 4.4(c)(ii): "You will not knowingly disclose Personal Data that includes Sensitive Data to Microsoft." / 1(b)(ii): "You will not use the Offering in connection with content which may contain sensitive user materials, such as health care, financial services or government-related information." → FR-003 の全体伏せ字で画面内容を送らないことで満たす。
  - 1(b)(i): "You will not use the Offering to create user profiles." → 本件は画面改善の分析のみ。Clarity の識別情報を GrowMate のユーザーに紐付ける API（`identify` 等）は使わない。
- 設置・確認: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup — "Clarity shouldn't be used on any websites/apps targeting users under the age of 18 globally."（GrowMate は事業者向けのため該当しない）、送信確認は "See POST requests to https://www.clarity.ms/collect"。設置手順は "Copy the code and paste it into the `<head>` section of your website or web app." で、スクリプト本文はこのページに載っていない（本文は管理画面から取得し、§6「Clarity 読み込みスクリプト」に転記済み）。
- 同意: https://learn.microsoft.com/en-us/clarity/faq — "If no users visit your site from the EEA, UK, or Switzerland, there is no impact on your Clarity experience and no need to send an explicit consent signal. However, it is recommended to implement this signal where relevant, as enforcement may extend to other regions in the future or new users from the impacted regions might access your site." / https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-mode — "Consent Mode is enabled by default for all users originating from the European Economic Area (EEA), United Kingdom (UK), and Switzerland (CH)."
  - 解釈: GrowMate は EEA・英国・スイスの利用者を想定していないため、同意シグナルの送信（同意バナー）は不要とする（§4 Non-goals）。他の地域へ要求が広がった場合は、§4 の「将来検討する条件」で見直す。
- Data Export API（Non-goal の根拠）: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api — "Maximum of 10 API requests are allowed per project per day." / "Data retrieval is confined to the previous 1 to 3 days."。返す指標は集計値のみでヒートマップ・再生は含まない。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準:
  - CSP は `proxy.ts` の `buildCspHeader`（nonce + `'strict-dynamic'`）
  - `app/layout.tsx` は `force-dynamic`（nonce 付与のため。外さない）
- 再利用する既存実装:
  - 再利用: `x-nonce` リクエストヘッダー（`src/lib/supabase/middleware.ts` の `updateSupabaseSession`）
  - 再利用: `next/script`（Next.js 同梱。新規依存なし）
  - 拡張: `src/env.ts` の `clientEnvSchema`（任意項目を1つ追加）
  - 拡張: `app/global-error.tsx` の `<body>`（`data-clarity-mask="true"` を付ける。FR-003）
- `.env.example`: 変更しない。理由: 既存の任意項目はプレースホルダ付きで列挙されている（`.env.example:47-59`）が、空文字で足すとコピーした環境が `src/env.ts` の `min(1)` で起動時に落ち、プレースホルダを入れるとローカルでも Clarity が読み込まれて BR-002 に反する（spec-review audit 2026-09-27 の修正案に従う）。
- README: `README.md` の「📋 環境変数」節の「区分」行に `NEXT_PUBLIC_CLARITY_PROJECT_ID` を足す見込み（`README.md` の「追加・リネーム時は `env.ts` の更新と README の『区分』行の見直し」に従う）。要否の判断は spec-to-pr の readme_sync に任せる。

### 制約条件

- 納期・予算・人員: なし
- 法令・契約・審査: Clarity 利用規約 4.4(b) はプライバシーポリシーでの開示を求めているが、本件では開示しない（ALT-003・R-003 で受容）
- 変更できない既存仕様: CSP の既存指定（nonce・`'strict-dynamic'`・既存の許可ホスト）

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| Clarity プロジェクト | 運用担当が spec-to-pr の前に作成し、マスキングモードを Strict にする。"Get tracking code" の内容を §6 に貼る（Q-001） | 完了（2026-09-27。プロジェクト ID `yoo4bko8re`、Strict 設定済み、§6 に転記済み） | 読み込みスクリプトの本文が確定せず、FR-001 を実装できない |
| Vercel 環境変数 | 運用担当が Production に `NEXT_PUBLIC_CLARITY_PROJECT_ID` を設定 | Vercel の Environment Variables | 本番で計測が始まらない。`NEXT_PUBLIC_*` はビルド時に埋め込まれるため設定後に再デプロイが必要 |

## 11. トレードオフ判断

### ALT-001: 何にヒートマップを入れるか

- 判断: GrowMate 本体に Clarity を入れる
- 比較した案:
  - 案A: GrowMate 本体に Clarity タグを入れ、運用側が利用者の操作を分析する
  - 案B: 顧客のブログにタグを入れてもらい、Clarity のデータを GrowMate の画面に表示する
- 採用案: 案A
- 採用理由: タスク説明「Clarityでユーザー行動分析できる」に合い、0.5人日で実現できる
- 却下した案と理由: 案B は Data Export API がヒートマップ・再生を返さず、取得回数も1日10回・直近3日分に限られる。ヒートマップを GrowMate に表示するという目的自体を満たせない
- 影響: 小
- 将来変更する条件: クライアントから顧客向け機能として依頼されたとき
- 判断者・判断日: 遠藤・2026-09-27

### ALT-002: 伏せ字の範囲と設定場所

- 判断: コード側で `<body>` 全体を伏せ字にし、Clarity 管理画面も Strict にする
- 比較した案:
  - 案A: Clarity 管理画面の Strict 設定のみ
  - 案B: コード側で `<body>` に `data-clarity-mask="true"`（管理画面の設定より優先）
  - 案C: 既定の Balanced のまま、個人・顧客情報を含む要素にだけ `data-clarity-mask` を付ける
- 採用案: 案B（＋管理画面も Strict）
- 採用理由: 管理画面の設定はコード外で変更でき、誤って Balanced に戻すとチャット本文・事業者情報・GSC の検索クエリが送信される。コード側なら PR レビューを経ないと変わらない
- 却下した案と理由: 案A は上記の理由。案C は Balanced が数字とメールアドレスしか伏せないため、漏れなく要素を指定する必要があり、画面追加のたびに漏れる
- 影響: ヒートマップ上の文字が読めない。クリック位置と画面構造で判断する
- 将来変更する条件: 伏せ字でヒートマップが読めないと判断したとき、個人・顧客情報を含まない要素に限って `data-clarity-unmask` を検討する
- 判断者・判断日: 遠藤（Strict の方針）・2026-09-27／コード側で付ける方式は spec-review audit（2026-09-27）で公式ドキュメントと照合済み（`data-clarity-mask`: "That node and its children's contents are masked. This overrides anything set on the Clarity website."。§9）

### ALT-003: プライバシーポリシーに Clarity の利用を書くか

- 判断: 書かない（FR-005 を Won't にする）
- 比較した案:
  - 案A: `/privacy` の §5 に Microsoft Clarity の利用・収集内容・URL が伏せ字の対象外であること・Microsoft Advertising での利用・Microsoft プライバシー ステートメントへのリンクを追記する（Clarity 利用規約 4.4(b) と公式の開示推奨に沿う）
  - 案B: 追記しない
- 採用案: 案B
- 採用理由: 2026-09-27 遠藤決定「プライバシーポリシーに書かなくて良い。プライバシーポリシーは Google や Instagram の審査用に作ったもので、一般公開はしないため基本的には誰も見ない想定」。
- 却下した案と理由: 案A はクライアントの文言確認（旧 Q-002・Q-003・CP-1）が必要になる一方、`/privacy` は審査用で利用者が見る想定がない
- 影響: Clarity 利用規約 4.4(b) の開示義務を満たさない（R-003）。ページ URL（`/analytics?category=` の WordPress カテゴリ名など）が伏せ字にならず送信されることも開示しない（R-002）
- 将来変更する条件: `/privacy` を一般公開するとき、Microsoft から開示を求められたとき、EEA・英国・スイスの利用者を受け入れるとき
- 判断者・判断日: 遠藤・2026-09-27

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | `'strict-dynamic'` 下で Clarity の2段階の読み込み（タグ → 本体スクリプト）がブロックされる | CSP 違反で計測されない | 本番有効化の直後に、運用担当が実ブラウザで CSP 違反と `collect` への POST を確認する（運用完了条件。§15）。ブロックされた場合は違反内容に合わせて許可を足す PR を出し、nonce・`'strict-dynamic'` は外さない | 運用担当 | 未確認 |
| R-002 | 伏せ字の漏れ | `<body>` 外（ポータル等）の要素に文字が出る。ルートレイアウトを置き換えるエラー画面（`app/global-error.tsx`）の `<body>` に属性が無い。URL に載る情報（`/analytics?category=` の WordPress カテゴリ名など）が送信される | ポータルも `<body>` 配下に描画されるため対象に含まれる。公式: `data-clarity-mask` は "That node and its children's contents are masked."（§9）。`app/global-error.tsx` の `<body>` にも属性を付ける（FR-003）。URL は Clarity の仕様で伏せ字の対象外（§9「URL の伏せ字」）で、送信を受容する（ALT-003）。本番反映後に再生を1件以上目視する（運用完了条件） | 運用担当 | 受容（URL は伏せ字にせず、開示もしない。ALT-003） |
| R-003 | Clarity 利用規約 4.4(b) の開示義務を満たさない | 規約上は Microsoft が利用を停止できる（規約 9: "Microsoft may cancel or suspend Your use of the Offering ... at any time."）。停止されても GrowMate の画面動作には影響しない | 受容（ALT-003）。`/privacy` を一般公開する時点で開示を追加する | 遠藤 | 受容 |

### 確認質問

| ID | 質問 | 回答者 | 状態 | 未回答時の扱い |
| --- | --- | --- | --- | --- |
| Q-001 | Clarity プロジェクトを作成し（マスキングモード Strict）、管理画面の tracking code を §6「Clarity 読み込みスクリプト」に貼る | 遠藤 | 回答済み（2026-09-27） | 2026-09-27 にプロジェクト「GrowMate」（ID `yoo4bko8re`）を作成し、Strict に設定、tracking code を §6 に転記済み。利用規約上の告知義務は §9「利用規約」と FR-005 に反映済み |
| Q-002 | FR-005 の追記文言で問題ないか | クライアント | 取り下げ（2026-09-27） | FR-005 を実装しないため不要（ALT-003） |
| Q-003 | この変更を利用者に「重要な変更」として告知するか | クライアント | 取り下げ（2026-09-27） | プライバシーポリシーを変更しないため不要（ALT-003） |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 伏せ字を部分的に解除する要素 | 運用してみないと、伏せ字でどこまで判断できるか分からない | 本番で1〜2週間運用した後 | 遠藤 |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認: 変更は設定値とスクリプト挿入のみでロジックを持たないため、単体テストは追加しない。
- 実装時の確認（spec-to-pr。§15 実装完了条件。ローカルで起動し、`NEXT_PUBLIC_CLARITY_PROJECT_ID` に Q-001 のプロジェクト ID を一時的に設定する）:
  - ブラウザで任意のページを開き、ハイドレーション後の DOM に `script#microsoft-clarity` があり、Network に `https://www.clarity.ms/tag/<プロジェクト ID>` の取得があり、コンソールに CSP 違反が出ない（`afterInteractive` はサーバー描画の HTML に `<script>` を出さないため、SSR の HTML では確認しない。§6「FR-001 の補足」）
  - ブラウザが使えない環境での代替（Claude案・実測未確認）: `curl` で取得したページの HTML に `microsoft-clarity` とプロジェクト ID が含まれることを確認する（`next/script` は `'use client'` のクライアントコンポーネント（`node_modules/next/dist/client/script.js:1`）で、props が HTML 内の RSC ペイロードに載るため）。この場合、DOM・Network・コンソールの確認は運用完了条件（§14 CP-2）で行い、PR に「ブラウザ確認未実施」と書く
  - `<body>` に `data-clarity-mask="true"` がある
  - `app/global-error.tsx` の `<body>` に `data-clarity-mask="true"` がある（エラー画面は意図的に起こしにくいため、コードの差分で確認する）
  - CSP ヘッダーの差分が `connect-src`・`img-src` へのホスト追加のみ
  - 環境変数を外して起動し直すと、HTML と DOM に `microsoft-clarity` のスクリプトがなく、`clarity.ms` への通信も起きない（`<body>` の `data-clarity-mask` は FR-003 により残る）
- マージ後の確認（運用担当・遠藤。§15 運用完了条件。本番）:
  - 任意のページで DevTools のコンソールに Clarity 由来の CSP 違反が出ない
  - Network に Clarity のスクリプト取得と `collect` への POST がある
  - Clarity のドメインを DevTools でブロックしても画面が通常どおり動く
  - 翌日、Clarity 管理画面の再生が伏せ字になっている
- Gherkinシナリオとの対応: §7 シナリオ対応表と「確認する時期の区分」のとおり
- 外部API・失敗系・境界条件: 上記「マージ後の確認」の DevTools でのブロック確認
- セキュリティ・権限・RLS: CSP ヘッダーの差分が `connect-src`・`img-src` へのホスト追加のみであること（実装時の確認）
- 非機能要件の測定: 該当なし
- 品質ゲート: `npm run verify`

### リリース方針

- リリース単位・段階展開: 通常デプロイ。本番の計測開始は Vercel の環境変数設定と再デプロイで行う
- Feature Flag / allowlist: 環境変数の有無で切り替え（新規の仕組みは作らない）
- データベース変更の適用順序: なし
- 本番確認項目: §13 テスト方針の「マージ後の確認」（コンソールに CSP 違反なし、`collect` への POST あり、翌日に Clarity 管理画面でセッションと伏せ字の再生を確認）

### ロールバック方針

- アプリケーションの戻し方: Vercel の環境変数 `NEXT_PUBLIC_CLARITY_PROJECT_ID` を削除して再デプロイ（計測だけ止まる）。環境変数は空文字にせず削除する（空文字は `src/env.ts` の `z.string().min(1)` に反し、`clientEnvSchema.parse` で起動時の検証に落ちる）。コード全体を戻す場合はデプロイの巻き戻し
- DB変更の戻し方・逆マイグレーション: なし
- データ不整合時の復旧: なし。Clarity 側の記録は Clarity 管理画面でプロジェクトを削除できる
- ロールバック判断者: 遠藤

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. 運用担当が Clarity プロジェクトを作成し（Strict）、"Get tracking code" の内容を §6 に貼る（Q-001。2026-09-27 完了）
3. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
4. 実装（`.takt/workflows/spec-to-pr.yaml`。PR 作成まで）。コードの変更ファイル: `src/env.ts`、`app/layout.tsx`、`app/global-error.tsx`、`proxy.ts`（`.env.example` は変更しない。§10）
5. 品質ゲート通過（`npm run verify`）と §13「実装時の確認」
6. PR作成・レビュー
7. マージ
8. 運用担当が Vercel の Production に環境変数を設定し、再デプロイ
9. 運用担当が §13「マージ後の確認」を行う（CP-2）

### チェックポイント

| ID | チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- | --- |
| CP-1 | 本番へ反映されるマージの前 | 取り下げ（2026-09-27。プライバシーポリシーを変更しないため。ALT-003） | - | 不要 |
| CP-2 | 本番有効化の直後と翌日 | §13「マージ後の確認」（CSP 違反なし、`collect` への POST、再生が伏せ字） | 遠藤 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - **実装完了条件（spec-to-pr）**:
    - `npm run verify` が通る
    - ハイドレーション後の DOM に `script#microsoft-clarity` があり、Network に `https://www.clarity.ms/tag/<プロジェクト ID>` の取得があり、コンソールに CSP 違反が無い（FR-001。ブラウザが使えない場合の代替は §13）
    - `app/layout.tsx` と `app/global-error.tsx` がともに `<body data-clarity-mask="true">` になっている（FR-003）
    - CSP ヘッダーの差分が `connect-src`・`img-src` へのホスト追加だけ（FR-004）
    - 環境変数を外すと、HTML と DOM に `microsoft-clarity` のスクリプトが無く、`clarity.ms` への通信も起きない（FR-002。`data-clarity-mask` は FR-003 により残る）
  - **運用完了条件（遠藤・マージ後）**:
    - 本番で Clarity への `collect` の POST がある（FR-001）
    - 本番で Clarity 由来の CSP 違反が無い（FR-004）
    - 翌日、Clarity 管理画面の再生が伏せ字になっている（FR-003）
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - 実装完了条件: `npm run verify` の結果と、ブラウザでの DOM・Network・コンソール（または §13 の代替）、CSP ヘッダーの確認結果を PR に記載
  - 運用完了条件: 本番のコンソール（CSP 違反なし）と Network（`collect` への POST）、Clarity 管理画面の再生の確認結果
- 完了確認者・確認日: 遠藤・未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-27 | 2 / 7 / 5 | 🔴2・🟡7・🟢5 をすべて本文へ反映。🔴 完了条件の混在 → §15 を実装完了条件／運用完了条件に分け、§1・§7・§12 R-001・§13・§14 をそろえた。🔴 プライバシーポリシーのゲート → §14 CP-1 を「本番へ反映されるマージの前・実装のブロッカーにしない」にし、§10・§12（Q-002）もそろえた。🟡 読み込みスクリプト → §12 Q-001（遠藤・未回答）と §6 の記入欄を追加し、§14 でプロジェクト作成を仕様レビューの前へ移した。🟡 外部リンクのマークアップ → ファイル内の共通コンポーネントに変更し、追加位置を file:line で明記。🟡 権限の例外 → 理由と根拠（遠藤決定）を明記。🟡「Claude案・未確認」→ 照合済みの根拠と `RootLayout` の `async` 化を明記。🟡 同意バナー → §9 に公式引用を追加。🟡 重要な変更の告知 → Q-003 を追加。🟡 レビュー記録 → 本行。🟢 README の予告（§10）、R-002 対策済み・保持期間の引用（§9・§12）、FR-004 で `default-src` を使わない理由、環境変数は空にせず削除（§13）、利用規約の確認（Q-001・§14 手順2） | なし。未解決として Q-001（遠藤の回答待ち）が残る。Q-002・Q-003 はマージ前ゲート（CP-1）で、仕様レビュー・実装のブロッカーにしない |
| 2 | 2026-09-27 | 1 / 3 / 3 | 7件すべて本文へ反映。🔴 ARCH-NEW-spec-L148-url-not-masked → FR-005 の段落に URL が伏せ字の対象外である一文を追加（最終文言は Q-002 / CP-1）、§9 に公式 FAQ の原文と解釈、§8・R-002 に `/analytics?category=` の送信、§2・§3・BR-001 の記述をそろえ、URL パラメータの伏せ字化を §4 Non-goals へ。🟡 ARCH-NEW-spec-L130-script-not-in-ssr-html → FR-001・§7・§13・§15 の完了確認をブラウザでの動作（DOM・Network・コンソール）に変え、§6 に `next/script` の出力の補足、§13 にブラウザが使えない場合の代替（Claude案・実測未確認）を追加。🟡 ARCH-NEW-spec-L131-fr002-evidence-conflict → FR-002・§13・§15 を「`microsoft-clarity` のスクリプトと `clarity.ms` への通信が無い（`data-clarity-mask` は残る）」に変更。🟡 ARCH-NEW-spec-L72-global-error-body-unmasked → FR-003・BR-001・§4・§10・§13・§14 手順4・§15 に `app/global-error.tsx` の `<body>` を追加。🟢 ARCH-NEW-spec-L311-env-example-unspecified → §10 に「`.env.example` は変更しない」と理由。🟢 ARCH-NEW-spec-L76-br002-no-decider → BR-002 に「Claude案・未確認」と成り立つ仕組みを明記。🟢 ARCH-NEW-spec-L370-q002-rejection-path → Q-002 の未回答時の扱いに「拒否なら導入見送り・PR クローズ」を追加 | なし。BR-002 は Claude案・未確認のまま、遠藤の要件承認（§16 承認）で確定する。Q-002・Q-003 はマージ前ゲート（CP-1）で、仕様レビュー・実装のブロッカーにしない |

#### 公式ドキュメント照合

- 実施（spec-review audit、2026-09-27。revise で追加した引用も 2026-09-27 に WebFetch で原文を確認）
- 参照 URL と確認日（YYYY-MM-DD）: §9 に記載（すべて 2026-09-27 確認）
- 確認済み: https://clarity.microsoft.com/terms（2026-09-27。WebFetch では本文が取れないため Chrome で取得）
- 第2回（spec-review audit、2026-09-27）: 実施（WebFetch）。ただし https://clarity.microsoft.com/terms は audit の WebFetch で本文を取得できず、audit 時点では未確認（§9 の引用は上記の Chrome 取得による）。revise で公式 FAQ の URL の伏せ字に関する原文を 2026-09-27 に WebFetch で確認し、§9「URL の伏せ字」に引用した
- 未確認: https://www.npmjs.com/package/@microsoft/clarity（403。npm パッケージは Non-goal のため影響なし）、Lark t100492 の原文（Lark MCP が未認証。メタデータの説明文は作成時の転記）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | 遠藤 | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-27 | 初版 | Lark t100492 | 遠藤（Claude 作成） |
| 2026-09-27 | spec-review 第1回の指摘を反映（完了条件の分割、マージ前ゲート、Q-001〜Q-003 追加ほか。§16 レビュー記録） | spec-review audit | Claude（spec-review revise） |
| 2026-09-27 | Q-001 回答（Clarity プロジェクト作成・Strict 設定・tracking code を §6 に転記）。Clarity 利用規約を取得し、§9 に引用、FR-005 に Microsoft Advertising の開示とプライバシー ステートメントのリンク先を反映 | Q-001、利用規約 4.4(b) | 遠藤（Claude 作業） |
| 2026-09-27 | spec-review 第2回の指摘を反映（URL が伏せ字の対象外であることの開示、FR-001・FR-002 の完了確認の見直し、`global-error.tsx` の伏せ字、`.env.example`、BR-002 の決定者、Q-002 の拒否時の扱い。§16 レビュー記録） | spec-review audit | Claude（spec-review revise） |
| 2026-09-27 | FR-005（プライバシーポリシー追記）を Won't にし、ALT-003・R-003 を追加。Q-002・Q-003・CP-1 を取り下げ、`/privacy` 関連の確認・変更ファイルを削除 | 遠藤決定（ALT-003） | 遠藤（Claude 作業） |
