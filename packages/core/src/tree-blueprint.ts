/**
 * Tree Blueprint — Zod schema + YAML parser for lore.tree.yaml
 * Defines the structural blueprint for a corpus document tree.
 * Spec: TECH-01KV4W88GZF74B98BHCBBV9GHD §3.2, §3.3
 *
 * Uses explicit three-param ZodType<Output, Def, Input> with a cast to
 * separate the "after-defaults" output shape from the "before-defaults" input
 * shape. This prevents tsc from OOM-looping on recursive type normalization —
 * the cast is safe because the Zod schema's runtime behaviour produces
 * TreeNodeSpec (all required fields filled by defaults).
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

// Input shape is intentionally looser than TreeNodeSpec — Zod fills defaults.
interface TreeNodeSpecInput {
  type: DocType;
  slug?: string;
  min?: number;
  max?: number | null;
  children?: TreeNodeSpecInput[];
}

// The cast via `unknown` is required because TypeScript cannot terminate
// recursive type normalization for z.lazy + z.object + superRefine chains.
// Runtime correctness is guaranteed: Zod applies .default() at parse time,
// so the parsed output always satisfies TreeNodeSpec (all fields required).
const treeNodeSpecSchema = z.lazy(() =>
  z
    .object({
      type: docTypeSchema,
      slug: z.string().optional(),
      min: z.number().int().min(0).default(0),
      max: z.number().int().positive().nullable().default(null),
      children: z.array(treeNodeSpecSchema as z.ZodType<TreeNodeSpec, z.ZodTypeDef, TreeNodeSpecInput>).default([]),
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
) as unknown as z.ZodType<TreeNodeSpec, z.ZodTypeDef, TreeNodeSpecInput>;

export const treeBlueprintSchema: z.ZodType<TreeBlueprint, z.ZodTypeDef, { version: 1; root: TreeNodeSpecInput }> =
  z.object({
    version: z.literal(1),
    root: treeNodeSpecSchema,
  }) as unknown as z.ZodType<TreeBlueprint, z.ZodTypeDef, { version: 1; root: TreeNodeSpecInput }>;

export function parseTreeBlueprint(raw: string): Result<TreeBlueprint, LoreError> {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "lore.tree.yaml",
      message: `YAML parse failed: ${(e as Error).message}`,
      rule: "BR-273",
    });
  }
  const parsed = treeBlueprintSchema.safeParse(doc);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "lore.tree.yaml",
      message: parsed.error.issues[0]?.message ?? "invalid blueprint",
      rule: "BR-273",
    });
  }
  return ok(parsed.data);
}
