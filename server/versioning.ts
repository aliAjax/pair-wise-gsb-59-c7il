import { createHash } from "node:crypto";
import type { Clause, ReviewDatabase, SupplierResponse } from "./types";

export const HASH_ALGORITHM = "sha256";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalize(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

/**
 * 定稿哈希只由「修订号 + 冻结数据批」决定：同一份快照在任何时刻
 * 重算都会得到同一个哈希，因此可以用哈希反查定稿时使用的是哪批数据。
 */
export const computeVersionHash = (
  revision: number,
  responses: SupplierResponse[],
): string =>
  createHash(HASH_ALGORITHM)
    .update(canonicalJson({ revision, responses }))
    .digest("hex");

const CONCLUDING_DECISIONS = new Set(["compliant", "deviation"]);

/** 结论指「符合 / 偏离」；待澄清不算结论。 */
export const countConcludingReviewers = (
  response: SupplierResponse,
): number =>
  new Set(
    response.reviews
      .filter((review) => CONCLUDING_DECISIONS.has(review.decision))
      .map((review) => review.reviewer),
  ).size;

export interface MandatoryConclusionGap {
  responseId: string;
  clauseCode: string;
  clauseTitle: string;
  supplierName: string;
  conclusions: number;
}

/** 否决项（mandatory）必须凑齐两名评审员结论才允许定稿。 */
export const findMandatoryConclusionGaps = (
  database: ReviewDatabase,
): MandatoryConclusionGap[] => {
  const clauseById = new Map<string, Clause>(
    database.clauses.map((clause) => [clause.id, clause]),
  );
  return database.responses
    .map((response) => ({ response, clause: clauseById.get(response.clauseId) }))
    .filter(
      (entry): entry is { response: SupplierResponse; clause: Clause } =>
        entry.clause?.type === "mandatory",
    )
    .map(({ response, clause }) => ({
      responseId: response.id,
      clauseCode: clause.code,
      clauseTitle: clause.title,
      supplierName: response.supplierName,
      conclusions: countConcludingReviewers(response),
    }))
    .filter((entry) => entry.conclusions < 2);
};
