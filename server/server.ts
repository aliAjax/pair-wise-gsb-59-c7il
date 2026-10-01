import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { GraphQLError } from "graphql";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
  reviewDataStore,
} from "./data";
import { computeSnapshotHash } from "./hash";
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
} from "./types";

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

/** 当前工作版标识，用于在审计中标注晚到提交的去向。 */
const workingVersionNote = (database: ReviewDatabase): string => {
  const draft = database.versions.find(
    (version) => version.status === "draft",
  );
  return draft
    ? `该变更记入 ${draft.version} 工作版（修订号 r${database.revision}），不回写已定稿版本。`
    : "";
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
        throw new Error("该版本尚未定稿，没有可复算的快照。");
      }
      const recomputedHash = computeSnapshotHash(version.snapshot);
      return {
        versionId: version.id,
        storedHash: version.contentHash,
        recomputedHash,
        matches: recomputedHash === version.contentHash,
        snapshotRevision: version.snapshot.revision,
        snapshotTakenAt: version.snapshot.takenAt,
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
      return reviewDataStore.mutate((database) => {
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
          reviewer: input.reviewer.trim(),
          role: input.role,
          decision: input.decision,
          score: input.score,
          comment: input.comment.trim(),
          createdAt: new Date().toISOString(),
        };
        response.reviews.push(opinion);
        response.status = input.decision;
        response.reviewRound = Math.max(response.reviewRound, 1);
        createAudit(
          database,
          opinion.reviewer,
          "提交独立意见",
          response.id,
          `${clause.code} ${clause.title} 判定为 ${input.decision}，评分 ${input.score}。${workingVersionNote(database)}`,
        );
        return opinion;
      });
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        if (input.requestText.trim().length < 6) {
          throw new Error("澄清要求至少需要 6 个字符。");
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
        createAudit(
          database,
          input.actor,
          "发起澄清",
          clarification.id,
          `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起。${workingVersionNote(database)}`,
        );
        return clarification;
      }),
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const clarification = database.responses
          .flatMap((response) => response.clarifications)
          .find((item) => item.id === input.clarificationId);
        if (!clarification) {
          throw new Error("澄清记录不存在。");
        }
        if (input.responseText.trim().length < 6) {
          throw new Error("澄清回复至少需要 6 个字符。");
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
        createAudit(
          database,
          input.actor,
          "回复澄清",
          clarification.id,
          `第 ${clarification.round} 轮澄清已回复，等待评审员复核。${workingVersionNote(database)}`,
        );
        return clarification;
      }),
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) => {
      requireRole(input.role, ["chair"]);
      if (input.label.trim().length < 4) {
        throw new Error("版本名称至少需要 4 个字符。");
      }
      const result = reviewDataStore.finalize({
        label: input.label.trim(),
        actor: input.actor,
        baseRevision: input.baseRevision,
      });
      if (result.status === "conflict") {
        throw new GraphQLError(
          `定稿与最新修订号冲突：本次基于 r${result.attempt.baseRevision}，当前已为 r${result.attempt.currentRevision}，${result.attempt.conflicts.length} 项变更先到。尝试已保留，请基于最新修订号重发。`,
          {
            extensions: {
              code: "VERSION_CONFLICT",
              attemptId: result.attempt.id,
              currentRevision: result.attempt.currentRevision,
            },
          },
        );
      }
      return result.version;
    },
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
