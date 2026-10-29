import { z } from "zod";

export type DOMNode = {
  id: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DOMNode[];
  isInteractive?: boolean;
};

export const DOMNodeSchema: z.ZodType<DOMNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    tag: z.string(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    attributes: z.record(z.string()).optional(),
    children: z.array(DOMNodeSchema).optional(),
    isInteractive: z.boolean().optional(),
  })
);

export const SnapshotSchema = z.object({
  snapshotVersion: z.number().int(),
  tabId: z.number().int(),
  url: z.string().url(),
  title: z.string(),
  tree: DOMNodeSchema,
  timestamp: z.number(),
  frameId: z.number().int().default(0),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
