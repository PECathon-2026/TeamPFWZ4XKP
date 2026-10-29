import { z } from "zod";
import { ActionSchema, RiskTierSchema } from "./action.js";

export const RunStatusSchema = z.enum([
  "idle",
  "snapshotting",
  "sanitizing",
  "gate_check",
  "thinking",
  "validating",
  "awaiting_approval",
  "executing",
  "blocked",
  "failed",
  "done",
  "stopped",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepLogEntrySchema = z.object({
  stepNumber: z.number().int(),
  snapshotVersion: z.number().int(),
  status: RunStatusSchema,
  action: ActionSchema.optional(),
  tier: RiskTierSchema.optional(),
  gateVerdict: z.enum(["allowed", "blocked"]).optional(),
  redactionCounts: z.record(z.string(), z.number()).default({}),
  executionResult: z
    .object({
      ok: z.boolean(),
      reasonCode: z.string().optional(),
    })
    .optional(),
  durationMs: z.number().optional(),
  timestamp: z.number(),
});

export type StepLogEntry = z.infer<typeof StepLogEntrySchema>;

export const ExtensionMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("START"),
    task: z.string(),
    mode: z.enum(["dom_only", "hybrid", "local_only"]).default("dom_only"),
  }),
  z.object({
    type: z.literal("STOP"),
  }),
  z.object({
    type: z.literal("SNAPSHOT"),
    snapshotVersion: z.number().int(),
  }),
  z.object({
    type: z.literal("SNAPSHOT_RESULT"),
    snapshotVersion: z.number().int(),
    rawTree: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("EXECUTE"),
    action: ActionSchema,
    fingerprint: z.record(z.unknown()),
    approvalToken: z.string().optional(),
    vaultSecretValue: z.string().optional(),
  }),
  z.object({
    type: z.literal("EXECUTE_RESULT"),
    ok: z.boolean(),
    reasonCode: z.string().optional(),
  }),
  z.object({
    type: z.literal("APPROVAL_DECISION"),
    actionHash: z.string(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("STATE_UPDATE"),
    status: RunStatusSchema,
    step: z.number().int(),
    totalSteps: z.number().int(),
    logs: z.array(StepLogEntrySchema),
  }),
]);

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

