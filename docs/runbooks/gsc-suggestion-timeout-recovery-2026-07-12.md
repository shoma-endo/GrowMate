# GSC 改善提案タイムアウト回収設計

## 背景

Hourly Cron の GSC 改善提案ジョブで、LLM 呼び出しが 180 秒を超えて
`Request was aborted.` となり、最大 3 回の試行上限へ到達した。

2026-07-12 の調査時点では、171 件中 163 件が完了し、8 件が
`suggestion_status = 'failed'` かつ `suggestion_attempt_count = 3` のまま残っている。
対象 8 件はいずれも `suggestion_summary IS NULL` である。

## 恒久対策

- 1 回の Cron で claim するジョブを 5 件から 3 件へ減らし、Anthropic への同時リクエスト数を抑える。
- 個別 LLM 呼び出しのタイムアウトを 180 秒から 220 秒へ延長する。
- ジョブ全体の 240 秒制限は維持し、結果の集約と DB 保存に 20 秒を残す。
- テンプレートごとに開始・完了・失敗、stage、provider、model、処理時間をログへ出す。
- プロンプト、記事本文、生成結果、ユーザー識別子はログへ出さない。

公開 API、DB スキーマ、15 分間隔・最大 3 回の再試行仕様は変更しない。

## 回収手順

1. 恒久対策を本番へ反映し、通常の GSC 改善提案 Cron が成功することを確認する。
2. 調査時に確定した 8 件の履歴 ID を明示し、次の条件をすべて満たす行だけ再投入する。
   - `suggestion_status = 'failed'`
   - `suggestion_attempt_count >= 3`
   - `suggestion_summary IS NULL`
3. 対象行を `pending` に戻し、試行回数を 0、開始時刻・完了時刻・ジョブトークン・エラーを NULL、次回実行時刻を現在時刻にする。
4. Cron により最大 3 件ずつ処理し、8 件すべてが `completed` かつ提案保存済みになることを確認する。
5. 再度上限へ到達した場合は再投入を繰り返さず、テンプレート別ログから原因を再調査する。

回収 SQL は本番反映後に対象 ID とガード条件を再確認してから実行する。コードの検証中には実行しない。

```sql
begin;

do $$
declare
  target_count integer;
begin
  select count(*)
  into target_count
  from public.gsc_article_evaluation_history
  where id in (
    'e5b31230-bca9-4031-a36c-6a2f5c880241',
    '2d260643-9c30-4c1e-abca-249037f29e9d',
    '930cd19b-3a88-4a77-8e30-1e385ec015f6',
    '0107de9b-e443-42ac-ad94-af4675c100e4',
    '1f6ea622-7252-4af1-a25c-20a8d086d2cb',
    '56204ab8-8543-406b-b25e-e6fc2e86cde9',
    '1555a3f1-07c2-4839-be0b-8ba6938e4170',
    'cc8e27b5-64ce-4935-83d9-8fd92be80e5b'
  )
    and suggestion_status = 'failed'
    and suggestion_attempt_count >= 3
    and suggestion_summary is null;

  if target_count <> 8 then
    raise exception 'Expected 8 recoverable GSC suggestion jobs, found %', target_count;
  end if;

  update public.gsc_article_evaluation_history
  set
    suggestion_status = 'pending',
    suggestion_attempt_count = 0,
    suggestion_next_retry_at = timezone('utc', now()),
    suggestion_error = null,
    suggestion_started_at = null,
    suggestion_completed_at = null,
    suggestion_job_token = null
  where id in (
    'e5b31230-bca9-4031-a36c-6a2f5c880241',
    '2d260643-9c30-4c1e-abca-249037f29e9d',
    '930cd19b-3a88-4a77-8e30-1e385ec015f6',
    '0107de9b-e443-42ac-ad94-af4675c100e4',
    '1f6ea622-7252-4af1-a25c-20a8d086d2cb',
    '56204ab8-8543-406b-b25e-e6fc2e86cde9',
    '1555a3f1-07c2-4839-be0b-8ba6938e4170',
    'cc8e27b5-64ce-4935-83d9-8fd92be80e5b'
  )
    and suggestion_status = 'failed'
    and suggestion_attempt_count >= 3
    and suggestion_summary is null;
end
$$;

commit;
```

回収後は次の読み取り SQL で状態を確認する。

```sql
select
  suggestion_status,
  suggestion_attempt_count,
  count(*) as jobs
from public.gsc_article_evaluation_history
where id in (
  'e5b31230-bca9-4031-a36c-6a2f5c880241',
  '2d260643-9c30-4c1e-abca-249037f29e9d',
  '930cd19b-3a88-4a77-8e30-1e385ec015f6',
  '0107de9b-e443-42ac-ad94-af4675c100e4',
  '1f6ea622-7252-4af1-a25c-20a8d086d2cb',
  '56204ab8-8543-406b-b25e-e6fc2e86cde9',
  '1555a3f1-07c2-4839-be0b-8ba6938e4170',
  'cc8e27b5-64ce-4935-83d9-8fd92be80e5b'
)
group by suggestion_status, suggestion_attempt_count
order by suggestion_status, suggestion_attempt_count;
```

## 検証

- claim RPC の上限が 3 であること。
- LLM 呼び出しへ 220 秒の timeout と AbortSignal が渡ること。
- 3 回目の失敗だけが `terminalFailed` として集計されること。
- stale なジョブトークンでは生成結果を保存しないこと。
- `npm run verify` が成功すること。
