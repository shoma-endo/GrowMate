import Link from 'next/link';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { CircleCheck, Settings2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HomeToday, HomeTodayItemKind } from '@/lib/home-today';
import { cn } from '@/lib/utils';

/**
 * マイホームの本文。出すのは連携の異常だけで、機能一覧（サイドバーの複製）や
 * toast と重複する改善提案は置かない（docs/plans/home-today-spec.md HOME-01）。
 */
interface TodayChecklistProps {
  today: HomeToday;
  /** 空状態の「設定」リンクを出すか（/setup は paid/admin のみ） */
  canOpenSetup: boolean;
}

const KIND_ICON: Record<HomeTodayItemKind, LucideIcon> = {
  reauth: TriangleAlert,
  setup: Settings2,
};

interface TodayCardProps {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  cta?: { label: string; href: string };
  tone?: 'default' | 'warning' | 'ok';
}

function TodayCard({ icon: Icon, title, description, cta, tone = 'default' }: TodayCardProps) {
  return (
    <Card
      className={cn(
        // sm 未満はボタンを下に落とす（Button は whitespace-nowrap で縮まないため）
        'flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4',
        tone === 'warning' && 'border-destructive/40'
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0',
            tone === 'warning' && 'text-destructive',
            tone === 'ok' && 'text-primary',
            tone === 'default' && 'text-muted-foreground'
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {cta && (
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      )}
    </Card>
  );
}

export function TodayChecklist({ today, canOpenSetup }: TodayChecklistProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 space-y-4">
      <h1 className="text-3xl font-bold">マイホーム</h1>

      {today.fetchFailed && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {ERROR_MESSAGES.HOME.PARTIAL_FETCH_FAILED}
        </p>
      )}

      {today.items.length === 0 ? (
        <TodayCard
          icon={CircleCheck}
          tone="ok"
          title="確認が必要なことはありません"
          description={
            // 未連携があり /setup に入れる役割のときだけ「設定」へ誘導する。
            // 全部連携済みの人に毎日出す文ではない（spec §4 Non-goal「未連携の常時表示」）
            canOpenSetup && today.hasUnlinked ? (
              <>
                連携がまだの場合は{' '}
                <Link href="/setup" className="underline underline-offset-4 hover:text-foreground">
                  設定
                </Link>{' '}
                から始められます。
              </>
            ) : (
              '新しい提案や連携の異常があるとここに出ます。'
            )
          }
        />
      ) : (
        today.items.map(item => (
          <TodayCard
            key={item.id}
            icon={KIND_ICON[item.kind]}
            tone={item.kind === 'reauth' ? 'warning' : 'default'}
            title={item.title}
            description={item.description}
            cta={item.cta}
          />
        ))
      )}
    </div>
  );
}
