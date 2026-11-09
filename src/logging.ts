import { format } from "node:util";

const REDACTED = "[REDACTED]";
const projectIds = new Set<string>();
let installed = false;

export function redactProjectId(text: string, projectId: string): string {
  return text
    .replaceAll(projectId, REDACTED)
    .replaceAll(encodeURIComponent(projectId), REDACTED)
    .replace(/([?&]project_id=)[^&\s"'<>]+/gi, `$1${REDACTED}`);
}

export function installLogRedaction(projectId: string): void {
  projectIds.add(projectId);
  if (installed) return;
  installed = true;

  const methods = ["debug", "error", "info", "log", "warn"] as const;

  for (const method of methods) {
    const write = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const redacted = [...projectIds].reduce(
        (text, id) => redactProjectId(text, id),
        format(...args),
      );
      write(redacted);
    };
  }
}
