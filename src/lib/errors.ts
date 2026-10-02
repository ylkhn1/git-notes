import type { AppError } from "@/lib/bindings";

/** Human-readable text for an `AppError` coming from the Rust side. */
export function describeError(error: AppError): string {
  return `${error.kind}: ${error.message}`;
}
