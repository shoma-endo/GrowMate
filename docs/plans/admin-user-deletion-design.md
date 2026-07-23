# 管理画面 ユーザー削除機能 仕様書

## 1. 文書情報

| 項目 | 内容 |
|---|---|
| 対象画面 | `/admin/users` |
| 対象機能 | 管理者によるユーザー完全削除 |
| 作成日 | 2026-07-15 |
| ステータス | 実装前レビュー対象 |

### 1.1 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-07-15 | 初版作成 |
| 2026-07-16 | 確認文字列入力を廃止し、チャット削除と同様のボタン押下のみの確認ダイアログへ変更 |
| 2026-07-16 | `DeleteChatDialog.tsx`から共通ダイアログ`ConfirmDeleteDialog`を抽出し、チャット削除・ユーザー削除で共用する方針を追加 |
| 2026-07-16 | 削除実行ボタンのラベルを`完全に削除する`から`削除`へ変更（`ConfirmDeleteDialog`のデフォルト値と統一。タイトル文言は維持） |
| 2026-07-16 | 監査テーブルを`admin_user_deletion_logs`（専用）から`admin_action_logs`（`action`列を持つ汎用）へ変更。削除操作自体が稀なため、将来の管理者操作の監査にも使い回せる汎用構造を優先 |
| 2026-07-16 | 6.4ワイヤーを既存`UsersClient.tsx`の実列（フルネーム・LINE表示名・メール/認証・最終ログイン・登録日・権限・アクションの7列）に合わせて修正。従来の4列簡略図は実装済みUIより古かった |
| 2026-07-16 | 7.1に`Trash2`アイコンの扱いを明記。`ConfirmDeleteDialog`側に固定表示し、`title`propに含めない |
| 2026-07-16 | TAKT spec-to-pr実行時のABORTを受けて修正: (1)`content_categories`は既にDROP済みと訂正、(2)`prompt_templates.updated_by`のFK（`ON DELETE SET NULL`欠落）を8.2に追加、(3)8.3にマイグレーション先行PR化の2段階適用手順を追記、(4)`DeleteChatDialog`のもう一方の呼び出し元`SessionSidebar.tsx`（`/chat`）を11・12.3の回帰確認対象に追加、(5)`delete_employee_and_restore_owner` RPCが`delete_user_fully`を内部利用する点を11に明記 |
| 2026-07-16 | Stage1マイグレーションを本番適用済みに更新。型再生成に`SUPABASE_ACCESS_TOKEN`が必要でCI自動化も無いため、8.3を「Stage2a（型不要・DTO/UI/schema等）」「Stage2b（型必須・Server Action/Service/Auth削除/監査ログ）」に分割し、Stage2aは削除の実行を待たずに完了扱いにできると明記 |
| 2026-07-22 | TOCTOU対策: `delete_user_fully` に `FOR UPDATE`＋削除保護の再検証を追加。Auth削除をDB削除成功後へ順変更。監査`succeeded`確定失敗はリトライ後も成功扱いにしない。未使用の `delete_employee_and_restore_owner`（旧スタッフ削除RPC）は廃止 |
| 2026-07-22 | Auth削除失敗の復旧: 監査に`target_supabase_auth_id`保存、`pending_auth_user_deletions`で幽霊ユーザー再作成を防止。ログイン時は Auth 再試行のみ行い`public.users`を作らない。§9/§12をDB先行順序に同期 |
| 2026-07-22 | P1再修正: RPC同一TXで`users`削除前にpending作成。ログイン時claim+`next_attempt_at`バックオフ。失敗監査の未確定を呼び出し元へ返す。§8.3にmigration→コード配備、§13.4の「一覧残して再試行」を現状化。rollbackはpending残存時DROP禁止 |
| 2026-07-22 | claimを`claim_pending_auth_user_deletion` RPCで原子化。pending作成時に30秒初期lease。Auth成功後のpending清掃失敗を成功扱いにしない。切替中の削除Action停止と「旧アプリ配備後にテーブルDROP」を§8.3に明記 |
| 2026-07-22 | Stage3 migrationを未pushのため1本（`20260722000000_harden_user_deletion_safety.sql`）に統合。部分適用リスクを排除 |
| 2026-07-23 | pending backoff更新を原子的RPC化。DB削除済み部分失敗で`dbDeleted`を返し一覧から除去。RPC失敗時の監査未確定文言を「削除完了」と分離。rollbackにAuth削除後のpending行DELETEを明記 |
| 2026-07-23 | Stage3配備手順を2本（`20260722000000`→`20260723000000`）に同期 |

## 2. 背景・目的

現在のユーザー管理画面は、ユーザー一覧の確認と権限変更のみ提供している。退会済み、テスト登録、誤登録などのユーザーを削除する手段が画面上になく、データベースやSupabase Authを個別に操作する必要がある。

具体的な発端: フルネーム入力を必須とする運用に対し、既存ユーザーの一部（講座生等）が未入力のまま登録されており、かつユーザー側に氏名を編集する手段がない。管理者が該当ユーザーを削除し、正しい氏名での再登録を促すための応急手段として本機能が必要になった。

本機能では、管理者が対象と影響範囲を明確に確認したうえで、ユーザーの認証情報と関連利用データを削除できるようにする。

削除は不可逆かつSupabase AuthとDBをまたぐため、次を重視する。

- 対象ユーザーの取り違えを防ぐ。
- 管理者、契約、組織関係を誤って破壊しない。
- 部分失敗時に状態を見失わず、管理画面から再試行できる。
- 誰が、誰を、いつ削除し、成功または失敗したか追跡できる。
- 技術的な削除範囲と再登録可否を管理者へ隠さない。

## 3. 現状調査

### 3.1 画面・Action

- `app/admin/users/page.tsx`は`getAllUsers()`を実行し、成功時に`UsersClient`へ一覧を渡す。
- `app/admin/users/UsersClient.tsx`は一覧、人数集計、権限編集、Sonner toastを管理する。
- アクション列は権限の「編集」のみ。削除操作はない。
- 管理者認可は`src/server/actions/admin.actions.ts`の`resolveAdminUser()`で実施するが、現在は実行者のroleだけを返し、user IDを返さない。

### 3.2 既存削除処理

- `SupabaseService.deleteUserFully(userId)`と`delete_user_fully` RPCが存在する。
- RPCはService Roleだけに実行権限があり、公開クライアントからは実行できない。
- 現行RPCは`chat_messages`、`chat_sessions`、`content_annotations`、`briefs`、`users`を削除する（正本は`20251230140000_allow_service_role_delete_employee_rpc.sql`。`20251230110000`は`create or replace`で上書き済み）。
- `content_categories`は`20251223000000_drop_content_categories.sql`で既にDROP済みであり、`database.types.ts`にも存在しない。削除対象棚卸しの対象外とする。
- UUID外部キーに`ON DELETE CASCADE`があるGSC、GA4、WordPress、Google Ads関連テーブルは`users`削除へ追随する。
- `prompt_templates.updated_by`はUUID FKだが`ON DELETE`指定がない（NO ACTION）。兄弟列`created_by`は`20250803121157_add_on_delete_set_null_to_prompt_templates_created_by.sql`で`ON DELETE SET NULL`へ修正済みだが、`updated_by`は未修正のまま残っている。`updated_by`には管理者IDが入るため、対象ユーザーを降格後に削除する際、その元管理者がプロンプトを編集済みだとFK違反で削除が失敗し得る。
- `delete_user_fully` RPCは旧`delete_employee_and_restore_owner`からも内部呼び出しされていたが、スタッフ機能廃止に伴い当該RPCは DROP 済み（2026-07-22）。
- Supabase Authユーザーは既存RPCの対象外である。
- `public.users.id`と`public.users.supabase_auth_id`は別IDであり、Auth削除には後者を使う必要がある。

### 3.3 保護が必要な既存データ

- `users.owner_user_id`は組織関係を表す自己参照外部キーである。組織関係を無視した削除はFK違反または所有状態の不整合を起こす。
- `stripe_subscription_id`を保持するユーザーをDBだけ削除しても、Stripe契約は解約されない。
- OTP送信は`shouldCreateUser: true`である。削除後も同じメールアドレスで新規登録できる。

## 4. スコープ

### 4.1 対象

- 管理者専用ユーザー一覧への削除導線追加。
- 削除可否と理由の一覧表示。
- ボタン押下で確定する削除確認ダイアログ。
- 既存`src/components/DeleteChatDialog.tsx`から汎用削除確認ダイアログ（`ConfirmDeleteDialog`）を抽出する共通化リファクタリング。
- Supabase Authとアプリデータの完全削除。
- 削除監査ログの永続保存。
- 既存`delete_user_fully` RPCの削除対象棚卸しと更新。
- 失敗時の安全なエラー表示と再試行。

### 4.2 対象外

- Stripe契約の自動解約。
- 組織関係の自動解除、スタッフ削除、オーナー状態の自動復元。
- 削除済みメールアドレスまたはLINEアカウントの恒久BAN。
- 削除データの復元。
- 監査ログ閲覧画面。
- 既存ユーザーロール型と組織ロールの不整合解消。

## 5. 確定要件

### 5.1 削除可能条件

対象ユーザーが次をすべて満たす場合だけ削除できる。

1. 対象が存在する。
2. 対象のroleが`admin`ではない。
3. `stripe_subscription_id`が`null`である。
4. `owner_user_id`が`null`である。
5. 対象を`owner_user_id`として参照するユーザーが存在しない。

管理者は一律削除不可とする。削除が必要な場合は先に管理者権限を降格する。これにより、自己削除と最後の管理者削除を同じ単純な規則で防止する。

Stripe契約情報または組織関係がある場合は削除を拒否し、先に既存の運用で解約・関係解除を行う。削除処理内では自動変更しない。

### 5.2 削除範囲

削除可能な対象について、次を削除する。

- `supabase_auth_id`がある場合のSupabase Authユーザー。
- `public.users`の対象行。
- 対象ユーザーに属するチャット、コンテンツ、brief、認証情報、分析・評価・設定・ジョブ等の関連利用データ。

削除監査ログは削除対象に含めない。ログにはメールアドレス、氏名、LINE表示名などのPIIを保存しない。

LINE専用ユーザーはSupabase Auth削除を行わない。メール・LINEとも、削除後に同じ識別子で登録した場合は別の新規アカウントとして扱う。

## 6. UI/UX仕様

### 6.1 一覧表示

アクション列に次を表示する。

- 権限編集の「編集」。
- 削除可能な行では、二次操作として「削除」。
- 削除不可の行では「削除不可」と理由。

削除トリガーは`Button`のghost相当と`text-destructive`を使用し、各行で強い塗りつぶしボタンを反復しない。確認ダイアログの最終実行ボタンだけ`variant="destructive"`を使用する。

削除不可理由はツールチップだけに依存せず、アクション列内の可視テキストまたは支援技術から取得可能な説明として表示する。

| reason | 表示文言 |
|---|---|
| `admin` | 管理者は削除できません。先に権限を変更してください |
| `active_subscription` | 契約情報があるため削除できません。先に契約を解除してください |
| `organization_linked` | 組織に紐づいているため削除できません。先に組織関係を解除してください |

### 6.2 確認ダイアログ

削除トリガー押下で、`DeleteChatDialog.tsx`から抽出する共通コンポーネント`ConfirmDeleteDialog`（7.1参照）を使った単一ダイアログを開く。モーダルonモーダルは禁止する。

表示内容:

- タイトル: `ユーザーを完全に削除しますか？`
- 対象の氏名、メールアドレス、LINE表示名。値がない項目は省略する。
- `認証情報と関連データが削除されます。取り消しや復元はできません。`
- `同じメールアドレスやLINEアカウントで、後日新規登録することはできます。`
- キャンセルボタン（`variant="outline"`）。
- `削除`ボタン（`variant="destructive"`、`ConfirmDeleteDialog`の`confirmLabel`デフォルト値のまま）。確認文字列の入力は求めず、クリックで即実行する。

### 6.3 状態遷移

| 状態 | 挙動 |
|---|---|
| 初期 | 最終削除ボタンは有効。入力欄はない |
| 実行中 | 対象行、削除、キャンセルをdisabled。削除ボタンは`削除中...` |
| 成功 | ダイアログを閉じ、対象行をローカル一覧から除去し、合計・権限別件数を再計算。成功toast |
| 失敗 | ダイアログまたは一覧を維持。技術詳細を出さず、原因と次の操作をtoast表示 |

実行中はDialog外クリック、Escape、閉じるアイコンによる終了も抑止し、処理結果を見失わせない。

### 6.4 ワイヤー

```text
ユーザー一覧（既存UsersClient.tsxの実列に合わせる。既存の編集アクション列にのみ削除操作を追加する）

フルネーム  LINE表示名  メール/認証            最終ログイン  登録日      権限     アクション
----------  ----------  ---------------------  ------------  ----------  -------  --------------------
山田太郎    たろちゃん  a@example.jp [メール]  2026-07-10   2026-01-10  有料     編集  削除
管理者A     -           b@example.jp [メール]  2026-07-15   2025-11-02  管理者   編集  削除不可

┌ ユーザーを完全に削除しますか？ ───────────────┐
│ 山田太郎 / a@example.jp                        │
│ 認証情報と関連データを削除します。復元不可。   │
│                                                 │
│                            [キャンセル] [削除]│
└─────────────────────────────────────────────────┘
```

### 6.5 UI/UX設計判断の背景

#### 狙い

- 一覧のどのユーザーに対する操作かを迷わせない。
- 日常的な権限編集と、不可逆な削除の危険度を視覚的に分ける。
- 削除範囲、復元不可、再登録可能という運用上の事実を事前に開示する。

#### 採用案

- 行内の削除トリガー。
- 単一の確認ダイアログ（チャット削除と同じ、ボタン押下のみで実行）。
- 最終実行ボタンだけを強い破壊色にする。

#### 不採用案

- 行内ボタンだけで即時削除: 誤クリックを防げない。ダイアログでの一段確認を挟む。
- ブラウザ標準`confirm`: 削除対象や影響範囲を十分に説明できず、デザイン・a11yも統一できない。
- 対象固有の確認文字列入力: チャット削除など既存の削除UIと一貫性がなく、操作コストが上がる割に誤操作防止効果が限定的。
- 各行に塗りつぶしの赤ボタン: 一覧全体で破壊操作が過度に目立ち、通常の管理作業を妨げる。
- 別ページへの遷移: 一件の確認のために一覧の文脈を失わせる。

#### 受け入れるトレードオフ

- 確認文字列入力を求めないため、ダイアログの内容を読まずに連続クリックする誤操作の可能性は残るが、既存のチャット削除UIと一貫させることを優先する。
- 契約・組織関係を自動解消しないため事前作業が必要だが、別ドメインの状態を暗黙変更しないことを優先する。

## 7. インターフェース・責務

### 7.1 共通削除確認ダイアログ

既存`src/components/DeleteChatDialog.tsx`は`mode: 'chat' | 'content'`によってタイトル・説明文をハードコードしており、ユーザー削除向けの文言（氏名・メール・LINE表示名、削除範囲の説明）を追加するには分岐が増え続ける。汎用ダイアログ`ConfirmDeleteDialog`（`src/components/ConfirmDeleteDialog.tsx`）へ表示ロジックを抽出し、呼び出し側がタイトル・本文を組み立てる形にする。

```ts
interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  isDeleting?: boolean;
  confirmLabel?: string; // default: '削除'
  deletingLabel?: string; // default: '削除中...'
}
```

- `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter`、キャンセル・破壊色ボタンの構造は現行`DeleteChatDialog.tsx`から変更しない。`DialogTitle`内の`Trash2`アイコン表示も`ConfirmDeleteDialog`側に残し、呼び出し元は`title`文字列だけ渡せばよい形にする（アイコンをprops化しない）。
- `DeleteChatDialog.tsx`は`ConfirmDeleteDialog`を内部で呼び出す薄いラッパーへリファクタリングする。既存Props（`chatTitle` / `mode` / `hasOrphanContent`）とタイトル・説明文の表示内容は変更しない。呼び出し元`AnalyticsTable.tsx`側の変更は不要とする。
- 管理者ユーザー削除用ダイアログは`ConfirmDeleteDialog`を直接呼び出し、タイトルへ`ユーザーを完全に削除しますか？`、本文へ対象の氏名・メールアドレス・LINE表示名（6.2の表示内容）を渡す。
- 確認文字列の入力欄は持たない（6.2参照）。

### 7.2 管理画面用DTO

一般ユーザー向け`User`へStripe IDや組織IDを追加しない。管理画面用DTOを定義する。

```ts
type UserDeletionBlockedReason =
  | 'admin'
  | 'active_subscription'
  | 'organization_linked';

interface AdminUserListItem extends User {
  canDelete: boolean;
  deletionBlockedReason: UserDeletionBlockedReason | null;
}
```

`getAllUsers()`は管理者向け一覧DTOを返す。削除可否はService Roleで取得したDB行からサーバー側で導出する。クライアントから送られた`canDelete`を信用しない。

### 7.3 Server Action

`src/server/actions/admin.actions.ts`へ管理者専用削除Actionを追加する。

```ts
interface DeleteUserInput {
  userId: string;
}

async function deleteUser(input: DeleteUserInput): Promise<ServerActionResult<void>>;
```

- `deleteUserSchema`でUUIDを検証する。
- `resolveAdminUser()`は実行管理者のuser IDとroleを返せる形へ変更する。
- Action先頭で管理者認可を再実行する。
- 成功時だけ`revalidatePath('/admin/users')`を実行する。
- 表示可能なエラーだけを`ERROR_MESSAGES`経由で返す。

### 7.4 Service層

`userService`へ削除ユースケースを集約し、次の順に処理する。

1. 対象DB行を再取得する。
2. 管理者、Stripe契約、親組織、子スタッフの有無をアプリ層で早期検証する（UX用。最終保証はRPC側）。
3. `admin_action_logs`へ`action='user_deletion'`、`status='started'`の行を作成する。失敗した場合は削除を開始しない。
4. `supabase_auth_id`を退避したうえで、更新版`delete_user_fully` RPCで行ロック・保護再検証・関連データと`public.users`削除を行う。
5. RPC成功後、退避した`supabase_auth_id`がある場合だけSupabase Authを削除する。
6. 監査ログを`succeeded`へ更新する（短時間リトライあり）。確定に失敗した場合は成功扱いにせず、監査未確定エラーを返す。
7. 失敗時は安全な失敗コードで監査ログを`failed`へ更新し、表示用エラーを返す。

インフラ詳細は`SupabaseService`内に閉じ、ActionからAuth Admin APIやRPCを直接呼ばない。

**順序の根拠（2026-07-22）**: 以前は Auth→DB とし、DB失敗時に`public.users`を残して再試行可能にしていた。しかし保護条件をアプリ層だけで検証すると、検証〜削除の間に対象が`admin`等へ変わった場合に削除不可ユーザーを消せる TOCTOU がある。保護の最終保証をRPC（`FOR UPDATE`＋条件再検証）に置くため、**DB削除を先に確定してから Auth を消す**。保護違反時は Auth に触らない。DB成功後の Auth 失敗は管理画面からの同一ユーザー再試行はできない（行が消えている）ため、運用連絡用の専用エラーメッセージを返す。

### 7.5 Supabase Auth削除

- Service Roleクライアントの`auth.admin.deleteUser(supabaseAuthId)`を使う。
- `public.users.id`をAuth APIへ渡してはならない。
- Authユーザーが既に存在しない場合は成功扱いとする（再実行時の冪等）。
- Auth削除は **RPC（DB削除）成功後** に行う（管理画面パスは短時間リトライあり）。
- **pending 先行（同一TX）**: `delete_user_fully` は保護通過後・`public.users`削除前に、`supabase_auth_id`がある場合だけ`pending_auth_user_deletions`へINSERTする。これにより Auth削除前のクラッシュや pending 書込み失敗でも再作成窓を開けない。作成時の`next_attempt_at`は**初期lease（30秒）**とし、管理画面の直後 Auth リトライ中にログイン claim が割り込まないようにする。
- Auth削除成功時は pending 行を削除する。**清掃に失敗した場合は監査を`succeeded`にせず**専用エラーを返す（Auth自体は削除済みの可能性が高い）。
- Auth削除失敗時は次を行う。
  1. pending の`attempt_count` / `last_attempt_at` / `next_attempt_at`を更新する（行自体はRPCで作成済み）。
  2. 監査を`failed`（`auth_delete_failed`）へ更新する（短時間リトライ。0件更新・リトライ尽きは成功扱いにせず監査未確定エラーを返す）。
  3. DBは削除済みである旨の専用エラーを返す（管理画面の同一ID再試行は不可）。
- 監査開始時に`target_supabase_auth_id`を保存し、失敗後の追跡・手動清掃に使う。
- `resolveOrCreateEmailUser`は`claim_pending_auth_user_deletion` RPCで原子的に claim し、到達時のみ Auth 削除を1回試し、**同一 auth id の`public.users`再作成を常に拒否**する（`PendingAuthDeletionError`）。未到達（lease/backoff）時は Auth Admin API を呼ばない。

## 8. DB・監査設計

### 8.1 監査テーブル

新規テーブル名は`admin_action_logs`とする。ユーザー削除専用にせず、将来の管理者操作（権限変更等、現状は無監査）にも使い回せる汎用構造にする。ユーザー削除は稀な操作であり、専用テーブルの型安全さより汎用テーブルの再利用性を優先する。

| 列 | 型 | 制約・用途 |
|---|---|---|
| `id` | uuid | PK、default `gen_random_uuid()` |
| `actor_user_id` | uuid | 実行管理者ID。削除後も履歴を保持するためFKを付けない |
| `target_user_id` | uuid | 対象ID。対象削除後も保持するためFKを付けない |
| `action` | text | 操作種別。v1では`'user_deletion'`のみ書き込む |
| `status` | text | `started` / `succeeded` / `failed`のCHECK制約 |
| `failure_code` | text nullable | 安全な固定コード。例外文やPIIを保存しない |
| `created_at` | timestamptz | 開始日時 |
| `completed_at` | timestamptz nullable | 成功・失敗確定日時 |

- RLSを有効化する。
- `anon`と`authenticated`へpolicyを作成しない。
- Service Roleだけが読み書きする。
- v1では自動削除期限を設けず保持する。
- メール、氏名、LINE情報、例外本文、アクセストークンを保存しない。
- `action`はv1では`CHECK (action = 'user_deletion')`または制約なしのtextとし、将来別の操作（例: `role_change`）を追加する際にCHECK更新または制約なし運用のどちらにするかは実装時に判断する。
- 本機能が書き込むのは`action = 'user_deletion'`の行のみ。他`action`値の追加・利用は本仕様の対象外とする。

### 8.2 `delete_user_fully`更新

実装前に、現行DB型と全migrationを基に対象ユーザーを参照するテーブルを棚卸しする。

- UUID FK + `ON DELETE CASCADE`のテーブルはcascadeを正本とする。
- text型`user_id`またはFKのないテーブルはRPC内で明示削除する。現行RPCが対象とする`chat_sessions`/`chat_messages`/`briefs`/`content_annotations`の4テーブルで棚卸しは完了しており、追加は不要（`content_categories`は3.2の通り既にDROP済みのため対象外）。
- **UUID FKだが`ON DELETE CASCADE`が付いていない列**（例: `prompt_templates.updated_by`）は、`created_by`の前例（`20250803121157_add_on_delete_set_null_to_prompt_templates_created_by.sql`）に倣い`ON DELETE SET NULL`へ修正する。本マイグレーションに含める。
- 監査ログは削除対象から除外する。
- RPC内のDB削除は単一トランザクションとする。
- 実行権限はService Roleだけに維持する。
- **削除保護の最終保証（2026-07-22）**: RPC内で対象行を`SELECT … FOR UPDATE`し、同一トランザクションで次を再検証してから DELETE する。
  - `role = 'admin'` → `blocked_admin`
  - `stripe_subscription_id IS NOT NULL` → `blocked_active_subscription`
  - `owner_user_id IS NOT NULL` または子参照（`owner_user_id = 対象`）が存在 → `blocked_organization`
  - 旧スタッフ削除RPC（`delete_employee_and_restore_owner`）はアプリ未使用のため DROP。組織カラム自体の撤去は別タスク。
- **pending 先行（2026-07-22）**: 保護通過後、関連データと`users`削除の前に、`supabase_auth_id IS NOT NULL`なら`pending_auth_user_deletions`へINSERTする。`p_admin_action_log_id`を受け取り紐付ける。`next_attempt_at`は初期lease（`now() + 30 seconds`）。
- **原子的 claim**: `claim_pending_auth_user_deletion(p_supabase_auth_id)`が`UPDATE … WHERE next_attempt_at IS NULL OR next_attempt_at <= now() RETURNING`で試行権を付与する。

Auth APIとDBトランザクションは原子的にできない。**現行順序は DB（条件付き削除＋pending先行）成功後に Auth**。Auth失敗時は`public.users`は既に無いため、管理画面の同一ID再試行はできず、pending＋Auth側の清掃（ログイン時のclaim再試行または手動）が必要になる。

### 8.3 マイグレーションとロールバック

マイグレーションには次を含める。

- `admin_action_logs`作成、CHECK制約、RLS、権限設定。
- 更新版`delete_user_fully` RPC（`prompt_templates.updated_by`への`ON DELETE SET NULL`追加を含む）。
- `database.types.ts`の再生成。

**適用手順（段階分割）**: `README.md`の運用ルールにより、リモートDBへのマイグレーション適用（`supabase db push`）は管理者が手動で行う。`npm run supabase:types`はリモートDBを読むため、未適用のテーブルは型に現れず、`.from('admin_action_logs')`を含むコードは`npm run build`で型エラーになる。`database.types.ts`は生成ファイルのため直接編集しない（`CLAUDE.md`「自動生成ファイルの直接編集は避ける」）。CIにも型自動再生成の仕組みはなく、`npm run supabase:types`は`SUPABASE_ACCESS_TOKEN`を持つ人が手動で実行する必要がある。したがって実装を次の段階に分ける。

- **Stage1（完了）**: マイグレーションのみのPR（`admin_action_logs`作成＋`prompt_templates.updated_by`のFK修正）。2026-07-16、`supabase db push`で本番へ適用済み。
- **Stage2a（型不要・着手可能）**: `admin_action_logs`を一切参照しない部分を先に実装する。
  - 管理画面用DTO（`UserDeletionBlockedReason` / `AdminUserListItem`、7.2）
  - `resolveAdminUser()`のuser ID返却拡張（7.3）
  - 一覧UIの削除可否表示、`ConfirmDeleteDialog`抽出、ユーザー削除ダイアログ実装（6.1〜6.4、7.1）
  - このStage2aの時点では`deleteUser` Server Actionは実装しない（呼び出し先が無いため）。ダイアログの「削除」ボタンはStage2bで配線するまで有効化しない。
- **Stage2b（型必須・型反映後に着手）**: `npm run supabase:types`で`database.types.ts`に`admin_action_logs`が反映されたことを確認してから着手する。
  - `deleteUserSchema`（Zod）、`deleteUser` Server Action（7.3）
  - Service層の削除ユースケース（7.4）、Supabase Auth削除（7.5）
  - 監査ログ書き込み、更新版`delete_user_fully` RPCの呼び出し配線
  - Stage2aで実装済みのダイアログへ`deleteUser`を配線する
- **Stage3（2026-07-22〜23・削除安全性硬化）**: コード配備の**前に**次の**2本を順に**`supabase db push`する。未適用のまま新コードだけ出すとRPC・pendingテーブル不一致で壊れる。
  1. `20260722000000_harden_user_deletion_safety.sql`（旧スタッフRPC DROP、FOR UPDATE＋保護再検証、`target_supabase_auth_id`、`pending_auth_user_deletions`＋初期lease、`claim_pending_auth_user_deletion`、RPC内pending先行、`p_admin_action_log_id`）
  2. `20260723000000_schedule_pending_auth_deletion_retry.sql`（Auth失敗後の pending backoff を原子的に更新する `schedule_pending_auth_user_deletion_retry`）
  - **適用順序**: 必ず `20260722000000` → `20260723000000`。逆順・片方のみは不可。
  - **切替手順**:
    1. 管理画面のユーザー削除 Action を停止する（フラグオフまたは一時的に Action を無効化）。
    2. `supabase db push`（上記2本を順に適用）。
    3. 新アプリコードを配備する。
    4. 削除 Action を再開する。
  - **切替窓の理由**: migration 先行後に旧コードで削除すると、RPCが作った pending を旧コードが清掃せず残る。切替中は削除を止める。
  - **補足**: 当初 Stage3 の本体は1本に統合したが、その後の backoff 原子化で `20260723000000` を追加した。運用上の正本は上記2本。

Stage2a・Stage2bはそれぞれ独立したPRとして完了させてよい。Stage2aのPRは、Stage2bの機能（削除の実行）が未接続であることを理由に不完全とはしない。

ロールバックは新規削除Actionの停止後に行う。

1. **先に削除 Action を停止**する。
2. Auth Admin で`pending_auth_user_deletions`に残る各 `supabase_auth_id` を手動削除する。
3. **Auth 不存在を確認したうえで**、対応する pending 行を明示的に削除する（Auth 削除だけでは pending 行は自動で消えない）。
   ```sql
   -- 例: 対象 auth id の Auth 不存在を確認したあと
   DELETE FROM public.pending_auth_user_deletions
    WHERE supabase_auth_id = '<auth-uuid>';
   ```
4. pending が空であることを確認する。
5. **pending に未削除 Auth が残る状態でテーブルを DROP してはならない**（再作成防止が解除される）。
6. **現行（pending 依存）アプリを残したままテーブルを DROP してはならない**（メール認証解決が DB エラーになる）。先に旧アプリへ戻してから DROP する。
7. 旧RPC定義を復元する。
8. 空であること・旧アプリ配備を確認したうえで`pending_auth_user_deletions`をdropし、必要なら`target_supabase_auth_id`列を落とす。
9. `admin_action_logs`のdropは監査保持方針に従い別判断とする。

既に削除されたユーザーデータはロールバックで復元できない。バックアップからの個別復旧も本機能の保証対象外とする。

## 9. エラー・再試行

| 事象 | DB削除 | Auth削除 | 監査 | ユーザー表示・復帰 |
|---|---|---|---|---|
| 認証・認可失敗 | 未実行 | 未実行 | 作成しない | ログインまたは管理者権限を案内 |
| 入力不正（UUID不正等） | 未実行 | 未実行 | 作成しない | 一覧更新を案内 |
| 対象不存在 | 未実行 | 未実行 | 作成しない | 一覧更新を案内 |
| 保護条件該当（アプリ層） | 未実行 | 未実行 | 作成しない | 降格、解約、組織解除を案内 |
| 監査開始失敗 | 未実行 | 未実行 | 作成失敗 | 削除を開始せず再試行案内 |
| RPC保護違反（TOCTOU検知） | 未実行（rollback） | 未実行 | `failed`（`db_delete_failed`系） | 一覧を維持し再試行可能 |
| RPC DB削除失敗 | 未実行またはrollback | 未実行 | `failed` | 一覧を維持し再試行可能 |
| DB削除成功、Auth削除失敗 | 完了（pending同一TX作成済み） | 失敗（原子的backoff更新） | `failed`（`auth_delete_failed`等）。監査確定失敗時は未確定エラー | 行は消える（`dbDeleted`でUI除去）。専用エラーで管理者連絡。同一IDの画面再試行は不可 |
| DB削除成功、Auth削除成功、pending清掃失敗 | 完了 | 完了 | `failed`（`pending_cleanup_failed`）。成功扱いにしない | 行は消える。専用エラーで管理者連絡（pending手動清掃） |
| DB削除成功、Auth削除成功、監査確定失敗 | 完了 | 完了（pending削除済） | `started`のまま（成功扱いにしない） | 削除自体は完了。監査未確定エラーで状態確認を案内 |
| すべて成功 | 完了 | 完了（pending削除） | `succeeded` | 行除去と成功toast |
| pending残存中の再ログイン | — | 原子的claim到達時のみ1回 | — | `public.users`再作成禁止。lease/backoff未到達時はAuth非呼び出し。OTPはエラー表示しセッション破棄 |

内部エラー、Supabaseエラー本文、SQLエラーをクライアントへ返さない。`ERROR_MESSAGES.USER` / `ERROR_MESSAGES.AUTH`へ削除失敗、保護条件、pending再作成拒否等の固定文言を追加する。

二重送信はクライアントのdisabledとサーバーの対象再取得・冪等処理の両方で防ぐ。先行リクエストで削除済みの場合、後続リクエストは対象不存在として安全に終了する。

## 10. セキュリティ

- 削除Actionは未ログイン、非管理者から実行できない。
- Service Roleクライアント、Auth Admin API、RPCはサーバー層だけで使用する。
- 対象ID、削除可否をサーバーで再検証し、クライアントDTOを認可根拠にしない。
- RPCはService Role以外へexecute権限を与えない。
- 監査ログはクライアントから読み書きできない。
- ログ、toast、Action戻り値へcredential、token、内部SQLエラーを含めない。
- 削除対象の明示的なuser IDスコープなしに一括削除しない。

## 11. 既存機能への影響

- `/admin/users`: アクション列、一覧DTO、ローカル状態更新が変わる。
- 管理者認可: `resolveAdminUser()`の成功値へactor user IDを追加する。
- `userService` / `SupabaseService`: 削除ユースケースとAuth削除を追加する。
- `ERROR_MESSAGES.USER`: 削除関連文言を追加する。
- Supabase migration / generated database types: 監査テーブルとRPC更新を反映する。
- `src/components/DeleteChatDialog.tsx`: `ConfirmDeleteDialog`を内部で呼び出す形へリファクタリングする。呼び出し元は`src/components/AnalyticsTable.tsx`（`/analytics`）と`app/chat/components/SessionSidebar.tsx`（`/chat`）の2箇所。Props・表示内容・両呼び出し元は変更しないが、内部実装変更のため既存チャット削除・コンテンツ削除の表示と挙動に回帰がないことを両画面で確認する（12.1・12.3参照）。
- `delete_user_fully` RPC: 旧`delete_employee_and_restore_owner`依存は廃止済み。ユーザー削除の保護再検証は本RPC内で完結する。
- 権限更新、トークン利用量画面への遷移、一般ユーザーのログイン動作は変更しない。

## 12. テスト計画

### 12.1 Unit / Service Action

- UUID以外の`userId`を拒否する。
- 未ログイン、非管理者を拒否する。
- 管理者対象を拒否する。
- `stripe_subscription_id`保持者を拒否する。
- 親組織または子スタッフを持つ対象を拒否する。
- Auth削除には`supabase_auth_id`を渡し、public user IDを渡さない。
- LINE専用ユーザーではAuth Admin APIを呼ばない。
- **DB先行**: Auth削除は`delete_user_fully` RPC成功後にのみ呼ぶ。RPC失敗時はAuthを呼ばない。
- Auth不存在は成功扱いとする。
- Auth削除失敗時は（RPCで作成済みの）pending のbackoffを更新し、監査を`failed`にし、専用エラーを返す。
- Auth成功後のpending清掃失敗は成功扱いにせず、監査`failed`（`pending_cleanup_failed`）と専用エラーを返す。
- 監査`succeeded` / `failed`更新が0件または失敗の場合は成功扱いにしない（短時間リトライあり。失敗側も呼び出し元へ監査未確定を返す）。
- `resolveOrCreateEmailUser`は`claim_pending_auth_user_deletion` RPCで原子的claimし、pendingがある場合に`createEmailUser`せず`PendingAuthDeletionError`を投げる。lease/backoff未到達ではAuthを呼ばない。claim時はAuthを最大1回。
- DB失敗時はActionが安全なエラーを返し、対象DB行が残る。
- 成功時だけ`revalidatePath('/admin/users')`を呼ぶ。
- 監査開始失敗時は破壊処理を開始しない。
- `ConfirmDeleteDialog`抽出後も`DeleteChatDialog`は既存Props（`chatTitle` / `mode` / `hasOrphanContent`）でチャット削除・コンテンツ削除それぞれ従来と同じタイトル・説明文を表示する（回帰確認）。

### 12.2 DB / Migration

- 対象ユーザーのFK cascade対象データが削除される。
- `chat_messages`、`chat_sessions`、`content_annotations`、`briefs`等の非FK参照が残らない。
- `prompt_templates.updated_by`が対象ユーザーを参照していた場合、削除がFK違反で失敗せず`NULL`になる。
- 別ユーザーのデータを削除しない。
- 組織関係がある対象はService層で拒否される。
- 監査ログは対象ユーザー削除後も残る。
- `anon`と`authenticated`が監査ログを読み書きできない。
- RPCを`authenticated`が直接実行できない。

### 12.3 UI / Manual

- 削除可能・削除不可の表示と理由が正しい。
- 実行中は連打、キャンセル、Dialog閉鎖ができない。
- 成功時に対象行、合計人数、権限別人数が同期更新される。
- 最後の一般ユーザー削除後に既存空状態が表示される。
- 失敗時に対象行が残り、原因と次の操作がtoast表示される。
- Tab、Shift+Tab、Enter、Escape、focus-visibleを確認する。
- 狭い画面でも既存テーブルの横スクロールとダイアログ操作が破綻しない。
- `/analytics`の既存チャット・コンテンツ削除UI（`AnalyticsTable.tsx`経由）が、リファクタリング後も従来通り動作する（表示文言・削除確認・成功toastを含む）。
- `/chat`の既存チャット削除UI（`SessionSidebar.tsx`経由）が、リファクタリング後も従来通り動作する。

### 12.4 品質ゲート

実装完了時に次を実行する。

- `npm run verify`（lint・test・build・knipを一括実行）
- 新規ファイルを含む`git diff`確認
- `quality-gate`の2パスセルフレビュー

## 13. 受け入れ条件

1. 管理者が削除可能な一般ユーザーを一覧から選び、確認ダイアログのボタン押下で完全削除できる。
2. 削除後、対象のSupabase Auth、`public.users`、関連利用データが残らない。
3. 管理者、Stripe契約情報保持者、組織関係保持者は削除できず、理由と事前作業が表示される。
4. Auth削除失敗時は`public.users`行は既に消えており、管理画面の同一ID再試行はできない。pendingと専用エラーで復旧し、ログイン時のclaimまたは手動Auth清掃で完了させる。RPC失敗（保護違反等）でDBが残っている場合のみ、一覧から安全に再試行できる。
5. 成功・失敗を含む削除試行がPIIなしの監査ログへ記録される。
6. 非管理者、クライアントからの改ざん、RPC直接実行で削除できない。
7. UIが既存のshadcn/Radix、Sonner、セマンティックトークンを使用し、キーボード操作可能である。
8. 削除後の再登録は新規アカウントとして許可され、恒久BANとして扱われない。

## 14. 前提・確定事項

- 本機能の「完全削除」は現在のアカウントと利用データの削除を指し、再登録禁止を意味しない。
- 管理者は削除不可。降格後に削除する。
- Stripe契約と組織関係は削除処理内で自動変更しない。
- 削除は復元不能である。
- 監査ログ閲覧UIは別仕様とする。
- 実装中に削除対象テーブル、認可、課金、組織運用について本仕様と異なる判断が必要になった場合、実装者は仕様を拡張せず停止して仕様書を更新する。

## 15. 工数目安

要求定義〜詳細設計（本仕様書）完了後、開発〜リリースの残工数は約50h（開発24h、テスト9.6h、納品・リリース2.4h、PM overhead 5.4h、リスクバッファ込み）＝**約6.2人日**（1人日=8h換算）。兼務ペースで約4週間、専念できれば約6〜7営業日。
