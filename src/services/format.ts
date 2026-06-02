/**
 * Shared formatting utilities: a standard tool-result builder, character-limit
 * truncation, and small markdown helpers used across tools.
 */

import { CHARACTER_LIMIT } from "../constants.js";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Build a successful tool result with both text + structured content. */
export function toolResult(
  text: string,
  structured?: Record<string, unknown>
): ToolResult {
  const trimmed = truncate(text);
  return {
    content: [{ type: "text", text: trimmed }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Build an error tool result (no throw — errors are reported in-band). */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: truncate(text) }], isError: true };
}

/** Truncate overly long text with a clear note. */
export function truncate(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n\n…[truncated ${text.length - limit} characters. ` +
    `Narrow your request or use response_format='json' with filters.]`
  );
}

export function kv(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return `- **${label}:** ${value}`;
}

/** Join non-null lines. */
export function lines(...items: (string | null)[]): string {
  return items.filter((x): x is string => x !== null).join("\n");
}
