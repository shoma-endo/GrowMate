import type { Database as GeneratedDatabase } from '@/types/database.types';
import type {
  KnowledgeSourceDbRow,
  KnowledgeSourceInsert,
  KnowledgeSourceUpdate,
} from '@/types/knowledgeSourceDb';

type KnowledgeSourcesTable = {
  Row: KnowledgeSourceDbRow;
  Insert: KnowledgeSourceInsert & { id?: string; prompt_template_id?: string | null };
  Update: KnowledgeSourceUpdate & { id?: string; scope?: string; sort_order?: number };
  Relationships: [
    {
      foreignKeyName: 'knowledge_sources_prompt_template_id_fkey';
      columns: ['prompt_template_id'];
      isOneToOne: false;
      referencedRelation: 'prompt_templates';
      referencedColumns: ['id'];
    },
  ];
};

export type DatabaseWithKnowledgeSources = GeneratedDatabase & {
  public: GeneratedDatabase['public'] & {
    Tables: GeneratedDatabase['public']['Tables'] & {
      knowledge_sources: KnowledgeSourcesTable;
    };
  };
};
