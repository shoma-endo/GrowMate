import { z } from 'zod';

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: z.url().optional(),
  WORDPRESS_COM_CLIENT_ID: z.string().min(1).optional(),
  WORDPRESS_COM_CLIENT_SECRET: z.string().min(1).optional(),
  WORDPRESS_COM_REDIRECT_URI: z.url().optional(),
  COOKIE_SECRET: z.string().min(1).optional(),
});

type ClientEnv = z.infer<typeof clientEnvSchema>;
type ServerEnv = z.infer<typeof serverEnvSchema>;
type Env = ClientEnv & ServerEnv;

const isServer = typeof window === 'undefined';

const clientRuntimeEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
} satisfies { [K in keyof ClientEnv]?: ClientEnv[K] | undefined };

const parsedClientEnv = clientEnvSchema.parse(clientRuntimeEnv);

let parsedServerEnv: ServerEnv | undefined;
if (isServer) {
  const serverRuntimeEnv = {
    SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI,
    WORDPRESS_COM_CLIENT_ID: process.env.WORDPRESS_COM_CLIENT_ID,
    WORDPRESS_COM_CLIENT_SECRET: process.env.WORDPRESS_COM_CLIENT_SECRET,
    WORDPRESS_COM_REDIRECT_URI: process.env.WORDPRESS_COM_REDIRECT_URI,
    COOKIE_SECRET: process.env.COOKIE_SECRET,
  } satisfies { [K in keyof ServerEnv]?: ServerEnv[K] | undefined };

  parsedServerEnv = serverEnvSchema.parse(serverRuntimeEnv);
}

const serverOnlyKeys = new Set<keyof ServerEnv>([
  'SUPABASE_SERVICE_ROLE',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_SEARCH_CONSOLE_REDIRECT_URI',
  'WORDPRESS_COM_CLIENT_ID',
  'WORDPRESS_COM_CLIENT_SECRET',
  'WORDPRESS_COM_REDIRECT_URI',
  'COOKIE_SECRET',
]);

const clientKeys = new Set<keyof ClientEnv>([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
]);

const envProxy = new Proxy({} as Env, {
  get: (_target, prop) => {
    if (typeof prop !== 'string') {
      if (prop === Symbol.toStringTag) {
        return 'Env';
      }
      return undefined;
    }

    if (clientKeys.has(prop as keyof ClientEnv)) {
      return parsedClientEnv[prop as keyof ClientEnv];
    }

    if (serverOnlyKeys.has(prop as keyof ServerEnv)) {
      if (!isServer) {
        throw new Error(`サーバー専用環境変数 ${prop} をクライアントから参照できません`);
      }
      if (!parsedServerEnv) {
        throw new Error('サーバー環境変数の初期化に失敗しました');
      }
      return parsedServerEnv[prop as keyof ServerEnv];
    }

    throw new Error(`環境変数 ${String(prop)} はスキーマに存在しません`);
  },
  has: (_target, prop) => {
    if (typeof prop !== 'string') {
      return false;
    }
    if (clientKeys.has(prop as keyof ClientEnv)) {
      return true;
    }
    return isServer && serverOnlyKeys.has(prop as keyof ServerEnv);
  },
  ownKeys: () => [
    ...Array.from(clientKeys.values()),
    ...(isServer && parsedServerEnv ? Object.keys(parsedServerEnv) : []),
  ],
  getOwnPropertyDescriptor: (_target, prop) => {
    if (typeof prop !== 'string') {
      return undefined;
    }
    if (
      clientKeys.has(prop as keyof ClientEnv) ||
      (isServer && serverOnlyKeys.has(prop as keyof ServerEnv))
    ) {
      return { enumerable: true, configurable: false };
    }
    return undefined;
  },
});

export const env = envProxy;
