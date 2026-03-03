'use client';

import React from 'react';
import { ANALYTICS_COLUMNS } from '@/lib/constants';
import { ANNOTATION_FIELD_KEYS, AnnotationFieldKey } from '@/types/annotation';
import { cn } from '@/lib/utils';

const COLUMN_LABELS = ANNOTATION_FIELD_KEYS.reduce<Record<AnnotationFieldKey, string>>(
  (acc, key) => {
    acc[key] = ANALYTICS_COLUMNS.find(column => column.id === key)?.label ?? '';
    return acc;
  },
  {} as Record<AnnotationFieldKey, string>
);

const PLACEHOLDERS: Record<AnnotationFieldKey, string> = {
  main_kw: '主軸となるキーワードを入力',
  kw: '参考キーワードを入力',
  impressions: '表示回数や検索ボリュームの情報',
  needs: 'ユーザーのニーズや課題',
  persona: 'デモグラフィック情報やペルソナ',
  goal: '達成したいゴールや目標',
  prep: 'PREP法の要点や伝えたい流れ',
  basic_structure:
    '導入や見出し構成。本文作成（Step7）では ### 中見出し / #### 小見出し 形式で抽出されます',
  opening_proposal: '書き出しの方向性や冒頭で伝えたい内容',
};

const TEXTAREA_ROWS: Record<AnnotationFieldKey, number> = {
  main_kw: 2,
  kw: 2,
  impressions: 2,
  needs: 3,
  persona: 3,
  goal: 3,
  prep: 3,
  basic_structure: 3,
  opening_proposal: 3,
};

interface Props {
  form: Record<AnnotationFieldKey, string>;
  onFormChange: (field: AnnotationFieldKey, value: string) => void;
  canonicalUrl: string;
  onCanonicalUrlChange: (value: string) => void;
  canonicalUrlError?: string;
  className?: string;
  canonicalUrlInputId?: string;
  wpPostTitle?: string;
  extraFields?: Array<{
    key: string;
    label: string;
    type?: 'text' | 'number' | 'textarea';
    rows?: number;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
  }>;
}

export default function AnnotationFormFields({
  form,
  onFormChange,
  canonicalUrl,
  onCanonicalUrlChange,
  canonicalUrlError,
  className,
  canonicalUrlInputId = 'wp-canonical-url',
  wpPostTitle,
  extraFields,
}: Props) {
  return (
    <div className={cn('space-y-5 px-[5px]', className)}>
      {ANNOTATION_FIELD_KEYS.map(key => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {COLUMN_LABELS[key]}
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
            rows={TEXTAREA_ROWS[key]}
            value={form[key]}
            onChange={e => onFormChange(key, e.target.value)}
            placeholder={PLACEHOLDERS[key]}
          />
          {key === 'basic_structure' && (
            <p className="mt-1.5 text-xs text-gray-500">
              本文作成（Step7）では <code className="px-1 py-0.5 bg-gray-100 rounded font-mono">###</code> 中見出し / <code className="px-1 py-0.5 bg-gray-100 rounded font-mono">####</code> 小見出し 形式で見出しを抽出します。
            </p>
          )}
        </div>
      ))}

      {extraFields?.map(field => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-2">{field.label}</label>
          {field.type === 'number' ? (
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
              placeholder={field.placeholder}
            />
          ) : field.type === 'textarea' || field.type === undefined ? (
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
              rows={field.rows ?? 3}
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
              placeholder={field.placeholder}
            />
          ) : (
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
              placeholder={field.placeholder}
            />
          )}
        </div>
      ))}

      <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
        <h4 className="text-md font-semibold text-gray-800">WordPress連携</h4>
        <p className="text-sm text-gray-600">
          WordPressで公開されている記事URLを入力してください。カスタムパーマリンクにも対応し、
          URLから投稿IDを自動取得して連携します。空欄の場合は連携を解除します。
        </p>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor={canonicalUrlInputId}>
            WordPress投稿URL（任意）
          </label>
          <input
            id={canonicalUrlInputId}
            type="text"
            className="w-full border border-gray-300 rounded-lg p-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white focus:border-blue-500"
            value={canonicalUrl}
            onChange={e => onCanonicalUrlChange(e.target.value)}
            placeholder="例: https://example.com/article-title/"
          />
          {canonicalUrlError && <p className="text-sm text-red-600">{canonicalUrlError}</p>}
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium text-gray-700">取得された記事タイトル</span>
          <p className="text-sm text-gray-800">
            {wpPostTitle && wpPostTitle.trim().length > 0 ? (
              wpPostTitle
            ) : (
              <span className="text-gray-500">タイトルはまだ取得されていません</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
