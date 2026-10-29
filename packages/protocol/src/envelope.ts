import { z } from "zod";
import { DOMNodeSchema } from "./dom.js";
import { ActionSchema } from "./action.js";

export const SecretMetadataSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type SecretMetadata = z.infer<typeof SecretMetadataSchema>;

export const EnvelopeSchema = z.object({
  requestId: z.string().uuid(),
  task: z.string().min(1),
  snapshotVersion: z.number().int(),
  snapshot: DOMNodeSchema,
  availableSecrets: z.array(SecretMetadataSchema).default([]),
  redactionLedger: z.record(z.string(), z.number()).default({}),
  timestamp: z.number(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export const StepResponseSchema = z.object({
  action: ActionSchema,
  note: z.string().optional(),
  usage: z.object({
    inputTokens: z.number().int().default(0),
    outputTokens: z.number().int().default(0),
  }),
  requestId: z.string(),
});

export type StepResponse = z.infer<typeof StepResponseSchema>;

export const StepErrorSchema = z.object({
  code: z.enum([
    "BAD_SCHEMA",
    "UNAUTHENTICATED",
    "TOO_LARGE",
    "SENSITIVE_DETECTED",
    "BAD_MODEL_OUTPUT",
    "RATE_LIMITED",
    "BUDGET_EXCEEDED",
    "PROVIDER_ERROR",
    "PROVIDER_TIMEOUT",
    "GATE_BLOCKED",
    "FINGERPRINT_MISMATCH",
    "ACTION_REJECTED",
  ]),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});

export type StepError = z.infer<typeof StepErrorSchema>;

