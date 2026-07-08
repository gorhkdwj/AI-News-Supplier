export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(level: Exclude<LogLevel, 'silent'>, msg: string, args: unknown[]): void {
  if (levelOrder[level] < levelOrder[currentLevel]) return;
  const extra =
    args.length > 0 ? ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '';
  // 중요: 로그는 반드시 stderr로만 쓴다. stdout은 MCP stdio 전송 전용이다. (CLAUDE.md 4절)
  process.stderr.write(`[ains:${level}] ${msg}${extra}\n`);
}

export const logger = {
  debug: (msg: string, ...args: unknown[]): void => emit('debug', msg, args),
  info: (msg: string, ...args: unknown[]): void => emit('info', msg, args),
  warn: (msg: string, ...args: unknown[]): void => emit('warn', msg, args),
  error: (msg: string, ...args: unknown[]): void => emit('error', msg, args),
};

export type Logger = typeof logger;
