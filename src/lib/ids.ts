import { randomUUID } from "node:crypto";

/**
 * Readable unique IDs: a short prefix tells you what kind of record it is.
 *   chr_… character   ast_… media asset   job_… generation job
 *   prj_… project     scn_… scene         ref_… character reference
 */
export type IdPrefix = "chr" | "ast" | "job" | "prj" | "scn" | "ref" | "apr" | "evt";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
