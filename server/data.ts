import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeSnapshotHash } from "./hash";
import type {
  AuditLog,
  Clarification,
  Clause,
  ComplianceStatus,
  FinalizeAttempt,
  ReviewDatabase,
  ReviewVersion,
  ReviewRole,
  SupplierResponse,
  VersionSnapshot,
} from "./types";

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
    responseId: "C001-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "组织架构与职责界面完整，进度控制机制可执行。",
    createdAt: "2026-09-28T09:40:00+08:00",
  },
  {
    responseId: "C001-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "风险应对机制覆盖主要实施风险，同意符合。",
    createdAt: "2026-09-28T10:05:00+08:00",
  },
  {
    responseId: "C001-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "实施方法描述清晰，项目组织满足要求。",
    createdAt: "2026-09-28T09:45:00+08:00",
  },
  {
    responseId: "C001-SUP-B",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "职责界面与进度计划可核验，无偏离。",
    createdAt: "2026-09-28T10:15:00+08:00",
  },
  {
    responseId: "C001-SUP-C",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "组织方案基本完整，人员配置满足要求。",
    createdAt: "2026-09-28T09:50:00+08:00",
  },
  {
    responseId: "C001-SUP-C",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "clarification",
    score: 0,
    comment: "风险登记册缺少维护频次说明，建议澄清后确认。",
    createdAt: "2026-09-28T10:30:00+08:00",
  },
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
    responseId: "C002-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "项目经理履历满足年限，关键岗位覆盖完整。",
    createdAt: "2026-09-28T10:40:00+08:00",
  },
  {
    responseId: "C002-SUP-B",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "人员社保与履历一致，关键人员配置达标。",
    createdAt: "2026-09-28T11:05:00+08:00",
  },
  {
    responseId: "C002-SUP-C",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "关键人员配置覆盖架构、开发、测试与安全。",
    createdAt: "2026-09-28T10:50:00+08:00",
  },
  {
    responseId: "C002-SUP-C",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "项目经理同类项目经验可核验，同意符合。",
    createdAt: "2026-09-28T11:20:00+08:00",
  },
  {
    responseId: "C005-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "接口遵循 HTTPS 与 OAuth 2.0，文档版本清晰。",
    createdAt: "2026-09-28T13:30:00+08:00",
  },
  {
    responseId: "C005-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "OpenAPI 文档与错误码说明完整，可互操作。",
    createdAt: "2026-09-28T14:10:00+08:00",
  },
  {
    responseId: "C005-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "deviation",
    score: 0,
    comment: "部分接口仍使用私有协议，未完全遵循标准。",
    createdAt: "2026-09-28T13:45:00+08:00",
  },
  {
    responseId: "C005-SUP-C",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "接口标准符合要求，版本兼容说明完整。",
    createdAt: "2026-09-28T13:50:00+08:00",
  },
  {
    responseId: "C005-SUP-C",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "协议遵循情况可核验，无偏离。",
    createdAt: "2026-09-28T14:20:00+08:00",
  },
  {
    responseId: "C007-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "安全方案覆盖身份鉴别、访问控制与审计。",
    createdAt: "2026-09-28T15:10:00+08:00",
  },
  {
    responseId: "C007-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "数据保护与安全运维措施完整，同意符合。",
    createdAt: "2026-09-28T15:40:00+08:00",
  },
  {
    responseId: "C007-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "安全架构完整，审计留痕机制可验证。",
    createdAt: "2026-09-28T15:20:00+08:00",
  },
  {
    responseId: "C007-SUP-B",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "访问控制模型清晰，满足安全保障要求。",
    createdAt: "2026-09-28T15:55:00+08:00",
  },
  {
    responseId: "C007-SUP-C",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "安全运维流程完整，责任分工明确。",
    createdAt: "2026-09-28T15:30:00+08:00",
  },
  {
    responseId: "C007-SUP-C",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "身份鉴别与审计方案符合要求。",
    createdAt: "2026-09-28T16:05:00+08:00",
  },
  {
    responseId: "C011-SUP-A",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "验收指标可测量，与服务水平承诺一致。",
    createdAt: "2026-09-28T16:20:00+08:00",
  },
  {
    responseId: "C011-SUP-A",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "指标可复现，验收方法明确。",
    createdAt: "2026-09-28T16:45:00+08:00",
  },
  {
    responseId: "C011-SUP-B",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "验收指标量化完整，测试方法可复现。",
    createdAt: "2026-09-28T16:30:00+08:00",
  },
  {
    responseId: "C011-SUP-B",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "指标与采购需求服务水平一致，同意符合。",
    createdAt: "2026-09-28T16:55:00+08:00",
  },
  {
    responseId: "C011-SUP-C",
    reviewer: "陈评审",
    role: "reviewer_a",
    decision: "compliant",
    score: 0,
    comment: "验收指标体系完整，测量方法明确。",
    createdAt: "2026-09-28T16:35:00+08:00",
  },
  {
    responseId: "C011-SUP-C",
    reviewer: "李评审",
    role: "reviewer_b",
    decision: "compliant",
    score: 0,
    comment: "指标可测量、可复现，无偏离。",
    createdAt: "2026-09-28T17:05:00+08:00",
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
  base.reviews = reviewFactories
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

const buildSeedVersions = (
  seedResponses: SupplierResponse[],
): { versions: ReviewVersion[]; revision: number } => {
  const v1Snapshot: VersionSnapshot = {
    revision: 1,
    takenAt: "2026-09-25T17:30:00+08:00",
    responses: structuredClone(seedResponses),
  };
  return {
    revision: 2,
    versions: [
      {
        id: "VER-002",
        version: "V2",
        label: "澄清与评分复核工作版",
        status: "draft" as const,
        revision: 2,
        createdAt: "2026-09-29T08:10:00+08:00",
        createdBy: "采购工作组",
        signedBy: [],
        clauseCount: clauses.length,
        responseCount: seedResponses.length,
        contentHash: "",
      },
      {
        id: "VER-001",
        version: "V1",
        label: "初审问题定位版本",
        status: "finalized" as const,
        revision: 1,
        createdAt: "2026-09-25T17:30:00+08:00",
        createdBy: "采购工作组",
        signedBy: ["采购负责人", "技术评审组长"],
        clauseCount: clauses.length,
        responseCount: seedResponses.length,
        contentHash: computeSnapshotHash(v1Snapshot),
        snapshot: v1Snapshot,
      },
    ],
  };
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
  const { versions: seedVersions, revision } = buildSeedVersions(seedResponses);
  return {
    clauses: structuredClone(clauses),
    responses: seedResponses,
    versions: seedVersions,
    auditLogs: structuredClone(auditLogs),
    finalizeAttempts: [],
    suppliers: structuredClone(suppliers),
    revision,
  };
};

export interface FinalizeCommand {
  label: string;
  actor: string;
  baseRevision: number;
}

export type FinalizeResult =
  | { status: "finalized"; version: ReviewVersion }
  | { status: "conflict"; attempt: FinalizeAttempt };

const formatShortfalls = (items: string[]): string =>
  items.length > 5
    ? `${items.slice(0, 5).join("；")} 等 ${items.length} 项`
    : items.join("；");

class ReviewDataStore {
  private readonly runtimePath = join(process.cwd(), "server", "runtime-data.json");
  private data: ReviewDatabase;

  constructor() {
    if (existsSync(this.runtimePath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(this.runtimePath, "utf8"),
        ) as ReviewDatabase;
        // 旧版运行时数据缺少修订号字段，直接按新种子重建，避免脏数据混入。
        this.data =
          typeof parsed.revision === "number" &&
          Array.isArray(parsed.finalizeAttempts)
            ? parsed
            : buildSeed();
      } catch {
        this.data = buildSeed();
      }
    } else {
      this.data = buildSeed();
    }
  }

  snapshot(): ReviewDatabase {
    return structuredClone(this.data);
  }

  mutate<T>(work: (database: ReviewDatabase) => T): T {
    const before = structuredClone(this.data);
    this.data.revision += 1;
    try {
      const result = work(this.data);
      this.persist();
      return result;
    } catch (error) {
      this.data = before;
      throw error;
    }
  }

  /**
   * 按当前修订号定稿：
   * 1. 未完成澄清、否决项缺少两名评审员结论时直接拒绝（不留下痕迹）；
   * 2. baseRevision 落后于当前修订号时判定为冲突，保留尝试与冲突清单后返回；
   * 3. 否则锁定当前工作版，保存响应/意见/澄清快照并生成可复算哈希，
   *    同时开启下一工作版承接晚到的提交。
   */
  finalize(command: FinalizeCommand): FinalizeResult {
    const database = this.data;
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
    const clauseById = new Map(
      database.clauses.map((clause) => [clause.id, clause]),
    );
    const mandatoryShortfalls = database.responses
      .filter((response) => {
        const clause = clauseById.get(response.clauseId);
        return clause?.type === "mandatory" && response.reviews.length < 2;
      })
      .map((response) => {
        const clause = clauseById.get(response.clauseId);
        return `${clause?.code ?? response.clauseId}（${response.supplierName}，仅 ${response.reviews.length} 名评审员结论）`;
      });
    if (mandatoryShortfalls.length > 0) {
      throw new Error(
        `否决项需两名评审员结论方可定稿，尚未满足：${formatShortfalls(mandatoryShortfalls)}。`,
      );
    }
    const draft = database.versions.find(
      (version) => version.status === "draft",
    );
    if (!draft) {
      throw new Error("当前没有可定稿的工作版本。");
    }

    if (command.baseRevision !== database.revision) {
      database.revision += 1;
      const conflicts = database.auditLogs
        .filter((log) => log.revision > command.baseRevision)
        .map((log) => ({
          revision: log.revision,
          actor: log.actor,
          action: log.action,
          entity: log.entity,
          detail: log.detail,
        }));
      const attempt: FinalizeAttempt = {
        id: createAttemptId(),
        at: new Date().toISOString(),
        actor: command.actor,
        label: command.label,
        baseRevision: command.baseRevision,
        currentRevision: database.revision,
        status: "conflicted",
        conflicts,
      };
      database.finalizeAttempts.unshift(attempt);
      createAudit(
        database,
        command.actor,
        "定稿冲突",
        attempt.id,
        `「${command.label}」基于修订号 r${command.baseRevision}，当前修订号已为 r${database.revision}，${conflicts.length} 项变更先到，尝试已保留，可基于最新修订号重发。`,
      );
      this.persist();
      return { status: "conflict", attempt };
    }

    database.revision += 1;
    const now = new Date().toISOString();
    const snapshot: VersionSnapshot = {
      revision: database.revision,
      takenAt: now,
      responses: structuredClone(database.responses),
    };
    const contentHash = computeSnapshotHash(snapshot);
    draft.status = "finalized";
    draft.label = command.label;
    draft.revision = database.revision;
    draft.createdAt = now;
    draft.createdBy = command.actor;
    draft.signedBy = [command.actor];
    draft.clauseCount = database.clauses.length;
    draft.responseCount = database.responses.length;
    draft.contentHash = contentHash;
    draft.snapshot = snapshot;

    const nextNumber =
      database.versions.reduce((maximum, version) => {
        const numeric = Number(version.version.replace(/\D/g, ""));
        return Number.isFinite(numeric)
          ? Math.max(maximum, numeric)
          : maximum;
      }, 0) + 1;
    const nextDraft: ReviewVersion = {
      id: createVersionId(),
      version: `V${nextNumber}`,
      label: `${draft.version} 定稿后工作版`,
      status: "draft",
      revision: database.revision,
      createdAt: now,
      createdBy: command.actor,
      signedBy: [],
      clauseCount: database.clauses.length,
      responseCount: database.responses.length,
      contentHash: "",
    };
    database.versions.unshift(nextDraft);

    const attempt: FinalizeAttempt = {
      id: createAttemptId(),
      at: now,
      actor: command.actor,
      label: command.label,
      baseRevision: command.baseRevision,
      currentRevision: database.revision,
      status: "finalized",
      versionId: draft.id,
      conflicts: [],
    };
    database.finalizeAttempts.unshift(attempt);

    createAudit(
      database,
      command.actor,
      "汇总签字定稿",
      draft.id,
      `${draft.version} ${draft.label} 已按修订号 r${database.revision} 定稿锁定，内容哈希 ${contentHash.slice(0, 12)}…，签署人 ${command.actor}。`,
    );
    createAudit(
      database,
      command.actor,
      "创建工作版本",
      nextDraft.id,
      `定稿后自动开启 ${nextDraft.version} 工作版，此后到达的提交记入该版本，不回写已冻结的 ${draft.version}。`,
    );
    this.persist();
    return { status: "finalized", version: structuredClone(draft) };
  }

  reset(): ReviewDatabase {
    this.data = buildSeed();
    this.persist();
    return this.snapshot();
  }

  private persist(): void {
    writeFileSync(this.runtimePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}

export const reviewDataStore = new ReviewDataStore();

export const createAudit = (
  database: ReviewDatabase,
  actor: string,
  action: string,
  entity: string,
  detail: string,
): void => {
  database.auditLogs.unshift({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    actor,
    action,
    entity,
    detail,
    revision: database.revision,
  });
};

export const createOpinionId = (): string =>
  `OP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const createClarificationId = (): string =>
  `CL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const createVersionId = (): string =>
  `VER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const createAttemptId = (): string =>
  `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
