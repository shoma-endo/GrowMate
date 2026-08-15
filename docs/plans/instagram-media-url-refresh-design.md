# Instagram サムネイル自前キャッシュ設計書

関連: [`instagram-integration-design.md`](./instagram-integration-design.md)（Instagram 連携本体の設計書。本書はその Phase 2 実装後に見つかった不具合の是正設計）

## 1. 背景・目的

`/analytics` の Instagram 一覧（コンテンツ一覧タブ）でサムネイルが表示されない不具合を調査した結果、以下が判明した。

- `app/analytics/page.tsx`（Server Component）は `instagramMediaService.getPage` で **DB (`instagram_media` テーブル) を直接読むだけ**で、表示のたびに Graph API を呼ぶことはない。
- DB に保存されている `media_url`/`thumbnail_url` は Instagram CDN の**署名付き URL**。実測（2026-08-13）で、最終同期（2026-08-08）から約6日後に該当 URL を直接開くと `URL signature expired` の 403 が返った。有効期限そのものは Meta 公式ドキュメントに記載が無く（§9 参照）、実測でのみ確認できる挙動。
- 既存の同期ロジック（`src/server/services/instagramSyncService.ts`）は `InstagramSyncMode = 'incremental' | 'backfill'` の2モードのみで、**両方とも「まだ DB に無い新規投稿」しか Graph API から取得しない**構造になっている:
  - `incremental`（「最新化」ボタン）: `watermarkPostedAt`（DB内の最新投稿日時）より新しい投稿だけを取得する（L255-262）。既存投稿は API 呼び出し対象にすら入らない。
  - `backfill`（「過去の投稿をインポート」ボタン）: `getExistingMediaIds` で DB に既存の `ig_media_id` を明示的に除外してから処理する（L299-305）。
  - 結果、**一度 DB に保存された投稿の `media_url`/`thumbnail_url` を更新する経路が存在しない**。同期ボタンをいくら押しても直らない。
- 対照的に `/setup/instagram` のプレビューカード（`src/components/InstagramSetupClient.tsx`、サーバーアクション `fetchInstagramPreviewData`）は**画面を開くたびに Graph API `instagramService.fetchMedia` をライブ実行**しており、DB を経由しない。そのため同じ問題は起きない。

なお、UI 側の表示ロジック（`src/components/InstagramMediaThumbnail.tsx`）は既に修正済みで、画像読み込み失敗時にプレースホルダーへ正しくフォールバックしている（壊れたアイコンが出るような表示崩れはない）。本書が扱うのは「フォールバックが正しく機能しているにもかかわらず、その裏で DB の URL がずっと更新されないままになる」という**データ鮮度の問題**。

### 目的

一覧画面を開いた際、期限切れの画像を自動的に復元し、ユーザーが同期ボタンを押さなくても常に有効なサムネイルが表示される状態にする。

## 2. スコープ / 非スコープ

### スコープ

- `/analytics` の `InstagramMediaTable.tsx` が表示する投稿サムネイル（DB由来）

### 非スコープ（対応不要）

- `/setup/instagram` のプレビューカード（`MediaPreviewCard`）: 都度ライブ取得のため対象外
- `/setup/instagram` のプロフィール画像: 同上、`fetchInstagramPreviewData` が都度 `fetchProfile` をライブ実行
- 投稿本文・インサイト指標（reach/views等）の再取得: 本書は表示用サムネイル画像のみを対象とする
- REELS の動画本体（`media_url` が動画になる場合）のキャッシュ: 静止画のサムネイル（`thumbnail_url`）のみをキャッシュし、動画バイトは扱わない（§4.4）
- cron・定期実行の追加

## 3. 検討した方式と却下理由

| 方式 | 内容 | 却下/採用しない理由 |
|---|---|---|
| SSR で一覧表示のたびに全件再取得 | ページ表示のたびに Graph API を叩く | 表示のたびに遅延・レート消費が発生。まだ有効な URL まで無駄に再取得する |
| クライアント発火のオンデマンド単体再取得（Server Action） | `onError` 発火時に Meta から都度再取得するだけで、自前保存はしない | 有効期限（実測6日）が来るたびに**永久に** Graph API 依存が続く。トークン失効後は二度と直せない。ユーザー指摘（本書作成中の会話）を踏まえ、一度取得した画像は自前で保持する方式に変更した |
| 新しい同期モード + cron | 定期的に全件の URL を更新 | `instagram-integration-design.md` L341/L757 で「cron を作らないことでレート懸念（50件×毎時 ≒ 1,200コール/日/ユーザー）を解消した」と明記済みの既存判断と矛盾する |
| **採用: 自前キャッシュ（Supabase Storage）+ 初回取得失敗時のみ Meta 再取得** | 初回アクセス時に画像バイトを自前の Storage へ保存し、以後は二度と Meta を呼ばない | 下記 §4 |

## 4. 採用方式: Route Handler によるキャッシュ・オン・リード

`/analytics` の一覧では、DB の生 `media_url`/`thumbnail_url` を直接 `<img>` の `src` に使わない。代わりに**自前ドメインの安定 URL**（`/api/instagram/media/{igMediaId}/thumbnail`）を常に指し示し、その裏側で「キャッシュがあればそれを返す・無ければ取得してキャッシュしてから返す」を透過的に行う。

### 4.1 なぜこの形か

- **クライアント側の複雑さがほぼゼロ**: `<Image src="/api/instagram/media/{id}/thumbnail">` を指すだけでよい。キャッシュ有無・Meta 再取得・DB更新はすべてサーバー側の1エンドポイントに閉じる。既存の `onError` フォールバック（プレースホルダー）はそのまま活かせる（このエンドポイント自体が失敗したときの最終防御線として機能）。
- **`instagramSyncService.ts`（incremental/backfill）に一切手を入れない**: キャッシュの作成は「初めて表示されたとき」に遅延実行されるため、複雑な同期フローに新しい分岐を混ぜずに済む。新規投稿・既存投稿・以前失敗した投稿のいずれも同じ1経路で扱える。
- **Meta 依存は生涯で最大1回**: 一度キャッシュに載れば、その投稿が存在する限り二度と Graph API を呼ばない。オンデマンド単体再取得案（却下案）が抱えていた「6日おきに永久に呼び続ける」問題が解消する。

### 4.2 データフロー

```
InstagramMediaThumbnail (client)
  → <Image src="/api/instagram/media/{igMediaId}/thumbnail">

GET /api/instagram/media/{igMediaId}/thumbnail (Route Handler)
  → authMiddleware() + canAccessInstagram(role)（未認可なら 403）
  → instagram_media を (userId, igMediaId) でスコープして1件取得（無ければ 404）
  → cached_thumbnail_path が設定済み？
      Yes → Supabase Storage から download → 画像バイトを返す（Cache-Control: private, immutable）
      No  → ensureValidInstagramToken（needsReauth なら 404）
            → instagramService.fetchMediaUrl(accessToken, igMediaId) で
              media_url/thumbnail_url をその場で再取得
            → キャッシュ対象 URL を決定（§4.4）。無ければ 404
            → 画像バイトを Meta CDN から download
            → Supabase Storage へ upload（Service Role）
            → instagram_media.cached_thumbnail_path を更新
            → 画像バイトを返す（Cache-Control: private, immutable）
  → いずれかの段階で失敗 → 404

失敗時、クライアントの <Image onError> が既存プレースホルダーへフォールバック（現状維持）
```

### 4.3 実装ポイント

#### DB マイグレーション

`supabase/migrations/<timestamp>_add_cached_thumbnail_path_to_instagram_media.sql`

```sql
ALTER TABLE instagram_media ADD COLUMN cached_thumbnail_path text;
-- ロールバック: ALTER TABLE instagram_media DROP COLUMN cached_thumbnail_path;
```

既存行は `NULL` のまま（＝全件「未キャッシュ」扱いで自然に開始する。移行対象データの特別な初期化処理は不要）。

#### Supabase Storage バケット

- 新規バケット `instagram-media-thumbnails`、**`public: false`**
- パス規約: `{userId}/{igMediaId}.jpg`
- アクセスはすべて Service Role 経由（Route Handler 内のみ）。クライアントや anon/authenticated キー経由での直接アクセスは無い設計のため、`storage.objects` に対する RLS ポリシーは追加不要（Service Role は RLS をバイパスする。[`service-usage.md`](../../.claude/skills/supabase/service-usage.md) の運用ルール通り、対象は必ず `.eq('user_id', ...)` 相当のパスプレフィックスでスコープする）
- 本リポジトリで Supabase Storage を使うのはこれが初めて（既存コードに前例なし）

#### `src/server/services/instagramService.ts`

新規メソッド `fetchMediaUrl(accessToken: string, mediaId: string): Promise<InstagramApiResult<{ mediaUrl: string | null; thumbnailUrl: string | null }>>`

- `GET /{v}/{mediaId}?fields=media_url,thumbnail_url`（§9 で一次情報確認済み）
- 既存の `fetchMediaInsights`（L402-456）と同じ `fetchWithTimeout` + `parseJsonResponse` パターンを踏襲し、エラー正規化を再利用する

#### `src/server/services/instagramMediaService.ts`

新規メソッド:

- `getMediaProductType(userId, igMediaId)` または既存 `getPage`/lookup 系を流用し、Route Handler がキャッシュ対象 URL 決定（§4.4）に必要な `mediaProductType`/`mediaUrl`/`thumbnailUrl` を1行取得できるようにする
- `updateCachedThumbnailPath(userId: string, igMediaId: string, path: string): Promise<void>` — `.update({ cached_thumbnail_path: path }).eq('user_id', userId).eq('ig_media_id', igMediaId)`（`updateMediaListingFields` と同型の軽量 UPDATE）
- `purgeInstagramData`（L418）に Storage オブジェクト削除を追加: `instagram_media` 行を削除する前に、対象ユーザーの Storage オブジェクトを `storage.from('instagram-media-thumbnails').list(userId)` で列挙し `remove()` する。DB行だけ消して Storage にオブジェクトが残る（無限に増えるゴミ）を防ぐ

#### 新規 Route Handler `app/api/instagram/media/[igMediaId]/thumbnail/route.ts`

- `authMiddleware()` → `canAccessInstagram(role)`（`syncInstagramData` 等の既存ガードと同型）
- `(userId, igMediaId)` スコープで `instagram_media` を1件取得。無ければ 404
- キャッシュ済み（`cached_thumbnail_path` あり）: Storage から `download()` してバイトを返す。`Content-Type` は保存時に確定させた値を使う。`Cache-Control: private, max-age=31536000, immutable`（**`private` 必須** — セッション認可に基づくレスポンスを共有 CDN/プロキシにキャッシュさせない。ブラウザ自身のキャッシュのみ許可）
- 未キャッシュ: `getInstagramCredential` + `ensureValidInstagramToken`（`needsReauth` なら 404 で終了。エラーメッセージ露出はしない — 画像レスポンスなので静かに落ちる）→ `instagramService.fetchMediaUrl` → キャッシュ対象 URL 決定（§4.4）→ 画像バイトを `fetch`（タイムアウト付き）→ Storage へ `upload(..., { upsert: true })` → `updateCachedThumbnailPath` → バイトを返す
- 同一 `igMediaId` への同時多重リクエスト（複数タブ等）でキャッシュ書き込みが競合しても、`upsert: true` と最終 UPDATE が冪等なため実害はない（許容する。明示的な排他制御は設けない）

#### `src/components/InstagramMediaThumbnail.tsx`

- `igMediaId?: string` prop を追加。指定時は `src` を Meta の生URLではなく `/api/instagram/media/${igMediaId}/thumbnail` に固定する
- 失敗時のフォールバックは既存の `onError` → プレースホルダーのみ（再試行ロジックは不要 — Route Handler 側で既に1回のフォールバック取得を済ませているため、クライアント側で二重に再試行させない）
- `igMediaId` 未指定（プロフィール画像・`/setup/instagram` のプレビューカード）は現状のまま Meta の生URLを直接使う。挙動変更なし

#### `app/analytics/components/InstagramMediaTable.tsx`

`ThumbnailCell` から `<InstagramMediaThumbnail igMediaId={item.igMediaId} ... />` を渡す（`InstagramMediaListItem.igMediaId` は既存フィールド、`src/types/instagram.ts:55`）。

### 4.4 キャッシュ対象 URL の決定

```
candidate = thumbnailUrl ?? (mediaProductType !== 'REELS' ? mediaUrl : null)
```

理由（§9 で確認した Meta 公式の `thumbnail_url` フィールド定義「Only available on VIDEO media」に基づく）:

- FEED（画像）: `thumbnail_url` は通常 null、`media_url` が静止画そのもの → `media_url` を使う
- REELS（動画）: `thumbnail_url` があれば動画の静止フレームなのでそれを使う。無ければ動画バイト（`media_url`）はキャッシュ対象にしない（非スコープ §2）。プレースホルダーのまま

## 5. 影響する既存画面・機能

| 画面・機能 | 影響 |
|---|---|
| `/analytics` Instagram タブ | サムネイル表示元が Meta の生URLから自前ルートに変わる。見た目・操作は変化なし |
| `/setup/instagram` | 変更なし（非スコープ §2） |
| 連携解除（`disconnectInstagram` → `purgeInstagramData`） | Storage オブジェクトの削除ステップが追加される |
| `next.config.ts` の `images.remotePatterns`（`*.cdninstagram.com`/`*.fbcdn.net`、既に別修正で追加済み） | 自前ルート経由になるため一覧側では実質不要になるが、`/setup/instagram` のライブプレビューでは引き続き必要。削除しない |

## 6. エラーパス

| ケース | 挙動 |
|---|---|
| トークン失効・要再認証 | Route Handler が 404 を返す。クライアントは通信を諦めて静かにプレースホルダーへ（一覧全体にはエラー表示を出さない） |
| 対象 media が Instagram 側で削除済み等の恒久エラー | 通常のエラーとしてプレースホルダー固定。DB 更新も行われないため次回アクセス時も同じ経路を通るが、1リクエストにつき1回の Meta 呼び出しに収まる（無限再試行にはならない） |
| Storage アップロード失敗（ネットワーク等の一時エラー） | `cached_thumbnail_path` は更新されない。次回アクセス時に再度キャッシュ生成を試みる（自然にリトライされる） |

## 7. レート予算・非機能

- 1件の投稿につき Meta API 呼び出しは**生涯で最大1回**（キャッシュ成立後は二度と呼ばない）。既存の同期予算（`INSTAGRAM_SYNC_MEDIA_LIMIT`=50件/回、`INSTAGRAM_RATE_CALL_COUNT_THRESHOLD`=80）とは別枠として扱い、`checkBudget` 等のゲートは設けない
- Storage 容量: サムネイル1枚あたり数十〜数百KB程度。投稿数百件規模でも数十MB程度に収まる見込み（正確な見積りは実装後の実測値で確認する）
- Route Handler のタイムアウト: Meta からの画像ダウンロード + Storage アップロードは合計で数秒程度を想定。Next.js の Route Handler デフォルト実行時間内に収まる（既存の同期処理のような長時間バッチではない）

## 8. 認可・セキュリティ

- 認可条件: `canAccessInstagram(role)`（既存の `syncInstagramData` 等と同じガード）
- Route Handler は Service Role で `instagram_media`/Storage にアクセスするため、`.eq('user_id', userId)` による明示スコープを必須とする（[`service-usage.md`](../../.claude/skills/supabase/service-usage.md) 運用ルール通り）。`igMediaId` を任意に指定しても他ユーザーの画像は返らない
- 画像レスポンスの `Cache-Control` は `private` を必須とする。共有 CDN/プロキシキャッシュに認可済みレスポンスを載せない
- Instagram アクセストークンはこの Route Handler 内でのみ使用し、クライアントに一切渡さない（既存の `instagramService`/`instagramSyncService` と同じ境界）

## 9. 外部サービス（Meta Instagram Platform API）一次情報検証

- 参照 URL: `https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/`
- 確認日: 2026-08-14
- 単一 media 取得エンドポイント: `GET /<IG_MEDIA_ID>?fields=<LIST_OF_FIELDS>&access_token=<ACCESS_TOKEN>` が公式にサポートされている（本リポジトリにはこの単一ノード取得の実装は現時点で無い。`/me/media` 一覧取得のみ実装済み）
- `media_url` フィールド説明（verbatim）: "The URL for the media. **Warning:** The `media_url` field is omitted from responses if the media contains copyrighted material or has been flagged for a copyright violation. Examples of copyrighted material can include audio on Reels."
- `thumbnail_url` フィールド説明（verbatim）: "Media thumbnail URL. Only available on `VIDEO` media."
- 有効期限（署名切れ）についての記載: **公式ドキュメントに記載なし**。本書 §1 の「約6日で403」は実測によるものであり、Meta 側の仕様として保証された値ではない（変わりうる前提で設計する。§4 のキャッシュ方式はこの変動に対して頑健 — 期限の長さに依存しない）
- 上記引用からの解釈（引用外）: `media_url` が著作権理由で欠落するケースがあるため、REELS で `thumbnail_url` も欠落する場合はキャッシュ対象なしとしてプレースホルダーに倒す設計にした（§4.4）

## 10. 受け入れ条件

- 6日以上前に同期した投稿を含む `/analytics` の Instagram 一覧を開いたとき、初回表示でサムネイルが自動的に復元されること（1回目のリクエストで Meta 再取得 + キャッシュ生成が走り、2回目以降は Storage から即座に返ることを Network タブで確認する）
- Instagram トークンが失効しているユーザーでは、一覧全体はエラーにならず、未キャッシュのサムネイルのみ静かにプレースホルダーのままになること
- `/setup/instagram` のプレビューカード・プロフィール画像の挙動に変化がないこと（既存動作の回帰がないこと）
- 連携解除後、対象ユーザーの Storage オブジェクトが残らないこと（`purgeInstagramData` 実行後に Storage バケットを確認する）
- 同一投稿への複数回アクセスで Meta API が複数回呼ばれないこと（2回目以降は Storage 経由のみになることを確認する）

## 11. `instagram-integration-design.md` への波及（実装時に反映）

以下の記述は「一覧表示のたびに Meta へ再取得する」という、incremental/backfill 分離（2026-08-08）より前の前提を引きずっており、本書の実装完了後に実態に合わせて修正する。

- L198-199: 「一覧表示のサムネイルは同期のたびに更新し」「画像の自前ストレージ保存は非スコープ」→ 本書（自前キャッシュ方式）へのリンクに差し替え。「自前ストレージ保存は非スコープ」の判断はこの改修で覆ったことを明記する
- L471-472: `media_url`/`thumbnail_url` 列コメント「失効し得る CDN URL。同期毎に更新」→ 実態（同期では更新しない。表示時に Route Handler がオンデマンドでキャッシュする）に合わせて修正。新規列 `cached_thumbnail_path` のコメントを追加
