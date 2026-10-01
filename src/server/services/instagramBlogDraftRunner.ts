import 'server-only';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { CONTINUATION_INSTRUCTION, mergeTrailingUserMessage } from '@/lib/chat-continuation';
import {
  CHAT_HISTORY_LIMIT,
  getStep7HeadingModel,
  MODEL_CONFIGS,
  STEP7_HEADING_CONFIG_KEY,
  toBlogModel,
  type BlogStepId,
} from '@/lib/constants';
import { normalizeHeadingUnitContent } from '@/lib/heading-extractor';
import { resolveKnowledgeBlocksForRequest } from '@/lib/knowledgeInjection';
import { generateInstagramBlogKeywordPrompt, getSystemPrompt } from '@/lib/prompts';
import type { Tables, TablesUpdate } from '@/types/database.types';
import type {
  InstagramBlogDraftErrorCode,
  InstagramBlogDraftStage,
} from '@/types/instagram';
import type { UserRole } from '@/types/user';
import {
  buildInstagramHeadingInput,
  buildInstagramStep1Input,
  buildInstagramStep6Input,
  extractStep6LeadPatternA,
  getInstagramResumeAction,
  parseInstagramKeywordProposal,
} from '@/server/lib/instagram-blog-draft-content';
import { INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS } from '@/server/lib/instagram-blog-draft-jobs';
import { SupabaseService } from '@/server/services/supabaseService';
import { chatService } from '@/server/services/chatService';
import { headingFlowService } from '@/server/services/headingFlowService';
import { llmChatWithStopReason } from '@/server/services/llmService';

type JobRow = Tables<'instagram_blog_draft_jobs'>;
type JobUpdate = TablesUpdate<'instagram_blog_draft_jobs'>;
type ChatHistory = Awaited<ReturnType<typeof chatService.getSessionMessages>>;
type BlogStepStage = Extract<InstagramBlogDraftStage, `step${number}`>;

export class InstagramBlogDraftFailure extends Error {
  constructor(readonly code: InstagramBlogDraftErrorCode) {
    super(code);
    this.name = 'InstagramBlogDraftFailure';
  }
}

/** 自分の running の行（またはそのチャット）が無くなった。連携解除などで消えたので、この投稿の処理をここで止める */
class JobRowLostError extends Error {}
/** 残り時間が足りないので queued に戻した。次のワーカーが同じ stage から続ける */
class JobRequeuedError extends Error {}

type InstagramBlogDraftRunResult = 'completed' | 'queued' | 'lost';

class InstagramBlogDraftRunner extends SupabaseService {
  async run(jobId: string, userId: string, userRole: UserRole, deadline: number): Promise<InstagramBlogDraftRunResult> {
    try {
      await this.runSteps(jobId, userId, userRole, deadline);
      return 'completed';
    } catch (error) {
      if (error instanceof JobRowLostError) return 'lost';
      if (error instanceof JobRequeuedError) return 'queued';
      throw error;
    }
  }

  private async runSteps(jobId: string, userId: string, userRole: UserRole, deadline: number): Promise<void> {
    const { data: jobData, error: jobError } = await this.getClient()
      .from('instagram_blog_draft_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();
    if (jobError) throw new Error('Instagram blog draft job lookup failed');
    if (!jobData) throw new JobRowLostError();
    let job: JobRow = jobData;

    const { data: media, error: mediaError } = await this.getClient()
      .from('instagram_media')
      .select('caption')
      .eq('id', job.instagram_media_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (mediaError) throw new Error('Instagram blog draft media lookup failed');
    if (!media) throw new JobRowLostError();
    const caption = media.caption ?? '';
    if (!caption.trim()) throw new InstagramBlogDraftFailure('AI_FAILED');

    while (job.stage !== 'done') {
      await this.requeueIfOutOfTime(job, userId, deadline);
      await this.ensureOwnedSession(job, userId);
      switch (job.stage) {
        case 'keywords':
          job = await this.runKeywords(job, userId, userRole, caption, deadline);
          break;
        case 'step1':
        case 'step2':
        case 'step3':
        case 'step4':
        case 'step5':
        case 'step6':
          job = await this.runBlogStep(job, userId, userRole, caption, job.stage, deadline);
          break;
        case 'headings':
          job = await this.initializeHeadings(job, userId);
          break;
        case 'heading':
          job = await this.runHeading(job, userId, userRole, deadline);
          break;
        case 'combine':
          job = await this.combineArticle(job, userId);
          break;
        default:
          throw new InstagramBlogDraftFailure('SAVE_FAILED');
      }
    }
  }

  private async ensureOwnedSession(job: JobRow, userId: string): Promise<void> {
    if (!job.session_id) return;
    const result = await this.getChatSessionById(job.session_id, userId);
    if (!result.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    if (!result.data) throw new JobRowLostError();
  }

  private async runKeywords(
    job: JobRow,
    userId: string,
    userRole: UserRole,
    caption: string,
    deadline: number
  ): Promise<JobRow> {
    if (job.session_id) {
      const { data: annotation, error } = await this.getClient()
        .from('content_annotations')
        .select('id')
        .eq('user_id', userId)
        .eq('session_id', job.session_id)
        .maybeSingle();
      if (error) throw new InstagramBlogDraftFailure('SAVE_FAILED');
      if (annotation) return this.advance(job, userId, 'step1');
    }

    let systemPrompt: string;
    try {
      systemPrompt = await generateInstagramBlogKeywordPrompt(userId, caption);
    } catch {
      throw new InstagramBlogDraftFailure('AI_FAILED');
    }
    await this.requeueIfOutOfTime(job, userId, deadline);
    const generated = await this.callModel(userRole, 'instagram_blog_keyword_generation', systemPrompt, [], caption);
    let proposal;
    try {
      proposal = parseInstagramKeywordProposal(generated.content);
    } catch (error) {
      console.error('[Instagram BlogDraft] keyword proposal parse failed', {
        jobId: job.id,
        error,
        truncated: generated.truncated,
        output: generated.content.slice(0, 500),
      });
      throw new InstagramBlogDraftFailure('KEYWORD_PARSE_FAILED');
    }

    const sessionId = job.session_id ?? crypto.randomUUID();
    if (!job.session_id) {
      const now = new Date().toISOString();
      const createResult = await this.createChatSession({
        id: sessionId,
        user_id: userId,
        title: proposal.main_kw.slice(0, 50),
        created_at: now,
        last_message_at: now,
        system_prompt: null,
        service_id: null,
        search_vector: null,
      });
      if (!createResult.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
      job = await this.updateJob(job, userId, { session_id: sessionId });
    }

    const { error: annotationError } = await this.getClient()
      .from('content_annotations')
      .upsert({
        user_id: userId,
        session_id: sessionId,
        main_kw: proposal.main_kw,
        kw: proposal.kw.join('\n'),
        canonical_url: null,
        wp_post_id: null,
      }, { onConflict: 'session_id' });
    if (annotationError) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    return this.advance(job, userId, 'step1');
  }

  private async runBlogStep(
    job: JobRow,
    userId: string,
    userRole: UserRole,
    caption: string,
    step: BlogStepStage,
    deadline: number
  ): Promise<JobRow> {
    const sessionId = this.requireSession(job);
    const chat = await chatService.getSessionMessages(sessionId, userId);
    const model = toBlogModel(step as BlogStepId);
    const previousStep = Number(step.slice(4)) - 1;
    const previousOutput = step === 'step1'
      ? ''
      : chat.filter(message => message.role === 'assistant' && message.model === toBlogModel(`step${previousStep}` as BlogStepId)).at(-1)?.content;
    if (previousOutput === undefined) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const { data: annotation, error: annotationReadError } = await this.getClient()
      .from('content_annotations')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .maybeSingle();
    if (annotationReadError || !annotation) throw new InstagramBlogDraftFailure('SAVE_FAILED');

    const input = step === 'step1'
      ? buildInstagramStep1Input(annotation.main_kw ?? '', (annotation.kw ?? '').split('\n').filter(Boolean), caption)
      : step === 'step6'
        ? buildInstagramStep6Input(previousOutput, caption)
        : previousOutput;
    const lastAssistant = chat.filter(message => message.role === 'assistant').at(-1);
    const action = getInstagramResumeAction(job.continuation_count, lastAssistant?.model === model);
    if (action === 'advance') {
      return this.saveStepOutput(job, userId, step, lastAssistant?.content ?? '');
    }
    if (action === 'generate' && job.continuation_count !== null) {
      job = await this.updateJob(job, userId, { continuation_count: null });
    }
    const systemPrompt = await getSystemPrompt(model, undefined, sessionId, undefined, { userId });
    const content = action === 'continue'
      ? await this.continueTruncated(job, userId, userRole, model, systemPrompt, chat, deadline)
      : await this.generateAndSave(job, userId, userRole, model, systemPrompt, chat, input, deadline);
    return this.saveStepOutput(job, userId, step, content);
  }

  private async saveStepOutput(
    job: JobRow,
    userId: string,
    step: BlogStepStage,
    content: string
  ): Promise<JobRow> {
    const updateByStep = {
      step1: { needs: content.trim() },
      step2: { persona: content.trim() },
      step3: { goal: content.trim() },
      step4: { prep: content.trim() },
      step5: { basic_structure: content.trim() },
      step6: { opening_proposal: content.trim() },
    };
    const { data, error } = await this.getClient()
      .from('content_annotations')
      .update(updateByStep[step])
      .eq('user_id', userId)
      .eq('session_id', this.requireSession(job))
      .select('session_id')
      .maybeSingle();
    if (error || !data) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const nextStage = step === 'step6' ? 'headings' : `step${Number(step.slice(4)) + 1}` as InstagramBlogDraftStage;
    return this.advance(job, userId, nextStage);
  }

  private async initializeHeadings(job: JobRow, userId: string): Promise<JobRow> {
    const sessionId = this.requireSession(job);
    const chat = await chatService.getSessionMessages(sessionId, userId);
    const step5 = chat.filter(message => message.role === 'assistant' && message.model === 'blog_creation_step5').at(-1)?.content;
    const step6 = chat.filter(message => message.role === 'assistant' && message.model === 'blog_creation_step6').at(-1)?.content;
    if (step5 === undefined || step6 === undefined) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const initialized = await headingFlowService.initializeHeadingSections(sessionId, step5);
    if (!initialized.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const sections = await headingFlowService.getHeadingSections(sessionId);
    if (!sections.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    if (sections.data.length === 0) throw new InstagramBlogDraftFailure('NO_HEADINGS');
    const lead = await headingFlowService.getStep7UserLeadResult(sessionId);
    if (!lead.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    if (!lead.data?.trim()) {
      const extractedLead = extractStep6LeadPatternA(step6);
      if (!extractedLead) throw new InstagramBlogDraftFailure('LEAD_PARSE_FAILED');
      const saved = await headingFlowService.saveStep7UserLead(sessionId, userId, extractedLead);
      if (!saved.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    }
    return this.advance(job, userId, 'heading', { heading_total: sections.data.length, heading_index: 0 });
  }

  private async runHeading(job: JobRow, userId: string, userRole: UserRole, deadline: number): Promise<JobRow> {
    const sessionId = this.requireSession(job);
    const sectionsResult = await headingFlowService.getHeadingSections(sessionId);
    if (!sectionsResult.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const section = sectionsResult.data[job.heading_index];
    if (!section) return this.advance(job, userId, 'combine');
    // 手動の［保存］（ChatLayout.tsx の normalizeHeadingUnitContent 呼び出し）と同じく、後続の見出しをすべて渡す
    const followingHeadings = sectionsResult.data.slice(job.heading_index + 1).map(next => next.heading_text);
    const chat = await chatService.getSessionMessages(sessionId, userId);
    const model = getStep7HeadingModel(job.heading_index);
    const lastAssistant = chat.filter(message => message.role === 'assistant').at(-1);
    const action = getInstagramResumeAction(job.continuation_count, lastAssistant?.model === model);
    if (action === 'advance') {
      if (lastAssistant === undefined) throw new InstagramBlogDraftFailure('SAVE_FAILED');
      return this.saveHeadingSection(job, userId, section, lastAssistant.content, followingHeadings);
    }
    if (action === 'generate' && job.continuation_count !== null) {
      job = await this.updateJob(job, userId, { continuation_count: null });
    }
    const systemPrompt = await getSystemPrompt(model, undefined, sessionId, undefined, { userId });
    const input = buildInstagramHeadingInput(section.heading_text);
    const content = action === 'continue'
      ? await this.continueTruncated(job, userId, userRole, model, systemPrompt, chat, deadline)
      : await this.generateAndSave(job, userId, userRole, model, systemPrompt, chat, input, deadline);
    return this.saveHeadingSection(job, userId, section, content, followingHeadings);
  }

  private async saveHeadingSection(
    job: JobRow,
    userId: string,
    section: { heading_key: string; heading_text: string },
    content: string,
    followingHeadings: string[]
  ): Promise<JobRow> {
    const normalized = normalizeHeadingUnitContent(content.trim(), section.heading_text, followingHeadings);
    const saved = await headingFlowService.saveHeadingSection(this.requireSession(job), section.heading_key, normalized);
    if (!saved.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    const nextIndex = job.heading_index + 1;
    return this.advance(job, userId, nextIndex >= (job.heading_total ?? 0) ? 'combine' : 'heading', {
      heading_index: nextIndex,
    });
  }

  private async combineArticle(job: JobRow, userId: string): Promise<JobRow> {
    const result = await headingFlowService.saveCombinedContentForStep7(this.requireSession(job), userId);
    if (!result.success) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    return this.advance(job, userId, 'done');
  }

  /** 生成してチャットに保存し、途切れていなければその出力を、途切れていれば続きを連結した出力を返す */
  private async generateAndSave(
    job: JobRow,
    userId: string,
    userRole: UserRole,
    model: string,
    systemPrompt: string,
    history: ChatHistory,
    input: string,
    deadline: number
  ): Promise<string> {
    await this.requeueIfOutOfTime(job, userId, deadline);
    const result = await this.callModel(userRole, model, systemPrompt, history, input);
    // 途切れた出力を保存する前に記録する。保存後に落ちても、再開時に続きの生成から入れるようにするため
    if (result.truncated) job = await this.updateJob(job, userId, { continuation_count: 0 });
    const saved = await chatService.continueChat(
      userId,
      this.requireSession(job),
      [input, result.content],
      '',
      [],
      model
    );
    if (saved.error) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    if (!result.truncated) return result.content;
    return this.continueTruncated(
      job, userId, userRole, model, systemPrompt,
      await chatService.getSessionMessages(this.requireSession(job), userId), deadline
    );
  }

  /** 保存済みの途切れた出力に続きを連結する。続きは最大2回で、なお途切れていたら MAX_TOKENS */
  private async continueTruncated(
    job: JobRow,
    userId: string,
    userRole: UserRole,
    model: string,
    systemPrompt: string,
    history: ChatHistory,
    deadline: number
  ): Promise<string> {
    let latest = history.filter(message => message.role === 'assistant' && message.model === model).at(-1)?.content;
    if (latest === undefined) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    let continuationCount = job.continuation_count ?? 0;
    while (continuationCount < 2) {
      await this.requeueIfOutOfTime(job, userId, deadline);
      await this.updateJob(job, userId, { continuation_count: continuationCount + 1 });
      continuationCount += 1;
      const currentHistory = await chatService.getSessionMessages(this.requireSession(job), userId);
      const result = await this.callModel(userRole, model, systemPrompt, currentHistory, CONTINUATION_INSTRUCTION);
      // 途切れた出力は trim せずに連結する（行の途中で切れた箇所の改行や空白を保つため）
      latest += result.content;
      const saved = await chatService.updateLastAssistantMessage(userId, this.requireSession(job), latest, model);
      if (!saved.sessionId) throw new InstagramBlogDraftFailure('SAVE_FAILED');
      if (!result.truncated) {
        await this.updateJob(job, userId, { continuation_count: null });
        return latest;
      }
    }
    throw new InstagramBlogDraftFailure('MAX_TOKENS');
  }

  private async callModel(
    userRole: UserRole,
    model: string,
    systemPrompt: string,
    history: ChatHistory,
    input: string
  ): Promise<{ content: string; truncated: boolean }> {
    const configKey = model.startsWith('blog_creation_step7_h') ? STEP7_HEADING_CONFIG_KEY : model;
    const config = MODEL_CONFIGS[configKey];
    if (!config) throw new Error(`Missing model config: ${configKey}`);
    const recentMessages = history
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .slice(-CHAT_HISTORY_LIMIT)
      .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content }));
    const { messages, userMessage } = mergeTrailingUserMessage(recentMessages, input);
    const { anthropicSystem } = await resolveKnowledgeBlocksForRequest(systemPrompt, {
      modelKey: model,
      userRole,
      inputEstimate: { recentMessages: messages, userMessage },
    });
    try {
      const result = await llmChatWithStopReason(config.provider, config.actualModel, [
        ...messages,
        { role: 'user', content: userMessage },
      ], {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thinking: config.thinking,
        timeoutMs: 180_000,
        maxRetries: 0,
        anthropicSystemBlocks: anthropicSystem,
      });
      return { content: result.content, truncated: result.stopReason === 'max_tokens' };
    } catch (error) {
      if (error instanceof ChatError && error.code === ChatErrorCode.ANTHROPIC_RATE_LIMIT) {
        throw new InstagramBlogDraftFailure('AI_RATE_LIMITED');
      }
      throw new InstagramBlogDraftFailure('AI_FAILED');
    }
  }

  private async advance(
    job: JobRow,
    userId: string,
    stage: InstagramBlogDraftStage,
    extra: JobUpdate = {}
  ): Promise<JobRow> {
    return this.updateJob(job, userId, {
      ...extra,
      stage,
      continuation_count: null,
      ...(stage === 'done' ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    });
  }

  /** 自分の running の行だけを更新する。0件なら行が無くなったので処理を止める */
  private async updateJob(job: JobRow, userId: string, values: JobUpdate): Promise<JobRow> {
    const { data, error } = await this.getClient()
      .from('instagram_blog_draft_jobs')
      .update(values)
      .eq('id', job.id)
      .eq('user_id', userId)
      .eq('status', 'running')
      .select('*')
      .maybeSingle();
    if (error) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    if (!data) throw new JobRowLostError();
    return data;
  }

  private async requeueIfOutOfTime(job: JobRow, userId: string, deadline: number): Promise<void> {
    if (Date.now() + INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS <= deadline) return;
    await this.updateJob(job, userId, { status: 'queued' });
    throw new JobRequeuedError();
  }

  private requireSession(job: JobRow): string {
    if (!job.session_id) throw new InstagramBlogDraftFailure('SAVE_FAILED');
    return job.session_id;
  }
}

export const instagramBlogDraftRunner = new InstagramBlogDraftRunner();
