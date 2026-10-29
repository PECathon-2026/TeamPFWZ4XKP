import { z } from "zod";

export const ActionTypeSchema = z.enum([
  "click",
  "type",
  "select",
  "scroll",
  "navigate",
  "wait",
  "ask_user",
  "done",
  "fail",
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export const RiskTierSchema = z.enum(["tier0", "tier1", "tier2", "tier3"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  targetId: z.string().optional(),
  value: z.string().optional(),
  secretRef: z.string().optional(),
  direction: z.enum(["up", "down"]).optional(),
  url: z.string().url().optional(),
  prompt: z.string().optional(),
  reason: z.string().optional(),
});

export type Action = z.infer<typeof ActionSchema>;

export const ElementFingerprintSchema = z.object({
  targetId: z.string(),
  tagName: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  formAction: z.string().optional(),
  formMethod: z.string().optional(),
  siblingIndex: z.number().int().optional(),
  textHash: z.string(),
});

export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;

export const ApprovalRequestSchema = z.object({
  action: ActionSchema,
  fingerprint: ElementFingerprintSchema,
  actionHash: z.string(),
  tabId: z.number().int(),
  pageOrigin: z.string(),
  explanation: z.string(),
  timestamp: z.number(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  actionHash: z.string(),
  decision: z.enum(["approved", "denied"]),
  approvalToken: z.string().optional(),
  timestamp: z.number(),
});

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

