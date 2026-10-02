import type { AppError } from "@/lib/bindings";

/** Shape returned by every generated command wrapper. */
export type Result<T, E> = { status: "ok"; data: T } | { status: "error"; error: E };

/** Thrown by {@link unwrap} so callers can catch a typed error. */
export class CommandError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(`${error.kind}: ${error.message}`);
    this.name = "CommandError";
    this.error = error;
  }
}

/** Turns a tauri-specta `Result` into a value or a thrown {@link CommandError}. */
export async function unwrap<T>(promise: Promise<Result<T, AppError>>): Promise<T> {
  const result = await promise;
  if (result.status === "ok") return result.data;
  throw new CommandError(result.error);
}

/** Best-effort message for anything thrown while calling into Rust. */
export function errorMessage(error: unknown): string {
  if (error instanceof CommandError) return error.error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorKind(error: unknown): AppError["kind"] | "unknown" {
  return error instanceof CommandError ? error.error.kind : "unknown";
}
