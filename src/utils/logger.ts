import fs from "fs/promises";
import path from "path";
import util from "util";
import { logAmount, logResponse } from "../devVariables.js";

type LogLevel = "debug" | "info" | "warn" | "error" | "log";

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_DIR = path.resolve(process.cwd(), "dev-logs");
const LOG_FILE = path.join(LOG_DIR, `run-${RUN_ID}.json`);

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let writeChain: Promise<void> = Promise.resolve();
let reportedWriteFailure = false;

function toJsonValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value as any).cause ? { cause: (value as any).cause } : {},
    };
  }

  if (typeof value === "bigint") return value.toString();
  return value;
}

function enqueueLog(entry: Record<string, unknown>) {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  }).catch((e: unknown) => {
    if (reportedWriteFailure) return;
    reportedWriteFailure = true;
    const msg = e instanceof Error ? e.message : String(e);
    originalConsole.warn("WARN", "[logger]", "Failed to write dev log file:", msg);
  });
}

function installConsoleFileLogger() {
  const wrap = (level: LogLevel, original: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      try {
        enqueueLog({
          t: new Date().toISOString(),
          level,
          scope: "console",
          text: util.format(...args),
          args: args.map(toJsonValue),
        });
      } catch {}
      original(...args);
    };
  };

  console.log = wrap("log", originalConsole.log) as any;
  console.info = wrap("info", originalConsole.info) as any;
  console.debug = wrap("debug", originalConsole.debug) as any;
  console.warn = wrap("warn", originalConsole.warn) as any;
  console.error = wrap("error", originalConsole.error) as any;
}

installConsoleFileLogger();

// Creates a simple, shared logger with scoped labels and level filtering.
// Levels:
// - 0: errors/warnings only
// - 1: + info
// - 2: + debug (most verbose)
export function createLogger(scope = "app") {
  const label = `[${scope}]`;

  const shouldInfo = () => logAmount >= 1;
  const shouldDebug = () => logAmount >= 2;

  const logToFile = (level: LogLevel, args: unknown[]) => {
    try {
      enqueueLog({
        t: new Date().toISOString(),
        level,
        scope,
        label,
        text: util.format(...args),
        args: args.map(toJsonValue),
      });
    } catch {}
  };

  return {
    info: (...args: unknown[]) => {
      logToFile("info", args);
      if (shouldInfo()) originalConsole.log("INFO", label, ...args);
    },
    debug: (...args: unknown[]) => {
      logToFile("debug", args);
      if (shouldDebug()) originalConsole.log("DEBUG", label, ...args);
    },
    warn: (...args: unknown[]) => {
      logToFile("warn", args);
      originalConsole.warn("WARN", label, ...args);
    },
    error: (...args: unknown[]) => {
      logToFile("error", args);
      originalConsole.error("ERROR", label, ...args);
    },
    // For large model responses or payloads, controlled by logResponse and logAmount > 0
    response: (title: string, payload: unknown) => {
      try {
        logToFile("info", [`RESPONSE ${title}`, payload]);
      } catch {}

      if (logResponse && logAmount) {
        try {
          const pretty = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
          originalConsole.log(`----- BEGIN ${title} -----\n\n${pretty}\n\n----- END ${title} -----\n`);
        } catch (e) {
          logToFile("warn", [`RESPONSE ${title} (unserializable)`, e]);
          originalConsole.log(`----- ${title} (unserializable) -----`);
        }
      }
    },
  };
}
