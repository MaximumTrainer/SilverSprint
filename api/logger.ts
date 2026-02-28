import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  athleteId?: string;
  data?: unknown;
}

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'silversprint.log');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Server-side logger for API & webhook flows.
 *
 * Development: stdout + log file (file reset on startup)
 * Production:  log file only (persistent between restarts), errors include athleteId
 */
class Logger {
  private initialized = false;

  /** Call once at startup to prepare the log file. */
  init(): void {
    if (this.initialized) return;

    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    if (isDev) {
      // Reset log file on every dev restart
      writeFileSync(LOG_FILE, `--- SilverSprint dev session started ${new Date().toISOString()} ---\n`);
    } else {
      // Production: append a restart marker but keep existing content
      appendFileSync(LOG_FILE, `\n--- SilverSprint restart ${new Date().toISOString()} ---\n`);
    }

    this.initialized = true;
  }

  private format(entry: LogEntry): string {
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.level.toUpperCase()}]`,
    ];
    if (entry.athleteId) {
      parts.push(`[athlete:${entry.athleteId}]`);
    }
    parts.push(entry.message);
    if (entry.data !== undefined) {
      parts.push(JSON.stringify(entry.data));
    }
    return parts.join(' ');
  }

  private write(level: LogLevel, message: string, athleteId?: string, data?: unknown): void {
    if (!this.initialized) this.init();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      athleteId,
      data,
    };

    const line = this.format(entry) + '\n';

    // Always write to log file
    appendFileSync(LOG_FILE, line);

    // In dev, also write to stdout
    if (isDev) {
      const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
      process.stdout.write(`${color}${line}\x1b[0m`);
    }
  }

  info(message: string, athleteId?: string, data?: unknown): void {
    this.write('info', message, athleteId, data);
  }

  warn(message: string, athleteId?: string, data?: unknown): void {
    this.write('warn', message, athleteId, data);
  }

  error(message: string, athleteId?: string, data?: unknown): void {
    this.write('error', message, athleteId, data);
  }
}

export const logger = new Logger();
