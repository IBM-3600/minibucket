import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

let installed = false;
let stream: fs.WriteStream | null = null;

const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const message = util.format(...args);
  return `${ts} [${level.toUpperCase()}] ${message}\n`;
}

/**
 * Mirrors all console.* output to a file.
 *
 * Terminal output still works.
 * File logging is append-only.
 */
export async function installConsoleFileLogger(logFile: string | null | undefined): Promise<void> {
  if (installed) return;
  if (!logFile) return;

  installed = true;

  await fsp.mkdir(path.dirname(logFile), { recursive: true });

  stream = fs.createWriteStream(logFile, {
    flags: 'a',
    encoding: 'utf8'
  });

  stream.on('error', err => {
    // Avoid console.* here to prevent recursion.
    process.stderr.write(
      `${new Date().toISOString()} [ERROR] log file stream error: ${err.message}\n`
    );
  });

  const patch = (method: ConsoleMethod, level: string) => {
    console[method] = (...args: unknown[]) => {
      // Keep normal console behavior.
      originalConsole[method](...args);

      // Also write to file.
      try {
        stream?.write(formatLine(level, args));
      } catch {
        // Ignore file logging errors to avoid crashing app.
      }
    };
  };

  patch('log', 'info');
  patch('info', 'info');
  patch('warn', 'warn');
  patch('error', 'error');
  patch('debug', 'debug');

  process.on('uncaughtException', err => {
    try {
      stream?.write(formatLine('fatal', ['uncaughtException', err.stack || err.message]));
    } finally {
      originalConsole.error(err);
    }
  });

  process.on('unhandledRejection', reason => {
    stream?.write(formatLine('fatal', ['unhandledRejection', reason]));
  });

  console.info(`File logging enabled: ${logFile}`);
}

export async function closeConsoleFileLogger(): Promise<void> {
  if (!stream) return;

  await new Promise<void>(resolve => {
    stream!.end(resolve);
  });

  stream = null;
}