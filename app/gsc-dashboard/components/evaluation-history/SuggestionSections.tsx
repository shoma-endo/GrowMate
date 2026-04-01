'use client';

import { MessageSquare } from 'lucide-react';
import { MODEL_CONFIGS } from '@/lib/constants';
import { SuggestionMarkdown } from './SuggestionMarkdown';
import { parseSuggestionSections } from './evaluation-history-view';

const SUGGESTION_STYLE = {
  badgeClass: 'bg-blue-100 text-blue-800',
  sectionClass: 'bg-white border-gray-200',
};

interface SuggestionSectionsProps {
  summary: string;
}

export function SuggestionSections({ summary }: SuggestionSectionsProps) {
  const sections = parseSuggestionSections(summary);
  const validSections = sections.filter(section => MODEL_CONFIGS[section.templateName]);

  if (validSections.length === 0) {
    return <p className="text-sm text-gray-500 italic">提案なし</p>;
  }

  return (
    <div className="space-y-4">
      {validSections.map((section, index) => {
        const config = MODEL_CONFIGS[section.templateName];

        return (
          <div key={`${section.templateName}-${index}`} className={`p-4 rounded-lg border ${SUGGESTION_STYLE.sectionClass}`}>
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              <span
                className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold ${SUGGESTION_STYLE.badgeClass}`}
              >
                {section.label}
              </span>
            </div>
            <SuggestionMarkdown content={section.content} />
          </div>
        );
      })}
    </div>
  );
}
