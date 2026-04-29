type LogLevel = 'info' | 'warn' | 'error';

type LogMetadata = Record<string, unknown>;

const writeLog = (level: LogLevel, message: string, metadata: LogMetadata = {}) => {
  if (level === 'error') {
    console.error(message, metadata);
    return;
  }

  if (level === 'warn') {
    console.warn(message, metadata);
    return;
  }

  console.info(message, metadata);
};

export const logger = {
  info: (message: string, metadata?: LogMetadata) => writeLog('info', message, metadata),
  warn: (message: string, metadata?: LogMetadata) => writeLog('warn', message, metadata),
  error: (message: string, metadata?: LogMetadata) => writeLog('error', message, metadata),
};
