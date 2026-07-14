---
generated: 2026-07-14
commit: a4b84d03
generator: e2e-testcases
---

# GrowMate AI要約・保存 E2Eテストケース

## 30秒サマリー

- 対象: コンテンツ一覧の編集モーダルとチャット右パネルにおける「AIで要約」「保存」
- 対象外: WordPress初期接続、記事インポート、GSC・GA4・Google Ads、削除、チャット本文生成
- 機能テスト: 15件（P0: 11件、P1: 4件）
- 非機能チェック: 4件
- 対象コミット: `a4b84d03`
- 実行環境: WordPress連携済みの検証用ユーザーと、編集可能な検証用WordPress記事が必要

## 事前準備

実在する検証環境のURLに置き換えて使用する。秘密情報は本書へ記録しない。

| データ | 状態 |
|---|---|
| ユーザーA | GrowMateへログイン済み。検証用WordPressへ接続済み |
| 記事A | セルフホストWordPressの公開記事。URL例: `https://<self-hosted-site>/aircon-cleaning-guide/`。H2・H3・H4を各1件以上含む |
| 記事B | 記事Aとは異なる公開記事。URL例: `https://<self-hosted-site>/aircon-cleaning-price/` |
| コンテンツA | 記事Aと連携済み。`session_id`と`wp_post_id`がある。`impressions`に`1200`、要約対象8項目に識別しやすい既存値を保存済み |
| コンテンツB | WordPress一括インポート由来。`session_id`がなく、記事Bと連携済み |
| コンテンツC | WordPress投稿URLが未登録 |
| コンテンツD | `canonical_url`のみ保存済みで`wp_post_id`がない。セルフホストWordPressの記事を参照 |
| WordPress.com用コンテンツ | WordPress.com記事と連携済み。Cookieフォールバック確認時のみ使用 |

AI出力は非決定的なため完全一致では判定しない。ただし、本文に存在しないサービス・料金・地域・保証などを事実として追加していないことを確認する。`basic_structure`はAI出力ではなく、WordPress本文のH2・H3・H4と順序・階層が一致することを確認する。

## 機能テストケース

### AI要約

| ID | 優先度 | 前提条件 | 手順 | 期待結果 | 実行方法 | 根拠 |
|---|---|---|---|---|---|---|
| TC-AIS-001 | P0 | コンテンツAが存在する | 1. コンテンツ一覧を開く<br>2. コンテンツAの「編集」を押す<br>3. 「AIで要約」を押す<br>4. 完了まで待つ | 1. 実行中は「要約中…」とローディング表示になる<br>2. 成功toast「AIによる要約でフィールドを更新しました」が出る<br>3. モーダルを閉じずに`main_kw`、`kw`、`needs`、`persona`、`goal`、`prep`、`opening_proposal`、`basic_structure`へ結果が反映される<br>4. `basic_structure`が記事Aの見出しと一致する<br>5. `opening_proposal`が本文冒頭から最初のH2直前までにあるp段落の原文と一致する | 手動 | `src/components/AnalyticsTable.tsx:540-565`、`src/components/ContentAnnotationSummaryAction.tsx:41-73` |
| TC-AIS-002 | P0 | コンテンツBは`session_id`なし | 1. コンテンツ一覧を開く<br>2. コンテンツBの編集モーダルを開く<br>3. 「AIで要約」を押す | `session_id`がなくても`annotationId`を対象として要約に成功し、8項目がモーダルへ反映される | 手動 | `src/components/AnalyticsTable.tsx:901-913`、`src/server/services/contentAnnotationSummaryService.ts:111-121` |
| TC-AIS-003 | P0 | コンテンツAに対応するチャットセッションがある | 1. 対象チャットを開く<br>2. 右側の「メモ・補足情報」パネルを開く<br>3. 「AIで要約」を押す | `sessionId`を対象として要約が成功し、成功toastが表示される。再読込後も生成内容が保存されている | 手動 | `app/chat/components/AnnotationPanel.tsx:154-160`、`src/server/actions/contentAnnotationSummary.actions.ts:19-59` |
| TC-AIS-004 | P0 | コンテンツCはWordPress未連携 | 1. コンテンツCの編集画面を開く<br>2. AI要約欄を確認する<br>3. ボタンを押そうとする | 「AIで要約」は非活性で、「WordPress投稿URLを保存すると利用できます」と表示され、要約処理は開始されない | 手動 | `src/components/ContentAnnotationSummaryAction.tsx:29-35,84-91` |
| TC-AIS-005 | P0 | チャット右パネルの対象がWordPress未連携 | 1. 右パネルを開く<br>2. WordPress投稿URL欄へ記事AのURLを入力するが保存しない<br>3. 「AIで要約」を確認する<br>4. 保存する<br>5. 保存完了直後のボタンを確認する | 1. URL入力だけでは要約ボタンは非活性のまま<br>2. 保存成功直後、パネルを開き直さなくても要約ボタンが活性化する | 手動 | `app/chat/components/AnnotationPanel.tsx:34-40,70-88`、`src/lib/wordpress-link.ts` |
| TC-AIS-006 | P0 | コンテンツAの`impressions`が`1200` | 1. AI要約前の表示値を記録する<br>2. AI要約を実行する<br>3. 成功後に保存または再読込する<br>4. `impressions`を確認する | 要約対象8項目だけが更新され、`impressions`は`1200`のまま変化しない | 手動 | `src/server/services/contentAnnotationSummaryService.ts:199-235` |
| TC-AIS-007 | P1 | コンテンツAに既存値がある | 1. 編集モーダルで`main_kw`などを未保存の別文字列へ変更する<br>2. Infoアイコンへホバーし、キーボードでもフォーカスする<br>3. 「AIで要約」を押す | 1. Tooltipに「WordPress本文から生成し直します。現在入力中の未保存内容も含めて上書きされます。」と表示される<br>2. 要約成功後、未保存の入力値は生成結果で上書きされる | 手動 | `src/components/ContentAnnotationSummaryAction.tsx:94-111` |
| TC-AIS-008 | P1 | コンテンツDが存在する。加えて可能ならWordPress.com記事も用意する | 1. コンテンツDの編集モーダルを開く<br>2. AI要約を実行する<br>3. WordPress.com環境でも同様に実行する | セルフホストREST APIの小文字`id`、WordPress.com形式の大文字`ID`のどちらでも投稿IDが内部の`id`へ正規化され、本文取得と要約に成功する | 手動＋結合環境 | `src/server/services/wordpressService.ts:616-631`、`src/types/wordpress.ts:42-51` |
| TC-AIS-009 | P1 | 連携後に記事を非公開・削除するなど、本文を取得できないコンテンツを用意する | 1. 既存8項目を記録する<br>2. 「AIで要約」を押す<br>3. エラー後のフォームと再読込後の値を確認する | 1. 失敗toastまたはエラーAlertが表示される<br>2. 既存8項目は変更されない<br>3. ローディング状態が解除され、再実行可能になる | 手動 | `src/server/services/contentAnnotationSummaryService.ts:135-148`、`src/components/ContentAnnotationSummaryAction.tsx:55-80` |
| TC-AIS-010 | P1 | WordPress.comの保存トークンは無効または期限切れだが、ブラウザCookieは有効 | 1. WordPress.com用コンテンツを開く<br>2. 「AIで要約」を押す | 保存トークンの更新失敗だけで本文取得が失敗せず、有効なCookieを使って要約が成功する | 手動＋結合環境 | `src/server/services/wordpressContentSync.ts:170-176` |

### 保存

| ID | 優先度 | 前提条件 | 手順 | 期待結果 | 実行方法 | 根拠 |
|---|---|---|---|---|---|---|
| TC-SAV-001 | P0 | コンテンツAは投稿URL・`wp_post_id`を保存済み | 1. コンテンツAの編集モーダルを開く<br>2. WordPress投稿URLを変更せず、`main_kw`だけ変更する<br>3. 「保存」を押す<br>4. 再度編集モーダルを開く | 1. 「保存しました」toastが表示され、モーダルが閉じる<br>2. `main_kw`が保存される<br>3. 投稿URL、投稿タイトル、`wp_post_id`との連携が維持される<br>4. WordPress投稿検索が一時的に利用不能でも、解決済みIDを再利用して保存できる | 手動 | `src/server/actions/wordpress.actions.ts:1017-1044`、`src/components/AnalyticsTable.tsx:512-552` |
| TC-SAV-002 | P0 | コンテンツAと記事Bが存在する | 1. コンテンツAの編集モーダルを開く<br>2. WordPress投稿URLを記事Bへ変更する<br>3. 「保存」を押す<br>4. 再度編集し、表示内容を確認する<br>5. AI要約を実行する | 1. 記事BのURL・投稿ID・投稿タイトルへ更新される<br>2. 保存後のAI要約は記事Aではなく記事Bの本文を使用する | 手動 | `src/server/actions/wordpress.actions.ts:1025-1043,1050-1061` |
| TC-SAV-003 | P0 | WordPress未連携のコンテンツC | 1. チャット右パネルで記事AのURLを入力する<br>2. 「保存」を押す<br>3. 保存直後に「AIで要約」を押す | 1. 保存が成功する<br>2. 投稿IDと投稿タイトルが解決される<br>3. パネルを開き直さず要約できる | 手動 | `app/chat/components/AnnotationPanel.tsx:70-88,154-174` |
| TC-SAV-004 | P0 | コンテンツAが連携済み | 1. チャット右パネルでWordPress投稿URLを空にする<br>2. 「保存」を押す<br>3. 保存直後の要約ボタンを確認する<br>4. パネルを開き直して再確認する | 1. URLと投稿IDの連携が解除される<br>2. 保存直後から要約ボタンが非活性になる<br>3. 開き直しても非活性のまま | 手動 | `app/chat/components/AnnotationPanel.tsx:74-88`、`src/lib/wordpress-link.ts` |
| TC-SAV-005 | P0 | コンテンツAが存在する | 1. 編集モーダルで記事に存在しないURLまたは別サイトURLへ変更する<br>2. 「保存」を押す<br>3. エラー後のモーダルと既存データを確認する | 1. 投稿検索エラーなど安全なエラー文言がtoastとAlertへ表示される<br>2. モーダルは閉じない<br>3. 既存の保存値とWordPress連携は変更されない<br>4. エラーに認証情報や内部スタックが含まれない | 手動 | `src/components/AnalyticsTable.tsx:524-545`、`src/server/services/wordpressService.ts:127-144` |

## 非機能テストケース

| ID | 観点 | チェック項目 | 測定方法 | 合格基準 |
|---|---|---|---|---|
| TC-NFR-001 | 二重実行防止 | AI要約中の要約・保存・キャンセル操作 | 要約開始直後に各ボタンを連続クリックする | AI呼び出しとDB更新が重複せず、処理中は対象ボタンが非活性になる |
| TC-NFR-002 | 操作フィードバック | AI要約・保存の処理中、成功、失敗 | 各正常系・異常系を実行し、ラベル・toast・Alertを確認する | 無反応に見える時間がなく、完了結果を画面上で判断できる |
| TC-NFR-003 | アクセシビリティ | Infoアイコンと各ボタンのキーボード操作 | Tab、Shift+Tab、Enter、Space、Escapeで操作する | フォーカス位置が視認でき、Tooltipをキーボードで確認でき、主要操作をマウスなしで完了できる |
| TC-NFR-004 | LLM障害耐性 | タイムアウト・不正JSON時の既存値保護 | 検証環境でLLM失敗応答を発生させる。発生方法はTBD | エラー表示後も既存値が維持され、画面が操作可能な状態へ戻る |

## 発見事項

確認済みの未修正バグはなし。

- 確認済み・問題なし: WordPress APIのトップレベル投稿IDは、API境界では`id`と`ID`を受け付けるが、アプリ内部では必須の`id`へ正規化される（`src/server/services/wordpressService.ts:616-631`）。
- 要確認: `TC-AIS-010`のCookieフォールバックを再現する検証環境の準備方法はTBD。実環境で保存トークンを操作できない場合は、既存ユニットテスト`tests/unit/server/services/wordpressContentSync.test.ts`の成功を代替証跡とする。

## トレーサビリティ

| フロー | ケースID |
|---|---|
| コンテンツ一覧でAI要約 | TC-AIS-001、TC-AIS-002、TC-AIS-004、TC-AIS-006、TC-AIS-007、TC-AIS-008、TC-AIS-009、TC-AIS-010 |
| チャット右パネルでAI要約 | TC-AIS-003、TC-AIS-005 |
| URL未変更・変更時の保存 | TC-SAV-001、TC-SAV-002 |
| チャット右パネルで連携・解除 | TC-SAV-003、TC-SAV-004 |
| 保存失敗時の保護 | TC-SAV-005 |
| 操作性・障害耐性 | TC-NFR-001〜TC-NFR-004 |

## 実行記録

| 実施日 | 実施者 | 対象commit | 結果サマリー | 不具合・補足 |
|---|---|---|---|---|
|  |  | `a4b84d03` | 未実施 |  |
