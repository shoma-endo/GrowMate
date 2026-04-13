'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, Loader2, Edit } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import { updateContentAnnotationFields } from '@/server/actions/wordpress.actions';

interface SuggestionDataReadinessProps {
  annotation: {
    id: string;
    wp_post_id: number | null;
    wp_post_title: string | null;
    wp_excerpt?: string | null;
    opening_proposal: string | null;
    wp_content_text: string | null;
    persona: string | null;
    needs: string | null;
    canonical_url: string | null;
  };
  onUpdate?: (annotationId: string) => Promise<void> | void;
}

interface DataRequirement {
  stage: number;
  label: string;
  fields: Array<{
    name: string;
    displayName: string;
    value: string | null;
  }>;
  requiresAll: boolean; // true: 全て必要, false: いずれか1つ
}

export function SuggestionDataReadiness({ annotation, onUpdate }: SuggestionDataReadinessProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formData, setFormData] = useState({
    canonical_url: annotation.canonical_url ?? '',
    opening_proposal: annotation.opening_proposal ?? '',
    persona: annotation.persona ?? '',
    needs: annotation.needs ?? '',
  });
  const [canonicalUrlError, setCanonicalUrlError] = useState('');
  const [formError, setFormError] = useState('');

  // Dialog を開く時に最新値を反映
  const handleOpenDialog = () => {
    setFormData({
      canonical_url: annotation.canonical_url ?? '',
      opening_proposal: annotation.opening_proposal ?? '',
      persona: annotation.persona ?? '',
      needs: annotation.needs ?? '',
    });
    setCanonicalUrlError('');
    setFormError('');
    setIsDialogOpen(true);
  };

  // wp_post_id があれば、ステージ1と3はWordPressから動的取得可能
  const hasWpPostId = annotation.wp_post_id !== null && annotation.wp_post_id !== undefined;

  // 各ステージのデータ要件
  const requirements: DataRequirement[] = [
    // ステージ1: wp_post_id がない場合は、WordPress投稿URLの登録が必要
    ...(hasWpPostId
      ? []
      : [
          {
            stage: 1,
            label: 'WordPress連携',
            fields: [
              {
                name: 'canonical_url',
                displayName: 'WordPress投稿URL',
                value: annotation.canonical_url,
              },
            ],
            requiresAll: true,
          },
        ]),
    {
      stage: 2,
      label: '書き出し案',
      fields: [
        { name: 'opening_proposal', displayName: '書き出し案', value: annotation.opening_proposal },
      ],
      requiresAll: true,
    },
    {
      stage: 4,
      label: 'デモグラ・ペルソナ / ニーズ',
      fields: [
        { name: 'persona', displayName: 'デモグラ・ペルソナ', value: annotation.persona },
        { name: 'needs', displayName: 'ニーズ', value: annotation.needs },
      ],
      requiresAll: false, // どちらか1つでもあればOK
    },
  ];

  // 各ステージの充足状況を判定
  const checkStageReadiness = (requirement: DataRequirement): boolean => {
    if (requirement.requiresAll) {
      return requirement.fields.every(field => field.value && field.value.trim().length > 0);
    } else {
      return requirement.fields.some(field => field.value && field.value.trim().length > 0);
    }
  };

  const missingRequirements = requirements.filter(req => !checkStageReadiness(req));

  const handleSave = () => {
    if (!annotation.id || typeof annotation.id !== 'string' || annotation.id.trim().length === 0) {
      setFormError('アノテーションIDが無効です');
      return;
    }

    startTransition(async () => {
      setFormError('');

      const toastId = toast.loading('データを保存中...');

      try {
        const result = await updateContentAnnotationFields(annotation.id, {
          ...(hasWpPostId ? {} : { canonical_url: formData.canonical_url || null }),
          opening_proposal: formData.opening_proposal || null,
          persona: formData.persona || null,
          needs: formData.needs || null,
        });

        if (isEmailLinkConflictResult(result)) {
          toast.dismiss(toastId);
          replaceToEmailLinkConflictLogin();
          return;
        }
        if (result.success) {
          toast.success('データを保存しました', { id: toastId });
          setIsDialogOpen(false);
          if (onUpdate && annotation.id) {
            await onUpdate(annotation.id);
          }
        } else {
          const errorMessage = result.error || '保存に失敗しました';
          toast.error(errorMessage, { id: toastId });
          setFormError(errorMessage);
          // WordPress URL関連のエラーの場合は、エラーメッセージを表示
          if (errorMessage.includes('URL') || errorMessage.includes('WordPress')) {
            setCanonicalUrlError(errorMessage);
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'エラーが発生しました';
        toast.error(errorMessage, { id: toastId });
        setFormError(errorMessage);
      }
    });
  };

  // 全てのデータが揃っている場合は何も表示しない
  if (missingRequirements.length === 0) {
    return null;
  }

  return (
    <>
      <Alert className="bg-amber-50 border-amber-200">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-2.5">
            <AlertTitle className="text-amber-900 font-semibold text-base">
              改善提案に必要なデータが不足しています
            </AlertTitle>
            <AlertDescription className="text-amber-800 space-y-2.5">
              <p className="text-sm">
                以下のデータが未登録のため、該当の改善提案がスキップされます。評価を実行する前にデータを登録してください。
              </p>
              <ul className="space-y-1.5 list-none">
                {missingRequirements.map(req => (
                  <li key={req.stage} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-600 mt-0.5 flex-shrink-0">•</span>
                    <span className="font-medium">{req.label}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2">
                <Button
                  variant="default"
                  size="default"
                  onClick={handleOpenDialog}
                  className="gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                >
                  <Edit className="h-4 w-4" />
                  登録する
                </Button>
              </div>
            </AlertDescription>
          </div>
        </div>
      </Alert>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>改善提案データの編集</DialogTitle>
            <DialogDescription>
              不足しているデータを入力してください。既に登録されている項目も編集できます。
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <AlertTitle className="text-sm font-semibold">保存に失敗しました</AlertTitle>
                  <AlertDescription className="text-sm">{formError}</AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          <div className="space-y-5 py-4">
            {/* WordPress投稿URL（wp_post_idがない場合のみ） */}
            {!hasWpPostId && (
              <div className="pb-4 border-b border-gray-200">
                <h4 className="text-md font-semibold text-gray-800 mb-2">WordPress連携</h4>
                <p className="text-sm text-gray-600 mb-3">
                  WordPressで公開されている記事URLを入力してください。カスタムパーマリンクにも対応し、
                  URLから投稿IDを自動取得して連携します。空欄の場合は連携を解除します。
                </p>
                <div className="space-y-1">
                  <label
                    className="block text-sm font-medium text-gray-700"
                    htmlFor="wp-canonical-url"
                  >
                    WordPress投稿URL（任意）
                  </label>
                  <Input
                    id="wp-canonical-url"
                    type="text"
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
                    value={formData.canonical_url}
                    onChange={e => {
                      setFormData(prev => ({ ...prev, canonical_url: e.target.value }));
                      if (canonicalUrlError) {
                        setCanonicalUrlError('');
                      }
                    }}
                    placeholder="例: https://example.com/article-title/"
                  />
                  {canonicalUrlError && <p className="text-sm text-red-600">{canonicalUrlError}</p>}
                </div>
              </div>
            )}

            {/* 書き出し案 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">書き出し案</label>
              <Textarea
                className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
                rows={3}
                value={formData.opening_proposal}
                onChange={e => setFormData(prev => ({ ...prev, opening_proposal: e.target.value }))}
                placeholder="書き出しの方向性や冒頭で伝えたい内容"
              />
            </div>

            {/* デモグラ・ペルソナ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                デモグラ・ペルソナ
              </label>
              <Textarea
                className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
                rows={3}
                value={formData.persona}
                onChange={e => setFormData(prev => ({ ...prev, persona: e.target.value }))}
                placeholder="デモグラフィック情報やペルソナ"
              />
            </div>

            {/* ニーズ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ニーズ</label>
              <Textarea
                className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
                rows={3}
                value={formData.needs}
                onChange={e => setFormData(prev => ({ ...prev, needs: e.target.value }))}
                placeholder="ユーザーのニーズや課題"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsDialogOpen(false)}
              disabled={isPending}
            >
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  保存中...
                </>
              ) : (
                '保存'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
