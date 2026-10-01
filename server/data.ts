import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditLog,
  Clarification,
  Clause,
  ComplianceStatus,
  ReviewDatabase,
  ReviewRole,
  ReviewVersion,
  ReviewerOpinion,
  SupplierResponse,
} from "./types";
import { computeVersionHash, HASH_ALGORITHM } from "./versioning";

const clauses: Clause[] = [
  {
    id: "C001",
    code: "A.1",
    title: "实施组织与项目计划",
    category: "实施能力",
    requirement:
      "投标人应明确项目组织、职责界面、实施方法、进度控制和风险应对机制。",
    type: "mandatory",
    weight: 0,
    evidenceRequired: true,
    order: 1,
  },
  {
    id: "C002",
    code: "A.1.1",
    title: "项目经理及关键人员",
    category: "实施能力",
    requirement:
      "项目经理应具备五年以上同类项目经验，关键人员配置应覆盖架构、开发、测试与安全。",
    type: "mandatory",
    weight: 0,
    parentId: "C001",
    evidenceRequired: true,
    order: 2,
  },
  {
    id: "C003",
    code: "A.1.2",
    title: "实施进度与里程碑",
    category: "实施能力",
    requirement:
      "提供可核验的里程碑、交付物、验收条件和资源投入计划。",
    type: "scoring",
    weight: 15,
    parentId: "C001",
    evidenceRequired: false,
    order: 3,
  },
  {
    id: "C004",
    code: "B.1",
    title: "技术架构与互操作性",
    category: "技术方案",
    requirement:
      "系统架构应支持模块化部署、横向扩展，并与采购人现有平台实现稳定互操作。",
    type: "scoring",
    weight: 25,
    evidenceRequired: true,
    order: 4,
  },
  {
    id: "C005",
    code: "B.1.1",
    title: "接口开放与标准协议",
    category: "技术方案",
    requirement:
      "对外接口应遵循 HTTPS、OAuth 2.0 和 OpenAPI 3.x，提供版本兼容与错误码说明。",
    type: "mandatory",
    weight: 0,
    parentId: "C004",
    evidenceRequired: true,
    order: 5,
  },
  {
    id: "C006",
    code: "B.1.2",
    title: "国产化兼容性",
    category: "技术方案",
    requirement:
      "提供操作系统、数据库、中间件及浏览器兼容性矩阵，并说明适配边界。",
    type: "scoring",
    weight: 15,
    parentId: "C004",
    evidenceRequired: true,
    order: 6,
  },
  {
    id: "C007",
    code: "C.1",
    title: "安全保障",
    category: "安全与合规",
    requirement:
      "技术方案应覆盖身份鉴别、访问控制、审计、数据保护和安全运维。",
    type: "mandatory",
    weight: 0,
    evidenceRequired: true,
    order: 7,
  },
  {
    id: "C008",
    code: "C.1.1",
    title: "等级保护三级证明材料",
    category: "安全与合规",
    requirement:
      "提供有效的网络安全等级保护三级备案证明或第三方测评结论。",
    type: "evidence",
    weight: 0,
    parentId: "C007",
    evidenceRequired: true,
    order: 8,
  },
  {
    id: "C009",
    code: "C.1.2",
    title: "漏洞响应机制",
    category: "安全与合规",
    requirement:
      "说明漏洞发现、分级、修复、复测和重大事件通报时限。",
    type: "scoring",
    weight: 15,
    parentId: "C007",
    evidenceRequired: false,
    order: 9,
  },
  {
    id: "C010",
    code: "D.1",
    title: "服务与培训",
    category: "服务保障",
    requirement:
      "提供驻场、巡检、培训、知识转移和故障升级的服务方案及量化响应指标。",
    type: "scoring",
    weight: 20,
    evidenceRequired: false,
    order: 10,
  },
  {
    id: "C011",
    code: "D.2",
    title: "验收指标",
    category: "服务保障",
    requirement:
      "验收指标应可测量、可复现，并与采购需求中的服务水平保持一致。",
    type: "mandatory",
    weight: 0,
    evidenceRequired: true,
    order: 11,
  },
];

const suppliers = [
  { id: "SUP-A", name: "华云数科" },
  { id: "SUP-B", name: "北辰信息" },
  { id: "SUP-C", name: "南岭科技" },
];

const responseOverrides: Record<
  string,
  Partial<
    Pick<
      SupplierResponse,
      "status" | "claimedScore" | "attachmentName" | "proofFingerprint"
    >
  >
> = {
  "C001-SUP-A": {
    status: "compliant",
    claimedScore: 0,
    attachmentName: "项目组织方案.pdf",
    proofFingerprint: "PROOF-PLAN-A",
  },
  "C001-SUP-B": {
    status: "compliant",
    claimedScore: 0,
    attachmentName: "实施组织与计划.pdf",
    proofFingerprint: "PROOF-PLAN-B",
  },
  "C001-SUP-C": {
    status: "clarification",
    claimedScore: 0,
    attachmentName: "项目管理说明.pdf",
    proofFingerprint: "PROOF-PLAN-C",
  },
  "C005-SUP-A": {
    status: "compliant",
    claimedScore: 0,
    attachmentName: "安全测评报告.pdf",
    proofFingerprint: "PROOF-SEC-CERT-2026",
  },
  "C005-SUP-B": {
    status: "deviation",
    claimedScore: 0,
    attachmentName: "接口兼容说明.pdf",
    proofFingerprint: "PROOF-API-B",
  },
  "C008-SUP-A": {
    status: "compliant",
    claimedScore: 0,
    attachmentName: "等保三级备案证明.pdf",
    proofFingerprint: "PROOF-SEC-CERT-2026",
  },
  "C008-SUP-B": {
    status: "clarification",
    claimedScore: 0,
    attachmentName: "等保材料说明.pdf",
    proofFingerprint: "PROOF-SEC-B",
  },
  "C010-SUP-B": {
    status: "compliant",
    claimedScore: 16,
    attachmentName: "服务方案.pdf",
    proofFingerprint: "PROOF-SERVICE-B",
  },
};

const reviewFactories: Array<{
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
}> = [
  {
    responseId: "C002-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "人员履历满足年限要求，社保材料与履历能够对应。",
    createdAt: "2026-09-28T09:10:00+08:00",
  },
  {
    responseId: "C002-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "clarification",
    score: 0,
    comment: "安全负责人项目经历需补充合同页或验收证明。",
    createdAt: "2026-09-28T10:25:00+08:00",
  },
  {
    responseId: "C003-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 13,
    comment: "里程碑和交付物完整，风险缓冲充分。",
    createdAt: "2026-09-28T11:10:00+08:00",
  },
  {
    responseId: "C003-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 10,
    comment: "计划完整，但关键人员投入比例未量化。",
    createdAt: "2026-09-28T11:40:00+08:00",
  },
  {
    responseId: "C004-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 21,
    comment: "架构分层清晰，现有系统适配路径可验证。",
    createdAt: "2026-09-28T13:15:00+08:00",
  },
  {
    responseId: "C004-SUP-B",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "deviation",
    score: 15,
    comment: "高可用部署缺少跨机房切换演练记录。",
    createdAt: "2026-09-28T14:02:00+08:00",
  },
];

const mandatoryReviewComments: Record<string, { first: string; second: string }> = {
  C001: {
    first: "项目组织与职责界面描述完整，进度控制机制可执行。",
    second: "实施方法与风险应对机制复核一致，结论符合采购要求。",
  },
  C002: {
    first: "关键人员履历与社保材料一致，年限满足要求。",
    second: "人员配置覆盖架构、开发、测试与安全，结论符合。",
  },
  C005: {
    first: "接口遵循 HTTPS 与 OpenAPI 3.x，版本兼容说明完整。",
    second: "错误码与版本兼容策略复核通过，结论符合。",
  },
  C007: {
    first: "身份鉴别、访问控制与审计设计覆盖安全要求。",
    second: "数据保护与安全运维措施复核一致，结论符合。",
  },
  C011: {
    first: "验收指标可测量、可复现，与服务水平保持一致。",
    second: "指标口径与采购需求复核一致，结论符合。",
  },
};

/** 这些否决项响应只有一名评审员结论，用于演示定稿拦截。 */
const singleConclusionResponses = new Set(["C007-SUP-C", "C011-SUP-B"]);

const generatedMandatoryReviews: Array<{
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
}> = clauses
  .filter((clause) => clause.type === "mandatory")
  .flatMap((clause) => {
    const comments = mandatoryReviewComments[clause.id];
    if (!comments) {
      return [];
    }
    return suppliers.flatMap((supplier) => {
      const responseId = `${clause.id}-${supplier.id}`;
      if (reviewFactories.some((item) => item.responseId === responseId)) {
        return [];
      }
      const reviews = [
        {
          responseId,
          reviewer: "陈评审",
          role: "reviewer_a" as ReviewRole,
          decision: "compliant" as ComplianceStatus,
          score: 0,
          comment: comments.first,
          createdAt: "2026-09-28T15:20:00+08:00",
        },
      ];
      if (!singleConclusionResponses.has(responseId)) {
        reviews.push({
          responseId,
          reviewer: "李评审",
          role: "reviewer_b" as ReviewRole,
          decision: "compliant" as ComplianceStatus,
          score: 0,
          comment: comments.second,
          createdAt: "2026-09-28T16:05:00+08:00",
        });
      }
      return reviews;
    });
  });

const allReviewFactories = [...reviewFactories, ...generatedMandatoryReviews];

const clarifications: Clarification[] = [
  {
    id: "CL-001",
    responseId: "C002-SUP-A",
    clauseId: "C002",
    round: 1,
    requestText: "补充安全负责人近五年的同类项目合同页或验收证明。",
    requestedAt: "2026-09-27T09:00:00+08:00",
    dueAt: "2026-09-28T18:00:00+08:00",
    status: "overdue",
  },
  {
    id: "CL-002",
    responseId: "C008-SUP-B",
    clauseId: "C008",
    round: 1,
    requestText: "提供等保测评结论页及有效期说明。",
    requestedAt: "2026-09-28T14:30:00+08:00",
    dueAt: "2026-10-02T18:00:00+08:00",
    status: "open",
  },
  {
    id: "CL-003",
    responseId: "C009-SUP-C",
    clauseId: "C009",
    round: 2,
    requestText: "补充重大漏洞四小时通报的流程截图。",
    supplierResponse: "已补充值班表、升级路径和平台告警截图。",
    requestedAt: "2026-09-26T15:00:00+08:00",
    dueAt: "2026-09-28T18:00:00+08:00",
    respondedAt: "2026-09-27T14:20:00+08:00",
    status: "responded",
  },
];

const makeResponse = (
  clause: Clause,
  supplierIndex: number,
  clauseIndex: number,
): SupplierResponse => {
  const supplier = suppliers[supplierIndex];
  const id = `${clause.id}-${supplier.id}`;
  const defaultStatus: ComplianceStatus = clause.type === "mandatory" ? "compliant" : "pending";
  const maxScore = clause.weight;
  const scorePattern = [
    Math.round(maxScore * 0.8),
    Math.round(maxScore * 0.72),
    Math.round(maxScore * 0.64),
  ];
  const override = responseOverrides[id] ?? {};
  const base: SupplierResponse = {
    id,
    clauseId: clause.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: override.status ?? defaultStatus,
    responseText:
      clause.type === "mandatory"
        ? `${supplier.name}已按采购要求提交说明与支持材料。`
        : `${supplier.name}提交响应正文，并声明可满足条款要求，分值依据需评审员复核。`,
    claimedScore: override.claimedScore ?? scorePattern[supplierIndex] ?? 0,
    attachmentName:
      override.attachmentName ?? `${supplier.name}-${clause.code}-证明材料.pdf`,
    proofFingerprint:
      override.proofFingerprint ?? `PROOF-${clause.id}-${supplier.id}`,
    submittedBy: `${supplier.name}投标专员`,
    submittedAt: `2026-09-${String(22 + ((clauseIndex + supplierIndex) % 4)).padStart(2, "0")}T16:20:00+08:00`,
    reviewRound: 1,
    reviews: [],
    clarifications: [],
  };
  base.reviews = allReviewFactories
    .filter((item) => item.responseId === id)
    .map((item, index) => ({
      id: `OP-${id}-${index + 1}`,
      ...item,
    }));
  base.clarifications = clarifications.filter((item) => item.responseId === id);
  return base;
};

const responses: SupplierResponse[] = clauses.flatMap((clause, clauseIndex) =>
  suppliers.map((_supplier, supplierIndex) =>
    makeResponse(clause, supplierIndex, clauseIndex),
  ),
);

const SEED_REVISION = 2;

const buildSeedVersions = (seedResponses: SupplierResponse[]): ReviewVersion[] => {
  // V1 定稿于评审开始前，快照中尚无独立意见与澄清记录。
  const v1SnapshotResponses = structuredClone(seedResponses).map((response) => ({
    ...response,
    reviews: [],
    clarifications: [],
  }));
  return [
    {
      id: "VER-001",
      version: "V1",
      label: "初审问题定位版本",
      status: "finalized",
      revision: 1,
      createdAt: "2026-09-25T17:30:00+08:00",
      createdBy: "采购工作组",
      signedBy: ["采购负责人", "技术评审组长"],
      clauseCount: clauses.length,
      responseCount: seedResponses.length,
      hashAlgorithm: HASH_ALGORITHM,
      contentHash: computeVersionHash(1, v1SnapshotResponses),
      snapshot: {
        frozenAt: "2026-09-25T17:30:00+08:00",
        responses: v1SnapshotResponses,
      },
    },
    {
      id: "VER-002",
      version: "V2",
      label: "澄清与评分复核工作版",
      status: "draft",
      revision: SEED_REVISION,
      createdAt: "2026-09-29T08:10:00+08:00",
      createdBy: "采购工作组",
      signedBy: [],
      clauseCount: clauses.length,
      responseCount: seedResponses.length,
      hashAlgorithm: "",
      contentHash: "",
    },
  ];
};

const auditLogs: AuditLog[] = [
  {
    id: "AUD-001",
    at: "2026-09-25T17:30:00+08:00",
    actor: "采购负责人",
    action: "版本定稿",
    entity: "VER-001",
    detail: "初审问题定位版本签署锁定，共覆盖 11 条技术条款。",
    revision: 1,
  },
  {
    id: "AUD-002",
    at: "2026-09-27T09:00:00+08:00",
    actor: "采购专员",
    action: "发起澄清",
    entity: "CL-001",
    detail: "要求华云数科补充关键人员项目经历证明。",
    revision: 2,
  },
  {
    id: "AUD-003",
    at: "2026-09-28T10:25:00+08:00",
    actor: "李评审",
    action: "提交独立意见",
    entity: "C002-SUP-A",
    detail: "建议待澄清，与陈评审的符合结论形成分歧。",
    revision: 2,
  },
  {
    id: "AUD-004",
    at: "2026-09-29T08:10:00+08:00",
    actor: "采购工作组",
    action: "创建工作版本",
    entity: "VER-002",
    detail: "创建 V2 工作版本，保留 V1 定稿快照。",
    revision: 2,
  },
];

const buildSeed = (): ReviewDatabase => {
  const seedResponses = structuredClone(responses);
  return {
    clauses: structuredClone(clauses),
    responses: seedResponses,
    versions: buildSeedVersions(seedResponses),
    auditLogs: structuredClone(auditLogs),
    suppliers: structuredClone(suppliers),
    currentRevision: SEED_REVISION,
  };
};

class ReviewDataStore {
  private readonly runtimePath = join(process.cwd(), "server", "runtime-data.json");
  private data: ReviewDatabase;

  constructor() {
    if (existsSync(this.runtimePath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(this.runtimePath, "utf8"),
        ) as ReviewDatabase;
        // 旧格式运行数据缺少修订号体系，直接按新种子重建。
        this.data = ReviewDataStore.hasRevisionShape(parsed)
          ? parsed
          : buildSeed();
      } catch {
        this.data = buildSeed();
      }
    } else {
      this.data = buildSeed();
    }
  }

  private static hasRevisionShape(data: ReviewDatabase): boolean {
    return (
      typeof data.currentRevision === "number" &&
      Array.isArray(data.versions) &&
      data.versions.every(
        (version) => typeof version.revision === "number",
      )
    );
  }

  snapshot(): ReviewDatabase {
    return structuredClone(this.data);
  }

  mutate<T>(work: (database: ReviewDatabase) => T): T {
    const result = work(this.data);
    writeFileSync(this.runtimePath, JSON.stringify(this.data, null, 2), "utf8");
    return result;
  }

  reset(): ReviewDatabase {
    this.data = buildSeed();
    writeFileSync(this.runtimePath, JSON.stringify(this.data, null, 2), "utf8");
    return this.snapshot();
  }
}

export const reviewDataStore = new ReviewDataStore();

export const createAudit = (
  database: ReviewDatabase,
  actor: string,
  action: string,
  entity: string,
  detail: string,
  revision: number,
): void => {
  database.auditLogs.unshift({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    actor,
    action,
    entity,
    detail,
    revision,
  });
};

export const createOpinionId = (): string =>
  `OP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const createClarificationId = (): string =>
  `CL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let versionSequence = 0;

export const createVersionId = (): string =>
  `VER-${Date.now()}-${(versionSequence += 1)}`;
