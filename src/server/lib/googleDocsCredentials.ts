import 'server-only';

interface GoogleDocsCredentials {
  clientEmail: string;
  privateKey: string;
}

export function getGoogleDocsCredentials(): GoogleDocsCredentials {
  const clientEmail = process.env.GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      'Google Docs サービスアカウントが未設定です。GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL と GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY を設定してください。'
    );
  }

  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
  };
}

export function isGoogleDocsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
  );
}
