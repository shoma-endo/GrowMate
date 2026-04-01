'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MARKDOWN_PROSE_CLASS =
  'prose prose-slate max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-h1:text-lg prose-h1:normal-case prose-h2:text-base prose-h2:mt-4 prose-h2:mb-3 prose-p:text-slate-700 prose-p:leading-relaxed prose-ul:my-2 prose-li:my-1 prose-blockquote:border-l-4 prose-blockquote:border-slate-300 prose-blockquote:pl-4 prose-blockquote:text-slate-600 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-slate-800 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-table:my-4 prose-table:w-full prose-table:border-collapse prose-thead:border-b prose-thead:border-slate-300 prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2';

interface SuggestionMarkdownProps {
  content: string;
}

export function SuggestionMarkdown({ content }: SuggestionMarkdownProps) {
  return (
    <div className={MARKDOWN_PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
