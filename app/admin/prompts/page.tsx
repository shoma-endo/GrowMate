'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ErrorAlert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PromptTemplate } from '@/types/prompt';
import {
  getPromptDescription,
  getVariableDescription,
  IMPLICIT_BLOG_CONTENT_VARS,
  IMPLICIT_BLOG_TITLE_META_VARS,
  IMPLICIT_GSC_CTR_BOOST_VARS,
} from '@/lib/prompt-descriptions';
import { Save, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPrompts, savePrompt } from '@/server/actions/adminPrompts.actions';

type PromptCategory = 'chat' | 'gsc';

const HIDDEN_VARIABLES: Record<string, string[]> = {
  blog_title_meta_generation: ['contentCanonicalUrl'],
};

function buildDisplayVariables(template: PromptTemplate) {
  const hidden = HIDDEN_VARIABLES[template.name] ?? [];
  const base = (template.variables || []).filter(
    v => v.name !== 'canonicalUrls' && v.name !== 'wpPostTitle' && !hidden.includes(v.name)
  );

  const mapVars = (vars: readonly string[]) =>
    vars.map(name => ({ name, description: getVariableDescription(name) }));

  const getExtras = () => {
    if (template.name.startsWith('blog_creation_')) {
      return [
        ...mapVars(IMPLICIT_BLOG_CONTENT_VARS),
        ...mapVars(['canonicalLinkPairs']),
      ];
    }

    if (template.name === 'blog_title_meta_generation') {
      return mapVars(IMPLICIT_BLOG_TITLE_META_VARS);
    }

    if (template.name === 'gsc_insight_ctr_boost') {
      return mapVars(IMPLICIT_GSC_CTR_BOOST_VARS);
    }

    return [];
  };

  const extras = getExtras();

  const seen = new Set<string>();
  return [...base, ...extras].filter(v => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
}


const PROMPT_CATEGORIES: Array<{
  id: PromptCategory;
  label: string;
  filter: (template: PromptTemplate) => boolean;
}> = [
  {
    id: 'chat',
    label: 'AIチャット・生成',
    filter: template => !template.name.startsWith('gsc_'),
  },
  {
    id: 'gsc',
    label: 'GSC改善提案',
    filter: template => template.name.startsWith('gsc_'),
  },
];

export default function PromptsPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [activeCategory, setActiveCategory] = useState<PromptCategory>('chat');
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      const res = await fetchPrompts();
      if (res?.success && res?.data) {
        setTemplates(res.data as PromptTemplate[]);
        setError(null);
      } else {
        setError(res?.error || 'プロンプトの取得に失敗しました');
      }
    } catch (error) {
      console.error('プロンプト取得エラー:', error);
      setError('プロンプトの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(template);
      setEditedContent(template.content);
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;

    try {
      setIsSaving(true);
      const result = await savePrompt({
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        display_name: selectedTemplate.display_name,
        content: editedContent,
        variables: selectedTemplate.variables,
      });

      if (result?.success) {
        await loadTemplates();
        const updatedTemplate = { ...selectedTemplate, content: editedContent };
        setSelectedTemplate(updatedTemplate);
        setError(null);
        toast.success('プロンプトを保存しました');
      } else {
        const message = result?.error || '保存に失敗しました';
        setError(message);
        toast.error('保存に失敗しました', {
          description: message,
        });
      }
    } catch (error) {
      console.error('保存エラー:', error);
      const message = '保存中にエラーが発生しました';
      setError(message);
      toast.error('保存に失敗しました', {
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (selectedTemplate) {
      setEditedContent(selectedTemplate.content);
    }
  };

  useEffect(() => { loadTemplates(); }, []);

  const categoryCounts = PROMPT_CATEGORIES.reduce<Record<PromptCategory, number>>(
    (acc, category) => {
      acc[category.id] = templates.filter(category.filter).length;
      return acc;
    },
    {} as Record<PromptCategory, number>
  );

  const filteredTemplates = (() => {
    const category = PROMPT_CATEGORIES.find(c => c.id === activeCategory);
    if (!category) return templates;
    return templates.filter(category.filter);
  })();

  useEffect(() => {
    if (selectedTemplate && !filteredTemplates.some(t => t.id === selectedTemplate.id)) {
      setSelectedTemplate(null);
      setEditedContent('');
    }
  }, [activeCategory, filteredTemplates, selectedTemplate]);

  // Early return pattern
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">プロンプト管理</h1>
        <Card>
          <CardContent className="py-12">
            <div className="mx-auto max-w-md space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold mb-2">エラーが発生しました</h2>
              </div>
              <ErrorAlert error={error} />
              <div className="text-center">
                <Button onClick={loadTemplates} size="sm" variant="outline" aria-label="再試行">
                  <RotateCw className="h-4 w-4" />
                  再試行
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const promptDescription = selectedTemplate ? getPromptDescription(selectedTemplate.name) : null;
  const variablesInfoText = (() => {
    if (!selectedTemplate) return null;
    const vars = buildDisplayVariables(selectedTemplate);
    const names = new Set(vars.map(v => v.name));
    const extra: string[] = [];
    if (names.has('canonicalLinkPairs')) {
      extra.push(getVariableDescription('canonicalLinkPairs'));
    }
    return extra.length > 0 ? extra.join(' ／ ') : null;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">プロンプト管理</h1>
        <p className="mt-2 text-gray-600">プロンプトテンプレートを選択して内容を編集します</p>
      </div>

      {/* エラーメッセージ */}
      {error && (
        <div className="mb-6">
          <ErrorAlert error={error} />
        </div>
      )}

      {/* プロンプトテンプレート選択 */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <CardTitle>プロンプトテンプレート選択</CardTitle>
              <div className="flex flex-wrap gap-2">
                {PROMPT_CATEGORIES.map(category => (
                  <Button
                    key={category.id}
                    variant={activeCategory === category.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory(category.id)}
                    aria-pressed={activeCategory === category.id}
                  >
                    {category.label}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        activeCategory === category.id
                          ? 'bg-white/20 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {categoryCounts[category.id] ?? 0}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-sm text-gray-500">用途別にタブを切り替えて編集します</p>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTemplates.length === 0 ? (
            <p className="text-sm text-gray-500">
              選択中のカテゴリに該当するテンプレートがありません。
            </p>
          ) : (
            <Select value={selectedTemplate?.id || ''} onValueChange={handleTemplateSelect}>
              <SelectTrigger
                className="w-full"
                aria-label="プロンプトテンプレート選択"
                tabIndex={0}
              >
                <SelectValue placeholder="編集するプロンプトテンプレートを選択してください" />
              </SelectTrigger>
              <SelectContent>
                {filteredTemplates.map(template => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* プロンプト詳細・編集 */}
      {selectedTemplate && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedTemplate.display_name}</CardTitle>
            <div className="text-xs text-gray-500 mt-1">
              最終更新:{' '}
              {selectedTemplate.updated_at
                ? new Date(selectedTemplate.updated_at).toLocaleString('ja-JP')
                : '未更新'}
            </div>
            {(promptDescription || variablesInfoText) && (
              <div className="text-sm text-gray-600 space-y-2">
                {promptDescription?.description && (
                  <p>
                    <strong>説明:</strong> {promptDescription.description}
                  </p>
                )}
                {variablesInfoText && (
                  <p>
                    <strong>使用可能な変数:</strong> {variablesInfoText}
                  </p>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="prompt-content"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                プロンプト内容
              </label>
              <Textarea
                id="prompt-content"
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
                rows={15}
                className="w-full"
                placeholder="プロンプト内容を入力してください"
                aria-label="プロンプト内容編集"
                tabIndex={0}
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={isSaving || editedContent === selectedTemplate.content}
                aria-label="保存"
                tabIndex={0}
              >
                {isSaving ? (
                  '保存中...'
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    保存
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={editedContent === selectedTemplate.content}
                aria-label="リセット"
                tabIndex={0}
              >
                リセット
              </Button>
            </div>

            {/* 変数一覧 */}
            {(() => {
              const vars = buildDisplayVariables(selectedTemplate);
              if (vars.length === 0) return null;
              return (
                <div className="mt-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-3">使用可能な変数</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {vars.map((variable, index) => (
                      <div key={index} className="p-3 bg-gray-50 rounded-md">
                        <div className="font-mono text-sm text-blue-600">{`{{${variable.name}}}`}</div>
                        <div className="text-sm text-gray-600 mt-1">{variable.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
