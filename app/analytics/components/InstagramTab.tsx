'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, Settings, Loader2, History } from 'lucide-react';
import { ActiveFilterBar, FilterTag } from '@/components/AnalyticsTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ANALYTICS_STORAGE_KEYS,
  DEFAULT_IG_SORT,
  DEFAULT_IG_SORT_ORDER,
  INSTAGRAM_COLUMNS,
  loadInstagramHighOnlyFromStorage,
  loadInstagramSortFromStorage,
  loadInstagramSortOrderFromStorage,
  resolveInstagramRestorePatch,
} from '@/lib/constants';
import { normalizeFieldConfig } from '@/lib/field-config';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getInstagramSyncToastMessage } from '@/lib/instagram-sync';
import { formatJstDateISO } from '@/lib/date-utils';
import {
  formatInstagramEngagementTargetLabel,
  getInstagramEngagementTarget,
} from '@/lib/instagram-format';
import { syncInstagramData } from '@/server/actions/instagramSync.actions';
import type {
  InstagramMediaListItem,
  InstagramMediaSortKey,
  InstagramMediaSortOrder,
  InstagramMediaTypeFilter,
} from '@/types/instagram';
import type { StoredFieldConfig } from '@/types/field-config';
import InstagramMediaTable from './InstagramMediaTable';

interface InstagramTabProps {
  items: InstagramMediaListItem[];
  total: number;
  totalPages: number;
  igPage: number;
  igType: InstagramMediaTypeFilter;
  /** null は絞り込みなし（全期間）。日付入力は空で表示する */
  igStart: string | null;
  /** null は絞り込みなし（全期間）。日付入力は空で表示する */
  igEnd: string | null;
  igSort: InstagramMediaSortKey;
  igOrder: InstagramMediaSortOrder;
  igHigh: boolean;
  followersCount: number | null;
  lastSyncedAt: string | null;
  backfillStatus: 'not_started' | 'in_progress' | 'completed';
  syncEnabled: boolean;
  /** サーバー側の判定（JST で今日まだ同期していない）。実際の発火は下の localStorage ガードと AND */
  autoSyncNeeded: boolean;
  /** 自動同期の localStorage ガードをユーザー単位に分けるためのキー。同一ブラウザでの
   *  アカウント切替時に、前のユーザーの記録で次のユーザーの自動同期が止まるのを防ぐ */
  autoSyncStorageKey: string;
  buildIgPageHref: (targetPage: number) => string;
  buildFilterHref: (patch: {
    igType?: InstagramMediaTypeFilter;
    igStart?: string | null;
    igEnd?: string | null;
    igSort?: InstagramMediaSortKey;
    igOrder?: InstagramMediaSortOrder;
    igPage?: number;
    igHigh?: boolean;
  }) => string;
  /** 保存済みのフィールド構成（未保存なら null） */
  fieldConfig: StoredFieldConfig | null;
}

/** 同期中の表示文言。トースト・ツールバー直下の進行表示・空状態の3箇所で共有する */
const INSTAGRAM_SYNCING_LABEL = 'Instagram データを取得中...';

function formatLastSyncedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function InstagramTab({
  items,
  total,
  totalPages,
  igPage,
  igType,
  igStart,
  igEnd,
  igSort,
  igOrder,
  igHigh,
  followersCount,
  lastSyncedAt,
  backfillStatus,
  syncEnabled,
  autoSyncNeeded,
  autoSyncStorageKey,
  buildIgPageHref,
  buildFilterHref,
  fieldConfig,
}: InstagramTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 自動同期する回は、エフェクトが走る前の1フレームで「まだデータがありません」が
  // ちらつかないよう最初から同期中にしておく。localStorage はここで見ない
  // （SSR 側で読めず hydration mismatch になる）。見送りの判定はエフェクト内で行い、
  // そのとき false に戻す。
  const [isSyncing, setIsSyncing] = React.useState(autoSyncNeeded && syncEnabled);
  const [syncAlert, setSyncAlert] = React.useState<string | null>(null);
  // 自動同期は toast を出さないので、その結果を伝えるチャネルは syncAlert だけになる。
  // 手動時の警告と違って消える先が無いため、絞り込み変更でクリアしない
  const [isSyncAlertFromAuto, setIsSyncAlertFromAuto] = React.useState(false);
  const [isBackfilling, setIsBackfilling] = React.useState(false);
  const [backfillAlert, setBackfillAlert] = React.useState<string | null>(null);
  // 未指定（全期間）は空文字で入力欄に出す。空にして「期間を適用」すれば絞り込みを外せる
  const [rangeStart, setRangeStart] = React.useState(igStart ?? '');
  const [rangeEnd, setRangeEnd] = React.useState(igEnd ?? '');
  // 旧実装は props（igStart/igEnd）の変化を待って解除していたが、サーバーが入力を正規化して
  // props が変わらない経路（不正日付 → null に落ちる / 開始と終了を逆に入れて swap で元に戻る）で
  // 「適用中...」が永久に残った。遷移そのものに紐づける。
  const [isApplyingDateRange, startDateRangeTransition] = React.useTransition();
  const isDateRangeChanged = rangeStart !== (igStart ?? '') || rangeEnd !== (igEnd ?? '');
  const hasDateRange = igStart !== null || igEnd !== null;

  // 絞り込み変更で前回同期の警告表示をクリアする（そのまま残すと別の絞り込み条件を
  // 見ていても古い警告が出続ける）。ただし自動同期由来の警告は残す — トーストが出ていないので
  // ここで消すと失敗の理由がどこにも無くなる。
  const clearManualSyncAlert = React.useCallback(() => {
    setSyncAlert(previous => (isSyncAlertFromAuto ? previous : null));
  }, [isSyncAlertFromAuto]);

  React.useEffect(() => {
    setRangeStart(igStart ?? '');
    setRangeEnd(igEnd ?? '');
    clearManualSyncAlert();
    // clearManualSyncAlert を依存に入れると isSyncAlertFromAuto の変化でも走ってしまう。
    // クリアの契機は絞り込みの変化だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [igStart, igEnd]);

  React.useEffect(() => {
    clearManualSyncAlert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [igType, igSort, igOrder, igPage]);

  const lastSyncedLabel = formatLastSyncedAt(lastSyncedAt);

  /**
   * incremental 同期。`auto` はタブ初回表示の自動同期で、ユーザーが押していないので
   * トーストを一切出さない（ブログタブが自動取得で通知を出さないのに合わせる）。
   * 代わりに、握り潰すと困る結果（レート制限中断・打ち切り・部分失敗）は Alert に落とす。
   */
  const handleSync = async (options?: { auto?: boolean }) => {
    const isAuto = options?.auto === true;
    setIsSyncing(true);
    setSyncAlert(null);
    setIsSyncAlertFromAuto(isAuto);
    // 自動時は toastId を持たず notify が丸ごと no-op になる。分岐を1箇所に閉じ込めて、
    // 以降は「トーストを出すか」を意識せずに結果ハンドリングだけを書く
    const toastId = isAuto ? null : toast.loading(INSTAGRAM_SYNCING_LABEL);
    const notify = (type: 'success' | 'warning' | 'error' | 'info', message: string) => {
      if (toastId === null) return;
      toast[type](message, { id: toastId });
    };
    try {
      const result = await syncInstagramData(
        'incremental',
        isAuto ? { trigger: 'auto' } : undefined
      );
      // サーバー側の1日1回ガードに弾かれた回。取得は走っていないので表示も通知も変えない。
      // toast.dismiss(undefined) は画面上の全トーストを消すため、id があるときだけ呼ぶ
      if (result.alreadySynced) {
        if (toastId !== null) {
          toast.dismiss(toastId);
        }
        return;
      }
      if (!result.success || !result.data) {
        const message = result.error ?? ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED;
        notify('error', message);
        if (result.needsReauth) {
          setSyncAlert(ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED);
        } else if (isAuto) {
          // 自動時はトーストが出ないので、失敗を握り潰さないよう Alert に落とす
          setSyncAlert(message);
        }
        return;
      }
      // needsReauth は success:false と必ずセットで返るため（instagramSync.actions.ts）、
      // ここに到達した時点では常に undefined。渡す必要はない。
      const toastMessage = getInstagramSyncToastMessage(result.data);
      notify(toastMessage.type, toastMessage.message);
      if (isAuto) {
        // 自動時は success 以外だけ Alert に出す。success（「N件を更新しました」等）は
        // 一覧そのものが結果なので黙って反映する
        if (toastMessage.type !== 'success') {
          setSyncAlert(toastMessage.message);
        }
      } else if (toastMessage.type === 'warning') {
        setSyncAlert(ERROR_MESSAGES.INSTAGRAM.API_ERROR);
      }
      if (result.data.failed > 0) {
        setSyncAlert(ERROR_MESSAGES.INSTAGRAM.PARTIAL_MEDIA_FAILURE(result.data.failed));
      }
      router.refresh();
    } catch (error) {
      console.error('[Instagram Tab] sync failed', error);
      notify('error', ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED);
      if (isAuto) {
        setSyncAlert(ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    setBackfillAlert(null);
    const toastId = toast.loading('過去の投稿をインポート中...');
    try {
      const result = await syncInstagramData('backfill');
      if (!result.success || !result.data) {
        if (result.needsReauth) {
          toast.error(result.error, { id: toastId });
          setBackfillAlert(ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED);
        } else {
          toast.error(result.error, { id: toastId });
        }
        return;
      }
      const toastMessage = getInstagramSyncToastMessage(result.data);
      switch (toastMessage.type) {
        case 'warning':
          toast.warning(toastMessage.message, { id: toastId });
          setBackfillAlert(ERROR_MESSAGES.INSTAGRAM.API_ERROR);
          break;
        case 'info':
          toast.info(toastMessage.message, { id: toastId });
          break;
        case 'error':
          toast.error(toastMessage.message, { id: toastId });
          break;
        case 'success':
          toast.success(toastMessage.message, { id: toastId });
          break;
      }
      if (result.data.failed > 0) {
        setBackfillAlert(ERROR_MESSAGES.INSTAGRAM.PARTIAL_MEDIA_FAILURE(result.data.failed));
      }
      router.refresh();
    } catch (error) {
      console.error('[Instagram Tab] backfill failed', error);
      toast.error(ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED, { id: toastId });
    } finally {
      setIsBackfilling(false);
    }
  };

  // タブ初回表示の自動同期。発火は「サーバー判定（今日まだ同期していない）」かつ
  // 「この端末で今日まだ自動発火していない」ときだけ。
  //
  // localStorage を使うのは useRef では足りないため。Radix の TabsContent は forceMount 無しだと
  // 非アクティブ時にアンマウントするので、blog ⇔ instagram を往復するたび ref が新品になる。
  // かつ last_synced_at は同期完了時にしか進まない（instagramSyncService）ので、in-flight 中も
  // 失敗後も autoSyncNeeded prop は true のまま。ガードが無いと開くたびに再実行になる。
  //
  // 天井: 別端末・別ブラウザ・localStorage クリア時は同日に再発火しうる（Server Action 側の
  // 1日1回チェックが最後の砦で、そこも in-flight の並走までは止めない）。実運用で重複が
  // 問題になったら instagram_credentials に last_sync_started_at 相当を足してロックする。
  //
  // 天井2: 自動発火した同期は app router の Server Action キューを占有するため、完了までの間は
  // 他の Server Action が待たされる（新着ゼロなら数秒、初回同期は最大760秒）。実害が出たら
  // /api/ga4/sync 型の Route Handler へ移すのが upgrade path。
  const didAutoSyncRef = React.useRef(false);
  React.useEffect(() => {
    if (didAutoSyncRef.current) return;
    didAutoSyncRef.current = true;

    if (!autoSyncNeeded || !syncEnabled) {
      setIsSyncing(false);
      return;
    }
    const todayJst = formatJstDateISO(new Date());
    if (localStorage.getItem(autoSyncStorageKey) === todayJst) {
      setIsSyncing(false);
      return;
    }
    // 発火前に記録する。同期中にアンマウント→再マウントしても二重に走らせない
    localStorage.setItem(autoSyncStorageKey, todayJst);
    void handleSync({ auto: true });
    // handleSync は毎レンダリング作り直されるが、このエフェクトは ref で1回に制限しており
    // 依存に入れても入れなくても発火回数は変わらない。意図しない再実行を避けるため入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncNeeded, syncEnabled]);

  const applyDateRange = () => {
    if (!isDateRangeChanged || isApplyingDateRange) return;
    startDateRangeTransition(() => {
      router.push(buildFilterHref({ igStart: rangeStart, igEnd: rangeEnd, igPage: 1 }));
    });
  };

  // iOS Safari の <input type="date"> は一度値が入るとユーザー操作で空にできない。
  // 「空にして［期間を適用］」だけを解除手段にすると、絞り込んだまま戻れない端末が出る。
  const clearDateRange = () => {
    if (isApplyingDateRange) return;
    startDateRangeTransition(() => {
      router.push(buildFilterHref({ igStart: '', igEnd: '', igPage: 1 }));
    });
  };

  // localStorageに並び順を保存するヘルパー。**ページ番号は保存しない**
  const saveInstagramSort = (sort: InstagramMediaSortKey, order: InstagramMediaSortOrder) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(ANALYTICS_STORAGE_KEYS.IG_SORT, sort);
      localStorage.setItem(ANALYTICS_STORAGE_KEYS.IG_SORT_ORDER, order);
    } catch {
      // ストレージが使えない環境でも並び替え自体は URL で動くので止めない
    }
  };

  // 列見出しを押したとき。同じ列なら向きを反転し、別の列なら降順（多い順・新しい順）から始める
  const handleSortChange = (sort: InstagramMediaSortKey) => {
    const order: InstagramMediaSortOrder =
      sort === igSort ? (igOrder === 'asc' ? 'desc' : 'asc') : DEFAULT_IG_SORT_ORDER;
    saveInstagramSort(sort, order);
    router.push(buildFilterHref({ igSort: sort, igOrder: order, igPage: 1 }));
  };

  // URL に ig_sort / ig_order が無いときだけ、保存済みの並び順を1回だけ復元する。
  // URL 指定時は deep link の意図を尊重して触らない。
  const didRestoreInstagramStateRef = React.useRef(false);
  // ブログ一覧と同じく、前回の絞り込みが戻ってきたことを一覧の上で示す（AnalyticsTable.tsx の
  // isRestoredFromStorage）。利用者が絞り込みを操作したら消す
  const [isHighOnlyRestored, setIsHighOnlyRestored] = React.useState(false);
  React.useEffect(() => {
    if (didRestoreInstagramStateRef.current) return;
    didRestoreInstagramStateRef.current = true;

    const { visibleIds } = normalizeFieldConfig(INSTAGRAM_COLUMNS, fieldConfig);
    const patch = resolveInstagramRestorePatch({
      urlSort: searchParams?.get('ig_sort') ?? null,
      urlOrder: searchParams?.get('ig_order') ?? null,
      urlHigh: searchParams?.get('ig_high') ?? null,
      storedSort: loadInstagramSortFromStorage(),
      storedOrder: loadInstagramSortOrderFromStorage(),
      storedHighOnly: loadInstagramHighOnlyFromStorage(),
      visibleIds,
      canJudgeTarget: followersCount !== null,
    });
    if (patch !== null) {
      if (patch.igHigh) {
        setIsHighOnlyRestored(true);
      }
      router.replace(buildFilterHref({ ...patch, igPage: 1 }));
    }
  }, [searchParams, fieldConfig, followersCount, buildFilterHref, router]);

  const target = getInstagramEngagementTarget(followersCount);
  const highOnlyActive = igHigh && target !== null;
  const criteriaLabel =
    target === null || followersCount === null
      ? null
      : formatInstagramEngagementTargetLabel(followersCount, target);

  const handleHighOnlyChange = (checked: boolean) => {
    setIsHighOnlyRestored(false);
    try {
      localStorage.setItem(ANALYTICS_STORAGE_KEYS.IG_HIGH_ONLY, checked ? '1' : '0');
    } catch {
      // ストレージが使えない環境でも URL の絞り込みは動かす
    }
    router.push(buildFilterHref({ igHigh: checked, igPage: 1 }));
  };

  // buildFilterHref は AnalyticsClient.tsx から毎レンダリング新規生成される関数のため
  // useCallback で包んでも参照は安定しない。FieldConfigurator 側が onChangeRef で
  // 参照不安定性を吸収する設計になっているため、ここは素の関数でよい。
  const resetSortIfHidden = () => {
    // **リセット結果も保存する。** 保存しないと、非表示の列を指す並び順が
    // localStorage に残り続け、次回マウントで復元 → 即リセットを繰り返す
    saveInstagramSort(DEFAULT_IG_SORT, DEFAULT_IG_SORT_ORDER);
    router.push(
      buildFilterHref({ igSort: DEFAULT_IG_SORT, igOrder: DEFAULT_IG_SORT_ORDER, igPage: 1 })
    );
  };

  // 一覧が0件のときの文言。押せないボタンへ誘導しないよう、キルスイッチ中と
  // backfill 完了済みを分けている（§11.3）。
  const emptyMessage = (() => {
    if (isSyncing || isBackfilling) {
      return INSTAGRAM_SYNCING_LABEL;
    }
    if (!syncEnabled) {
      return 'Instagramの同期を一時停止しているため、データを取得できません。';
    }
    // 未同期のときだけ「データ」と呼ぶ。投稿が無いのか取得していないのか区別が付かないため。
    // 同期済みの分岐は「投稿」で統一する
    if (lastSyncedAt == null) {
      return 'まだデータがありません。「最新化」を押してください';
    }
    // 絞り込んでいないのに「条件を変更してください」と言わない。
    // ig_sort / ig_order / ig_page は行を減らさないので絞り込みに数えない
    const hasFilter = igStart !== null || igEnd !== null || igType !== 'all' || highOnlyActive;
    if (!hasFilter) {
      return backfillStatus === 'completed'
        ? 'まだ投稿がありません'
        : 'まだ投稿がありません。「過去の投稿をインポート」を押してください';
    }
    return backfillStatus === 'completed'
      ? '表示条件に一致する投稿がありません。投稿日や種別を変更してください'
      : '表示条件に一致する投稿がありません。投稿日や種別を変更するか、「過去の投稿をインポート」を押してください';
  })();

  const prevHref = buildIgPageHref(Math.max(1, igPage - 1));
  const nextHref = buildIgPageHref(Math.min(totalPages, igPage + 1));
  const prevDisabled = igPage <= 1;
  const nextDisabled = igPage >= totalPages;
  const startItemNumber = total > 0 ? (igPage - 1) * 10 + 1 : 0;
  const endItemNumber = total > 0 ? Math.min(igPage * 10, total) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>投稿一覧</CardTitle>
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-9 inline-flex items-center gap-2 px-3 border-primary text-primary hover:bg-primary/10'
            )}
            id="instagram-field-config-trigger"
          >
            <Settings className="w-4 h-4" aria-hidden />
            フィールド構成
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg p-4 bg-gray-50/50 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">種別</span>
              <Select
                value={igType}
                onValueChange={value =>
                  router.push(
                    buildFilterHref({ igType: value as InstagramMediaTypeFilter, igPage: 1 })
                  )
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="reels">リール</SelectItem>
                  <SelectItem value="feed">フィード</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/*
              ラベルに「投稿日」を冠する。ブログタブの「GA4集計開始日/終了日」は集計窓で記事は
              消えないが、こちらは posted_at の行フィルタで投稿が消える。同じ「開始日/終了日」だと
              役割の違いが読み取れない。語は並び順・テーブル見出しの「投稿日」を再利用する。
              未指定＝全期間なので、空欄がその状態であることを補足で明示する。
            */}
            <div className="flex flex-col gap-1">
              <label htmlFor="ig-range-start" className="text-xs text-muted-foreground">
                投稿日（開始）
              </label>
              <Input
                id="ig-range-start"
                type="date"
                max={rangeEnd || undefined}
                value={rangeStart}
                onChange={e => setRangeStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ig-range-end" className="text-xs text-muted-foreground">
                投稿日（終了）
              </label>
              <Input
                id="ig-range-end"
                type="date"
                min={rangeStart || undefined}
                value={rangeEnd}
                onChange={e => setRangeEnd(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {hasDateRange ? '投稿日で絞り込み中' : '未指定なら全期間'}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={applyDateRange}
                  disabled={!isDateRangeChanged || isApplyingDateRange}
                  title={isDateRangeChanged ? undefined : '投稿日を変更すると押せます'}
                >
                  {isApplyingDateRange && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {isApplyingDateRange ? '適用中...' : '期間を適用'}
                </Button>
                {hasDateRange ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearDateRange}
                    disabled={isApplyingDateRange}
                  >
                    期間をクリア
                  </Button>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!syncEnabled || isSyncing || isBackfilling}
              onClick={() => void handleSync()}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isSyncing && 'animate-spin')} />
              最新化
            </Button>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                disabled={
                  !syncEnabled || isSyncing || isBackfilling || backfillStatus === 'completed'
                }
                onClick={handleBackfill}
              >
                <History className={cn('w-4 h-4 mr-2', isBackfilling && 'animate-spin')} />
                {backfillStatus === 'completed' ? '過去の投稿をインポート（完了）' : '過去の投稿をインポート'}
              </Button>
              {backfillStatus === 'in_progress' ? (
                <span className="text-xs text-gray-500">前回の続きがあります</span>
              ) : null}
            </div>
            {lastSyncedLabel ? (
              <p className="text-xs text-gray-500 ml-auto">最終同期: {lastSyncedLabel}</p>
            ) : null}
          </div>
        </div>

        {/*
          目標値はフィールド構成ダイアログ内の「絞り込まれる条件」に出すため、一覧の上には重ねて出さない。
          ここに出すのは、フォロワー数未取得の案内と、ブログ一覧と同じ形のフィルター表示だけ
        */}
        {target === null ? (
          <p className="text-sm text-muted-foreground mb-4">
            ［最新化］するとフォロワー数を取得し、目標エンゲージメント率を表示します
          </p>
        ) : highOnlyActive ? (
          // ブログ一覧と同じ部品を使う（src/components/AnalyticsTable.tsx）
          <ActiveFilterBar
            onClear={() => handleHighOnlyChange(false)}
            isRestored={isHighOnlyRestored}
          >
            <FilterTag
              label="高エンゲージメント率"
              tone="blue"
              onRemove={() => handleHighOnlyChange(false)}
              removeTitle="高エンゲージメント率フィルターを解除"
            />
          </ActiveFilterBar>
        ) : null}

        {!syncEnabled ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 mb-4">
            Instagramの同期を一時停止しています
          </div>
        ) : null}

        {/*
          進行表示はテーブルの空状態だけに頼れない。2日目以降は既存データが並ぶので
          items.length > 0 になり、自動同期中でも「最新化」が disabled なこと以外に手掛かりが
          無くなる（ユーザーが押していない処理なので、なおさら説明が要る）。
          初回（last_synced_at が null）は最大760秒かかりうるため、長くなることも書く。
        */}
        {isSyncing ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground mb-4"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>
              {INSTAGRAM_SYNCING_LABEL}
              {lastSyncedAt == null ? '（初回は数分かかることがあります）' : ''}
            </span>
          </div>
        ) : null}

        {syncAlert ? (
          <div
            role="alert"
            className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 mb-4"
          >
            {syncAlert}
            {syncAlert === ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED ? (
              <Link href="/setup/instagram" className="ml-2 underline font-medium">
                連携設定へ
              </Link>
            ) : null}
          </div>
        ) : null}

        {backfillAlert ? (
          <div
            role="alert"
            className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 mb-4"
          >
            {backfillAlert}
            {backfillAlert === ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED ? (
              <Link href="/setup/instagram" className="ml-2 underline font-medium">
                連携設定へ
              </Link>
            ) : null}
          </div>
        ) : null}

        <InstagramMediaTable
          items={items}
          igSort={igSort}
          igOrder={igOrder}
          onSortChange={handleSortChange}
          fieldConfig={fieldConfig}
          onSortColumnHidden={resetSortIfHidden}
          emptyMessage={emptyMessage}
          igHigh={highOnlyActive}
          onHighOnlyChange={handleHighOnlyChange}
          criteriaLabel={criteriaLabel}
          targetMinRate={target?.min ?? null}
        />
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-600">
            {total > 0
              ? `全${total}件中 ${startItemNumber}-${endItemNumber}件を表示（${igPage}/${totalPages}ページ）`
              : ''}
          </div>
          <div className="flex gap-2">
            <Link
              href={prevHref}
              prefetch={false}
              aria-disabled={prevDisabled}
              tabIndex={prevDisabled ? -1 : undefined}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'px-3',
                prevDisabled && 'pointer-events-none opacity-50'
              )}
            >
              前へ
            </Link>
            <Link
              href={nextHref}
              prefetch={false}
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : undefined}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'px-3',
                nextDisabled && 'pointer-events-none opacity-50'
              )}
            >
              次へ
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
