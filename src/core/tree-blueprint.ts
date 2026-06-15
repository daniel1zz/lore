/**
 * Tree Blueprint — Zod schema + YAML parser for lore.tree.yaml
 * Defines the structural blueprint for a corpus document tree.
 * Source: TECH-01KV4W88GZF74B98BHCBBV9GHD §3.2 + §3.3
 */

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { docTypeSchema } from "./schemas.js";
import { err, ok, type LoreError, type Result } from "./errors.js";
import type { DocType } from "./types.js";

export interface TreeNodeSpec {
  type: DocType;
  slug?: string;
  min: number;
  max: number | null;
  children: TreeNodeSpec[];
}

export interface TreeBlueprint {
  version: 1;
  root: TreeNodeSpec;
}

const treeNodeSpecSchema: z.ZodType<TreeNodeSpec> = z.lazy(() =>
  z
    .object({
      type: docTypeSchema,
      slug: z.string().optional(),
      min: z.number().int().min(0).default(0),
      max: z.number().int().positive().nullable().default(null),
      children: z.array(treeNodeSpecSchema).default([]),
    })
    .superRefine((node, ctx) => {
      if (node.max !== null && node.max < node.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `max (${node.max}) must be >= min (${node.min})`,
          path: ["max"],
        });
      }
    }),
);

export const treeBlueprintSchema = z.object({
  version: z.literal(1),
  root: treeNodeSpecSchema,
});

export function parseTreeBlueprint(raw: string): Result<TreeBlueprint, LoreError> {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "lore.tree.yaml",
      message: `YAML parse failed: ${(e as Error).message}`,
    });
  }
  const parsed = treeBlueprintSchema.safeParse(doc);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "lore.tree.yaml",
      message: parsed.error.issues[0]?.message ?? "invalid blueprint",
    });
  }
  return ok(parsed.data);
}
