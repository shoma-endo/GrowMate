# Supabase サービス利用規約

プロジェクトにおける Supabase 操作の「唯一の正解 (SSoT)」を定義します。

## 1. サービス層の統一 (Unification)

- **原則**: すべての Supabase 操作は、基底クラス `SupabaseService` (実ファイル: `src/server/services/supabaseService.ts`) またはそのドメイン別サブクラス（例: `userService.ts`, `chatService.ts`）を介して実行してください。
- **禁止事項**: 業務ロジック内で `@supabase/supabase-js` を直接インポートして `createClient` を呼び出し、アドホックなクエリを記述することは厳禁です。

## 2. クライアント管理 (Client Management)

- **管理層**: クライアントの生成・管理は `src/lib/client-manager.ts` (`SupabaseClientManager`) が一括して担います。
- **インスタンス取得**:
  - `SupabaseService` 内では `SupabaseClientManager.getInstance().getServiceRoleClient()` を使用して特権操作を行います。
  - 特殊なケースを除き、直接 `manager` を叩くのではなく `SupabaseService` を継承・利用してください。

## 3. Service Role 利用の安全基準

- [IMPORTANT] `Service Role` は RLS を完全にバイパスするため、利用は以下の用途に限定してください。
  - **管理処理 (Admin)**: ユーザーロールの変更、全ユーザー一覧の取得など。
  - **バックグラウンド処理 (Batch/Cron)**: GSC データインポート、定期的なデータ評価など。
  - **特権が必要な内部 API**: 認証ユーザーの紐付け更新、システム整合性チェックなど。
- [WARNING] RLS が効かないため、**アプリケーション層での明示的な ID チェックを省略してはなりません**。
  - クエリに `.eq('user_id', userId)` 等を含め、操作対象がそのユーザーの所有物であることを必ず保証してください。
- **推奨パターン**: 静的な特権操作が必要な場合は、`SupabaseService` を継承し、実在する `protected static withServiceRoleClient()` ユーティリティを活用してください（自動的に詳細なログが付与されます）。

## 4. エラーハンドリングとログ (Error Handling)

- **統一フォーマット**: `SupabaseService` の `protected failure()` メソッド（インスタンスメソッド、`supabaseService.ts` 参照）を必ず使用し、ユーザー向けメッセージとエンジニア向け詳細ログ（`PostgrestError`, `context`）を適切に分離・記録してください。

## 5. 実装パターン (Recommended Pattern)

- Server Actions / Route Handlers 等からは、ドメイン固有のサービスを通じて `SupabaseService` の機能を呼び出します。

```typescript
export class AnalyticsContentService extends SupabaseService {
  static async getSomething(userId: string) {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('content_annotations')
          .select('*')
          .eq('user_id', userId);
        if (error) throw error;
        return data;
      },
      { logMessage: 'データ取得エラー:' }
    );
  }
}
```

## 運用ルール

1. 新規テーブル追加時は、`supabaseService.ts` またはそのサブクラスに CRUD メソッドを追加することを基本としてください。
2. 複雑な結合クエリやパフォーマンスが重要な操作は、可能な限り Supabase RPC (関数) として実装し、サービス層から呼び出してください。
   - 目安: 3 テーブル以上の結合、サブクエリ/CTE/ウィンドウ関数を含む集計、条件分岐が 3 つ以上のビジネスロジック、クライアント側での後処理が重いケース、レイテンシに敏感なバッチ処理。
3. **取得上限とデータ打ち切りに注意**: PostgREST には `db-max-rows = 1000` のグローバル上限があり、`.limit(5000)` と書いても 1000 で切られます。大量行の取得、コード内での突合・集計、LLM プロンプト用データの用意を行う場合は、必ず `docs/context/db-row-limits-and-data-truncation.md`（2026-06 の実障害由来の知見）を先に読んでください。突合用とプロンプト用の取得は分離し、打ち切りが起きる場合は検知できる状態（ログ/フラグ）にします。

## 6. マイグレーション未適用テーブルへの暫定アクセス（Pending Migration Types）

`src/types/database.types.ts`はリモートDBから`npm run supabase:types`で生成される。マイグレーション適用（`supabase db push`）は管理者が手動で行う運用のため、実装時点でマイグレーションがまだリモートに未適用の場合、新規テーブル・新規列は生成型に存在しない。

**この状態を理由に実装を止めない。** `database.types.ts`は直接編集せず、次のパターンで実装を完了させる。

1. `src/types/database.types.pending.ts`に、対応する`supabase/migrations/`のSQLファイル名をコメントで明記した上で、対象テーブルの`Row` / `Insert` / `Update`型を定義する。
2. `SupabaseClient<Database>`をキャストするための最小限の合成`Database`型と、`asPendingClient()`ヘルパーを同ファイルに定義する（`as unknown as`を1箇所に閉じ込める。裸の`any`は使わない）。
3. サービス層では`asPendingClient(client)`を通してから`.from(table)`を呼ぶ。それ以降のメソッドチェーンは完全に型付けされる。

```ts
// src/types/database.types.pending.ts
// PROVISIONAL: supabase/migrations/20260716000000_add_admin_action_logs_and_fix_prompt_templates_updated_by_fk.sql
// 管理者がマイグレーションを適用し `npm run supabase:types` を実行した後、
// この定義を削除し、呼び出し側を `Database['public']['Tables']['admin_action_logs']` へ切り替える。
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export interface AdminActionLogRow {
  id: string;
  actor_user_id: string;
  target_user_id: string;
  action: string;
  status: 'started' | 'succeeded' | 'failed';
  failure_code: string | null;
  created_at: string;
  completed_at: string | null;
}
export interface AdminActionLogInsert {
  id?: string;
  actor_user_id: string;
  target_user_id: string;
  action: string;
  status: 'started' | 'succeeded' | 'failed';
  failure_code?: string | null;
  created_at?: string;
  completed_at?: string | null;
}
export type AdminActionLogUpdate = Partial<AdminActionLogInsert>;

interface PendingDatabase {
  public: {
    Tables: {
      admin_action_logs: { Row: AdminActionLogRow; Insert: AdminActionLogInsert; Update: AdminActionLogUpdate };
    };
  };
}

export type PendingSupabaseClient = SupabaseClient<PendingDatabase>;

export function asPendingClient(client: SupabaseClient<Database>): PendingSupabaseClient {
  return client as unknown as PendingSupabaseClient;
}
```

```ts
// 呼び出し側（例: サービス層）
const { data, error } = await asPendingClient(client)
  .from('admin_action_logs')
  .insert({ actor_user_id, target_user_id, action: 'user_deletion', status: 'started' })
  .select()
  .single();
```

**運用ルール**:

- 暫定型の行・列定義は、対応するマイグレーションSQLと完全に一致させる（新規に推測しない）。
- `database.types.pending.ts`のエクスポート・コメントに、参照元マイグレーションファイル名を必ず記載する。
- PRの未確認事項に「マイグレーション適用・`npm run supabase:types`実行後、`database.types.pending.ts`の該当ブロックを削除し呼び出し側を生成型へ切り替える」旨を明記する。
- マイグレーション未適用であること自体は、実装不能・仕様不足の理由にしない。

## 関連

- RLS / マイグレーション: [`rls.md`](rls.md)
- 取得上限・データ打ち切りの指針: `docs/context/db-row-limits-and-data-truncation.md`
