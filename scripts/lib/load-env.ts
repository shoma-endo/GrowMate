import { readFileSync } from 'fs';
import { join } from 'path';

export function loadEnv(): Record<string, string> {
  try {
    const envPath = join(__dirname, '../../.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};

    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts
            .join('=')
            .trim()
            .replace(/^["']|["']$/g, '');
        }
      }
    }

    return env;
  } catch (error) {
    console.error('環境変数の読み込みエラー:', error);
    return {};
  }
}
