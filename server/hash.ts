import { createHash } from "node:crypto";
import type { VersionSnapshot } from "./types";

/**
 * 稳定序列化：对象键按字典序排列、忽略 undefined，
 * 保证同一份快照在任何时刻序列化结果完全一致。
 */
export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
};

/**
 * 定稿快照内容哈希：对快照（供应商响应、独立评审意见、澄清记录）
 * 做规范化序列化后计算 SHA-256，任何人事后可用同一算法复算核对。
 */
export const computeSnapshotHash = (snapshot: VersionSnapshot): string =>
  createHash("sha256").update(canonicalize(snapshot), "utf8").digest("hex");
