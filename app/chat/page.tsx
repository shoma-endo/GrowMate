import ChatClient from './ChatClient';
import { BLOG_STEP_IDS, type BlogStepId } from '@/lib/constants';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

interface ChatPageProps {
  searchParams?: SearchParams;
}

const getFirstParam = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = searchParams ? await searchParams : {};

  // session パラメータを取得（複数指定時は先頭を採用）
  const sessionParam = params.session;
  const initialSessionId = getFirstParam(sessionParam);

  // initialStep パラメータを取得してバリデーション（複数指定時は先頭を採用）
  const rawInitialStep = getFirstParam(params.initialStep);
  const initialStep =
    rawInitialStep && BLOG_STEP_IDS.includes(rawInitialStep as BlogStepId)
      ? (rawInitialStep as BlogStepId)
      : undefined;

  return <ChatClient initialSessionId={initialSessionId} initialStep={initialStep} />;
}
