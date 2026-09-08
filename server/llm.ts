import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Env } from "./util";

export const DEFAULT_MODEL = "claude-opus-5";

export function modelFor(env: Env): string {
  return env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function llmAvailable(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function client(env: Env): Anthropic {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey });
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

const usageOf = (u: { input_tokens?: number; output_tokens?: number } | undefined): Usage => ({
  input_tokens: u?.input_tokens ?? 0,
  output_tokens: u?.output_tokens ?? 0,
});

/**
 * Structured extraction. Used by the analysis stages, where we need a schema-shaped
 * result rather than prose. Structured outputs cannot be combined with citations,
 * so grounding here is enforced afterwards by verifying every returned quote
 * verbatim against the source text.
 */
export async function extract<T extends z.ZodTypeAny>(
  env: Env,
  args: { system: string; user: string; schema: T; maxTokens?: number; effort?: "low" | "medium" | "high" },
): Promise<{ data: z.infer<T>; usage: Usage }> {
  const response = await client(env).messages.parse({
    model: modelFor(env),
    max_tokens: args.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: args.effort ?? "medium",
      format: zodOutputFormat(args.schema as z.ZodTypeAny),
    },
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined the request (${response.stop_details?.category ?? "unspecified"})`);
  }
  if (response.parsed_output == null) {
    throw new Error("Model returned no parseable structured output");
  }
  return { data: response.parsed_output as z.infer<T>, usage: usageOf(response.usage) };
}

/** A document handed to the model for grounded generation, with citations enabled. */
export interface GroundingDocument {
  title: string;
  content: string;
}

export interface CitedSpan {
  text: string;
  citations: { document_index: number; document_title: string; cited_text: string; start: number; end: number }[];
}

/**
 * Grounded generation. Evidence is passed as `document` blocks with citations
 * enabled, so every cited claim carries an exact character range back into the
 * evidence pack — which is how a claim in the draft report is traced to a finding.
 */
export async function generateGrounded(
  env: Env,
  args: { system: string; instruction: string; documents: GroundingDocument[]; maxTokens?: number },
): Promise<{ spans: CitedSpan[]; text: string; usage: Usage }> {
  const documents = args.documents.map((d) => ({
    type: "document" as const,
    title: d.title,
    source: { type: "text" as const, media_type: "text/plain" as const, data: d.content },
    citations: { enabled: true },
  }));

  const stream = client(env).messages.stream({
    model: modelFor(env),
    max_tokens: args.maxTokens ?? 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: args.system,
    messages: [{ role: "user", content: [...documents, { type: "text", text: args.instruction }] }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined the request (${response.stop_details?.category ?? "unspecified"})`);
  }

  const spans: CitedSpan[] = [];
  for (const block of response.content) {
    if (block.type !== "text") continue;
    const citations = (block.citations ?? []).flatMap((c) => {
      if (c.type !== "char_location") return [];
      return [{
        document_index: c.document_index,
        document_title: c.document_title ?? "",
        cited_text: c.cited_text,
        start: c.start_char_index,
        end: c.end_char_index,
      }];
    });
    spans.push({ text: block.text, citations });
  }
  return { spans, text: spans.map((s) => s.text).join(""), usage: usageOf(response.usage) };
}
