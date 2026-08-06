export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export class Logger {
  constructor(private level: LogLevel = 'info', private scope = 'app') {}
  child(scope: string) { return new Logger(this.level, `${this.scope}:${scope}`); }
  private write(lvl: LogLevel, msg: string, extra?: unknown) {
    if (ORDER[lvl] < ORDER[this.level]) return;
    const line = `${new Date().toISOString()} [${lvl.toUpperCase()}] (${this.scope}) ${msg}`;
    if (extra !== undefined) console.log(line, typeof extra === 'object' ? JSON.stringify(extra) : extra);
    else console.log(line);
  }
  debug(msg: string, extra?: unknown) { this.write('debug', msg, extra); }
  info(msg: string, extra?: unknown) { this.write('info', msg, extra); }
  warn(msg: string, extra?: unknown) { this.write('warn', msg, extra); }
  error(msg: string, extra?: unknown) { this.write('error', msg, extra); }
}