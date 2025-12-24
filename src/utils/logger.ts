import { logAmount, logResponse } from "../../devVariables.js";

// Creates a simple, shared logger with scoped labels and level filtering.
// Levels:
// - 0: errors/warnings only
// - 1: + info
// - 2: + debug (most verbose)
export function createLogger(scope = "app") {
  const label = `[${scope}]`;

  const shouldInfo = () => logAmount >= 1;
  const shouldDebug = () => logAmount >= 2;

  return {
    info: (...args: unknown[]) => { if (shouldInfo()) console.log("INFO", label, ...args); },
    debug: (...args: unknown[]) => { if (shouldDebug()) console.log("DEBUG", label, ...args); },
    warn: (...args: unknown[]) => console.warn("WARN", label, ...args),
    error: (...args: unknown[]) => console.error("ERROR", label, ...args),
    // For large model responses or payloads, controlled by logResponse and logAmount > 0
    response: (title: string, payload: unknown) => {
      if (logResponse && logAmount) {
        try {
          const pretty = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
          console.log(`----- BEGIN ${title} -----\n\n${pretty}\n\n----- END ${title} -----\n`);
        } catch (e) {
          console.log(`----- ${title} (unserializable) -----`);
        }
      }
    },
  };
}
