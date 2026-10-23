'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryCheckboxRow } from '@/components/CategoryFilter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getWordPressPublishCategories, getWordPressPublishDefaults, publishToWordPress } from '@/server/actions/wordpressPublish.actions';

export interface WordPressPublishDialogHandle {
  openFor: (target: { annotationId?: string; sessionId?: string }) => void;
}

interface WordPressPublishDialogProps {
  onComplete?: () => void;
  showOpenChat?: boolean;
}

export const WordPressPublishDialog = forwardRef<WordPressPublishDialogHandle, WordPressPublishDialogProps>(function WordPressPublishDialog({ onComplete, showOpenChat = false }, ref) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<{ annotationId?: string; sessionId?: string }>({});
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<'posts' | 'pages'>('posts');
  const [status, setStatus] = useState<'draft' | 'publish' | 'future'>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduledAtIsPast, setScheduledAtIsPast] = useState(false);
  const [slug, setSlug] = useState('');
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [categoriesError, setCategoriesError] = useState('');
  const [categoriesTruncated, setCategoriesTruncated] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [recovery, setRecovery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [lockedType, setLockedType] = useState(false);
  const [wpPostId, setWpPostId] = useState<number | null>(null);
  const [headingCount, setHeadingCount] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);

  const handleOpenFor = (nextTarget: { annotationId?: string; sessionId?: string }) => {
    setTarget(nextTarget);
    setOpen(true);
    setTitle('');
    setContentType('posts');
    setStatus('draft');
    setScheduledAt('');
    setScheduledAtIsPast(false);
    setSlug('');
    setCategories([]);
    setCategoryIds([]);
    setCategoriesError('');
    setCategoriesTruncated(false);
    setWpPostId(null);
    setLockedType(false);
    setHeadingCount(0);
    setCharacterCount(0);
    setError('');
    setInfo('');
    setRecovery('');
    setLoadingDefaults(true);
    void getWordPressPublishDefaults(nextTarget).then(result => {
      setLoadingDefaults(false);
      if (!result.success) {
        setError(result.error);
        setRecovery('recovery' in result ? result.recovery : '');
        return;
      }
      setTitle(result.data.title);
      setContentType(result.data.contentType);
      setStatus(result.data.status);
      setLockedType(Boolean(result.data.annotationId && result.data.wpPostId));
      setWpPostId(result.data.wpPostId);
      setHeadingCount(result.data.headingCount);
      setCharacterCount(result.data.characterCount);
      setCategoryIds(result.data.categoryIds);
      const localScheduledAt = result.data.scheduledAt ? toLocalDateTime(result.data.scheduledAt) : '';
      setScheduledAt(localScheduledAt);
      setScheduledAtIsPast(Boolean(localScheduledAt) && new Date(localScheduledAt).getTime() <= Date.now());
      if (result.data.contentType === 'posts') void loadCategories();
    });
  };

  useImperativeHandle(ref, () => ({ openFor: handleOpenFor }));

  const loadCategories = async () => {
    const result = await getWordPressPublishCategories();
    if (result.success) {
      setCategories(result.data.categories);
      setCategoriesTruncated(result.data.truncated);
      setCategoriesError('');
    } else {
      setCategories([]);
      setCategoriesTruncated(false);
      setCategoryIds([]);
      setCategoriesError(result.error);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError('');
    setRecovery('');
    const result = await publishToWordPress({ ...target, title, contentType, status, ...(status === 'future' ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}), categoryIds, slug });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      setRecovery(result.recovery);
      if (result.recovery === 'resend') {
        setLockedType(false);
        setWpPostId(null);
        onComplete?.();
      }
      return;
    }
    if (result.data.outcome === 'already_published') {
      setInfo(ERROR_MESSAGES.WORDPRESS.PUBLISH_ALREADY_PUBLISHED);
      setError('');
      onComplete?.();
      return;
    }
    const scheduledLabel = scheduledAt ? `${Number(scheduledAt.slice(5, 7))}/${Number(scheduledAt.slice(8, 10))} ${scheduledAt.slice(11, 16)}` : '';
    toast.success(result.data.status === 'draft' ? 'WordPress に下書きを送信しました' : result.data.status === 'publish' ? 'WordPress で公開しました' : `WordPress に予約しました（${scheduledLabel}）`);
    onComplete?.();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>WordPress に投稿</DialogTitle>
          <DialogDescription>完成した記事を WordPress に送信します。</DialogDescription>
        </DialogHeader>
        {(error || info) && <Alert variant={info ? 'default' : 'destructive'}><AlertCircle className="h-4 w-4" /><AlertDescription>{info || error}{recovery === 'setup' || recovery === 'relink' ? <Link className="ml-2 underline" href="/setup/wordpress">{recovery === 'setup' ? '連携を開始' : '再連携する'}</Link> : null}{showOpenChat && recovery === 'open_chat' && target.sessionId ? <Link className="ml-2 underline" href={`/chat?session=${target.sessionId}&initialStep=step7`}>チャットを開く</Link> : null}</AlertDescription></Alert>}
        <div className="space-y-4">
          <div className="grid gap-2"><Label htmlFor="wp-publish-content-type">送信先</Label><Select value={contentType} onValueChange={value => { const nextType = value as 'posts' | 'pages'; setContentType(nextType); if (nextType === 'posts') void loadCategories(); }} disabled={loading || lockedType}><SelectTrigger id="wp-publish-content-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="posts">投稿</SelectItem><SelectItem value="pages">固定ページ</SelectItem></SelectContent></Select></div>
          {loadingDefaults ? <p className="text-sm text-muted-foreground">読み込み中...</p> : <>
          <p className="text-sm text-muted-foreground">送る本文: 見出し {headingCount} 本・約 {characterCount.toLocaleString('ja-JP')} 文字（Canvas の最新の完成形）</p>
          <div className="grid gap-2"><Label htmlFor="wp-publish-title">タイトル</Label><Input id="wp-publish-title" value={title} onChange={event => setTitle(event.target.value)} disabled={loading} maxLength={200} /></div>
          <div className="grid gap-2"><Label htmlFor="wp-publish-status">公開状態</Label><Select value={status} onValueChange={value => setStatus(value as 'draft' | 'publish' | 'future')} disabled={loading}><SelectTrigger id="wp-publish-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">下書き</SelectItem><SelectItem value="publish">公開</SelectItem><SelectItem value="future">予約投稿</SelectItem></SelectContent></Select></div>
          {status === 'future' && <div className="grid gap-2"><Label htmlFor="wp-scheduled-at">公開日時</Label><Input id="wp-scheduled-at" type="datetime-local" value={scheduledAt} disabled={loading} onChange={event => { setScheduledAt(event.target.value); setScheduledAtIsPast(Boolean(event.target.value) && new Date(event.target.value).getTime() <= Date.now()); }} />{scheduledAtIsPast && <p className="text-sm text-destructive">{ERROR_MESSAGES.WORDPRESS.PUBLISH_SCHEDULE_MUST_BE_FUTURE}</p>}</div>}
          {contentType === 'posts' && <fieldset className="grid gap-2"><legend className="text-sm font-medium">カテゴリ</legend>{categoriesError ? <p className="text-sm text-muted-foreground">{categoriesError}</p> : <>{categoriesTruncated && <p className="text-sm text-muted-foreground">先頭 500 件を表示しています</p>}{categories.map(category => <CategoryCheckboxRow key={category.id} label={category.name} checked={categoryIds.includes(category.id)} disabled={loading} onCheckedChange={checked => setCategoryIds(current => checked ? [...current, category.id] : current.filter(id => id !== category.id))} />)}</>}</fieldset>}
          <div className="grid gap-2"><Label htmlFor="wp-publish-slug">スラッグ</Label><Input id="wp-publish-slug" value={slug} disabled={loading} onChange={event => setSlug(event.target.value)} maxLength={200} /></div>
          </>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>キャンセル</Button>
          {!info && recovery !== 'close' && recovery !== 'open_chat' && recovery !== 'setup' && recovery !== 'relink' && <Button type="button" disabled={loading || loadingDefaults || !title.trim() || (status === 'future' && (!scheduledAt || scheduledAtIsPast))} onClick={() => void submit()}>{loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />送信中...</> : recovery === 'retry' ? '再試行' : `${status === 'draft' ? '下書きとして送信' : status === 'publish' ? '公開する' : '予約する'}${wpPostId ? '（更新）' : ''}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

function toLocalDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}
