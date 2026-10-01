import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { GraphQLError } from "graphql";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
  createVersionId,
  reviewDataStore,
} from "./data";
import { typeDefs } from "./schema";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  DashboardStats,
  FinalizeVersionInput,
  ReviewDatabase,
  ReviewRole,
  ReviewVersion,
  RevisionConflictItem,
} from "./types";
import {
  computeVersionHash,
  findMandatoryConclusionGaps,
  HASH_ALGORITHM,
} from "./versioning";

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      response.reviews
        .filter((review) => review.decision !== "clarification")
        .map((review) => review.decision),
    );
    return decisions.size > 1;
  });
  const proofCounts = database.responses.reduce<Record<string, number>>(
    (counts, response) => {
      if (response.proofFingerprint) {
        counts[response.proofFingerprint] =
          (counts[response.proofFingerprint] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const activeVersion =
    database.versions.find((version) => version.status === "draft") ??
    database.versions[0];

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: database.responses.filter(
      (response) => response.reviews.length < 2,
    ).length,
    differences: opinionsByResponse.filter(Boolean).length,
    overdueClarifications: database.responses.reduce(
      (count, response) =>
        count +
        response.clarifications.filter(
          (clarification) => clarification.status === "overdue",
        ).length,
      0,
    ),
    reusedProofs: Object.values(proofCounts).filter((count) => count > 1)
      .length,
    activeVersion: activeVersion
      ? `${activeVersion.version} ${activeVersion.label}`
      : "未建立版本",
  };
};

const requireRole = (role: ReviewRole, allowed: ReviewRole[]): void => {
  if (!allowed.includes(role)) {
    throw new Error("当前角色无权执行此操作。");
  }
};

interface MutationSuccess<T> {
  kind: "ok";
  value: T;
}

interface MutationConflict {
  kind: "conflict";
  currentRevision: number;
  conflicts: RevisionConflictItem[];
}

type MutationOutcome<T> = MutationSuccess<T> | MutationConflict;

interface AppliedChange<T> {
  value: T;
  detail: string;
  entity?: string;
}

const MAX_CONFLICT_ITEMS = 20;

/**
 * 修订号守卫：
 * - baseRevision 与当前工作修订号一致：直接落库并推进修订号；
 * - baseRevision 对应已定稿修订号：属于定稿期间晚到的提交，不允许改写
 *   冻结版本，并入当前（下一）工作版并补写审计；
 * - 其余不一致：判定为并发冲突，保留尝试与冲突清单后拒绝，由客户端
 *   基于最新修订号重发。
 */
const applyWithRevision = <T>(
  database: ReviewDatabase,
  actor: string,
  action: string,
  entity: string,
  baseRevision: number,
  apply: () => AppliedChange<T>,
): MutationOutcome<T> => {
  if (baseRevision === database.currentRevision) {
    const applied = apply();
    database.currentRevision += 1;
    createAudit(
      database,
      actor,
      action,
      applied.entity ?? entity,
      applied.detail,
      database.currentRevision,
    );
    return { kind: "ok", value: applied.value };
  }
  const baseFinalized = database.versions.some(
    (version) =>
      version.status === "finalized" && version.revision === baseRevision,
  );
  if (baseFinalized && baseRevision < database.currentRevision) {
    const applied = apply();
    database.currentRevision += 1;
    createAudit(
      database,
      actor,
      action,
      applied.entity ?? entity,
      applied.detail,
      database.currentRevision,
    );
    createAudit(
      database,
      actor,
      "晚到提交并入工作版",
      applied.entity ?? entity,
      `该提交基于已定稿的修订号 ${baseRevision}，未改写冻结版本，已并入当前工作修订号 ${database.currentRevision}。`,
      database.currentRevision,
    );
    return { kind: "ok", value: applied.value };
  }
  const conflicts = database.auditLogs
    .filter(
      (log) => log.revision > baseRevision && log.action !== "提交冲突拦截",
    )
    .slice(0, MAX_CONFLICT_ITEMS)
    .map((log) => ({
      revision: log.revision,
      at: log.at,
      actor: log.actor,
      action: log.action,
      entity: log.entity,
      detail: log.detail,
    }));
  createAudit(
    database,
    actor,
    "提交冲突拦截",
    entity,
    `基于修订号 ${baseRevision} 的「${action}」与当前工作修订号 ${database.currentRevision} 冲突（其间 ${conflicts.length} 项变更），已保留尝试，可基于最新修订号重发。`,
    database.currentRevision,
  );
  return {
    kind: "conflict",
    currentRevision: database.currentRevision,
    conflicts,
  };
};

const unwrapOutcome = <T>(outcome: MutationOutcome<T>): T => {
  if (outcome.kind === "conflict") {
    throw new GraphQLError(
      `提交基于的修订号已被推进，与当前工作修订号 ${outcome.currentRevision} 冲突，请基于最新修订号重发。`,
      {
        extensions: {
          code: "REVISION_CONFLICT",
          currentRevision: outcome.currentRevision,
          conflicts: outcome.conflicts,
        },
      },
    );
  }
  return outcome.value;
};

const resolvers = {
  Query: {
    workspace: () => {
      const database = reviewDataStore.snapshot();
      return {
        ...database,
        dashboard: getDashboard(database),
      };
    },
    dashboard: () => getDashboard(reviewDataStore.snapshot()),
    verifyVersionHash: (
      _parent: unknown,
      { versionId }: { versionId: string },
    ) => {
      const database = reviewDataStore.snapshot();
      const version = database.versions.find(
        (item) => item.id === versionId,
      );
      if (!version) {
        throw new Error("评审版本不存在。");
      }
      if (!version.snapshot) {
        throw new Error("该版本尚未定稿，没有可复算的冻结快照。");
      }
      const recomputedHash = computeVersionHash(
        version.revision,
        version.snapshot.responses,
      );
      return {
        versionId: version.id,
        revision: version.revision,
        contentHash: version.contentHash,
        recomputedHash,
        matches: recomputedHash === version.contentHash,
      };
    },
  },
  Clause: {
    responses: (clause: Clause, _args: unknown, context: { database: ReviewDatabase }) =>
      context.database.responses.filter(
        (response) => response.clauseId === clause.id,
      ),
  },
  Mutation: {
    submitAssessment: (
      _parent: unknown,
      { input }: { input: AssessmentInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      if (input.comment.trim().length < 6) {
        throw new Error("评审意见至少需要 6 个字符。");
      }
      const reviewer = input.reviewer.trim();
      const outcome = reviewDataStore.mutate((database) =>
        applyWithRevision(
          database,
          reviewer,
          "提交独立意见",
          input.responseId,
          input.baseRevision,
          () => {
            const response = database.responses.find(
              (item) => item.id === input.responseId,
            );
            if (!response) {
              throw new Error("供应商响应不存在。");
            }
            const clause = database.clauses.find(
              (item) => item.id === response.clauseId,
            );
            if (!clause) {
              throw new Error("对应技术条款不存在。");
            }
            if (input.score < 0 || input.score > clause.weight) {
              throw new Error(`评分必须在 0 至 ${clause.weight} 之间。`);
            }
            if (
              clause.type === "scoring" &&
              input.decision === "compliant" &&
              input.score === 0
            ) {
              throw new Error("评分项判定为符合时必须填写评分。");
            }
            const opinion = {
              id: createOpinionId(),
              responseId: response.id,
              reviewer,
              role: input.role,
              decision: input.decision,
              score: input.score,
              comment: input.comment.trim(),
              createdAt: new Date().toISOString(),
            };
            response.reviews.push(opinion);
            response.status = input.decision;
            response.reviewRound = Math.max(response.reviewRound, 1);
            return {
              value: opinion,
              detail: `${clause.code} ${clause.title} 判定为 ${input.decision}，评分 ${input.score}。`,
            };
          },
        ),
      );
      return unwrapOutcome(outcome);
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) => {
      if (input.requestText.trim().length < 6) {
        throw new Error("澄清要求至少需要 6 个字符。");
      }
      const outcome = reviewDataStore.mutate((database) =>
        applyWithRevision(
          database,
          input.actor,
          "发起澄清",
          input.responseId,
          input.baseRevision,
          () => {
            const response = database.responses.find(
              (item) => item.id === input.responseId,
            );
            if (!response) {
              throw new Error("供应商响应不存在。");
            }
            const requestedAt = new Date();
            const dueAt = new Date(input.dueAt);
            if (Number.isNaN(dueAt.getTime()) || dueAt <= requestedAt) {
              throw new Error("澄清截止时间必须晚于当前时间。");
            }
            const maximumDueAt = new Date(requestedAt);
            maximumDueAt.setDate(maximumDueAt.getDate() + 7);
            if (dueAt > maximumDueAt) {
              throw new Error("澄清期限不得超过 7 个自然日。");
            }
            const round =
              Math.max(
                0,
                ...response.clarifications.map((item) => item.round),
              ) + 1;
            const clarification = {
              id: createClarificationId(),
              responseId: response.id,
              clauseId: response.clauseId,
              round,
              requestText: input.requestText.trim(),
              requestedAt: requestedAt.toISOString(),
              dueAt: dueAt.toISOString(),
              status: "open" as const,
            };
            response.clarifications.push(clarification);
            response.status = "clarification";
            return {
              value: clarification,
              entity: clarification.id,
              detail: `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起。`,
            };
          },
        ),
      );
      return unwrapOutcome(outcome);
    },
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) => {
      if (input.responseText.trim().length < 6) {
        throw new Error("澄清回复至少需要 6 个字符。");
      }
      const outcome = reviewDataStore.mutate((database) =>
        applyWithRevision(
          database,
          input.actor,
          "回复澄清",
          input.clarificationId,
          input.baseRevision,
          () => {
            const clarification = database.responses
              .flatMap((response) => response.clarifications)
              .find((item) => item.id === input.clarificationId);
            if (!clarification) {
              throw new Error("澄清记录不存在。");
            }
            clarification.supplierResponse = input.responseText.trim();
            clarification.respondedAt = new Date().toISOString();
            clarification.status = "responded";
            const response = database.responses.find(
              (item) => item.id === clarification.responseId,
            );
            if (response) {
              response.status = "pending";
            }
            return {
              value: clarification,
              detail: `第 ${clarification.round} 轮澄清已回复，等待评审员复核。`,
            };
          },
        ),
      );
      return unwrapOutcome(outcome);
    },
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["chair"]);
        if (input.label.trim().length < 4) {
          throw new Error("版本名称至少需要 4 个字符。");
        }
        const blockingClarifications = database.responses
          .flatMap((response) => response.clarifications)
          .filter(
            (clarification) =>
              clarification.status === "open" ||
              clarification.status === "overdue",
          );
        if (blockingClarifications.length > 0) {
          throw new Error(
            `仍有 ${blockingClarifications.length} 项未完成澄清，不能定稿。`,
          );
        }
        const mandatoryGaps = findMandatoryConclusionGaps(database);
        if (mandatoryGaps.length > 0) {
          const preview = mandatoryGaps
            .slice(0, 5)
            .map(
              (gap) =>
                `${gap.clauseCode}·${gap.supplierName}（${gap.conclusions}/2 名结论）`,
            )
            .join("、");
          throw new Error(
            `否决项须两名评审员给出结论，仍缺 ${mandatoryGaps.length} 项：${preview}${mandatoryGaps.length > 5 ? " 等" : ""}。`,
          );
        }
        const revision = database.currentRevision;
        const snapshotResponses = structuredClone(database.responses);
        const contentHash = computeVersionHash(revision, snapshotResponses);
        const now = new Date().toISOString();
        const draft = database.versions.find(
          (version) => version.status === "draft",
        );
        const nextNumber =
          database.versions.reduce((maximum, version) => {
            const numeric = Number(version.version.replace(/\D/g, ""));
            return Number.isFinite(numeric)
              ? Math.max(maximum, numeric)
              : maximum;
          }, 0) + 1;
        const finalized: ReviewVersion = {
          id: draft?.id ?? createVersionId(),
          version: draft?.version ?? `V${nextNumber}`,
          label: input.label.trim(),
          status: "finalized",
          revision,
          createdAt: now,
          createdBy: input.actor,
          signedBy: [input.actor],
          clauseCount: database.clauses.length,
          responseCount: database.responses.length,
          hashAlgorithm: HASH_ALGORITHM,
          contentHash,
          snapshot: {
            frozenAt: now,
            responses: snapshotResponses,
          },
        };
        if (draft) {
          Object.assign(draft, finalized);
        } else {
          database.versions.unshift(finalized);
        }
        database.currentRevision += 1;
        const finalizedNumber = Number(finalized.version.replace(/\D/g, ""));
        const working: ReviewVersion = {
          id: createVersionId(),
          version: `V${Math.max(nextNumber, finalizedNumber + 1)}`,
          label: "后续评审工作版",
          status: "draft",
          revision: database.currentRevision,
          createdAt: now,
          createdBy: input.actor,
          signedBy: [],
          clauseCount: database.clauses.length,
          responseCount: database.responses.length,
          hashAlgorithm: "",
          contentHash: "",
        };
        database.versions.unshift(working);
        createAudit(
          database,
          input.actor,
          "汇总签字定稿",
          finalized.id,
          `${finalized.version}（修订号 ${revision}）已按当前修订号定稿：冻结 ${snapshotResponses.length} 项供应商响应、独立评审意见与澄清记录快照，内容哈希 ${HASH_ALGORITHM}:${contentHash.slice(0, 12)}…，签署人 ${input.actor}；晚到提交进入 ${working.version} 工作版。`,
          database.currentRevision,
        );
        return finalized;
      }),
    resetReviewData: () => {
      reviewDataStore.reset();
      return true;
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer(): Promise<void> {
  const { url } = await startStandaloneServer(server, {
    listen: { port: 18462, host: "0.0.0.0" },
    context: async () => ({
      database: reviewDataStore.snapshot(),
    }),
  });
  console.log(`GraphQL mock server ready at ${url}`);
}

void startServer();
