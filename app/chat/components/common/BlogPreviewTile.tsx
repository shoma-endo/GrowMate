'use client';

import React from 'react';
import { PenSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BlogPreviewTileProps {
  stepLabel: string;
  headingLabel?: string | null;
  title?: string | null;
  excerpt?: string | null;
  onOpen?: () => void;
  className?: string;
  /** 完成形タイル用: 緑色で強調表示 */
  variant?: 'default' | 'completed';
}

const BlogPreviewTile: React.FC<BlogPreviewTileProps> = ({
  stepLabel,
  headingLabel,
  title,
  excerpt,
  onOpen,
  className,
  variant = 'default',
}) => {
  const isCompletedBadge = variant === 'completed';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
        className
      )}
      aria-label={`${stepLabel}${title ? `: ${title}` : ''}をCanvasで開く`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {stepLabel}
            </span>
            {headingLabel && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  isCompletedBadge
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-blue-50 border-blue-200 text-blue-700'
                )}
              >
                {headingLabel}
              </span>
            )}
          </div>
          {title && (
            <p className="mt-2 line-clamp-1 text-sm font-semibold text-slate-900">{title}</p>
          )}
          {excerpt && (
            <p className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-3">{excerpt}</p>
          )}
        </div>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors duration-200 group-hover:bg-slate-800">
          <PenSquare size={18} />
        </div>
      </div>
    </button>
  );
};

export default BlogPreviewTile;
