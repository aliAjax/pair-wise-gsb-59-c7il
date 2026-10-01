export type ClauseType = "mandatory" | "scoring" | "evidence";
export type ComplianceStatus =
  | "compliant"
  | "deviation"
  | "clarification"
  | "pending";
export type ReviewRole =
  | "procurement"
  | "reviewer_a"
  | "reviewer_b"
  | "chair";
export type ClarificationStatus = "open" | "responded" | "overdue";
export type VersionStatus = "draft" | "finalized";

export interface Clause {
  id: string;
  code: string;
  title: string;
  category: string;
  requirement: string;
  type: ClauseType;
  weight: number;
  parentId?: string;
  evidenceRequired: boolean;
  order: number;
}

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
}

export interface Clarification {
  id: string;
  responseId: string;
  clauseId: string;
  round: number;
  requestText: string;
  supplierResponse?: string;
  requestedAt: string;
  dueAt: string;
  respondedAt?: string;
  status: ClarificationStatus;
}

export interface SupplierResponse {
  id: string;
  clauseId: string;
  supplierId: string;
  supplierName: string;
  status: ComplianceStatus;
  responseText: string;
  claimedScore: number;
  attachmentName: string;
  proofFingerprint: string;
  submittedBy: string;
  submittedAt: string;
  reviewRound: number;
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface VersionSnapshot {
  frozenAt: string;
  responses: SupplierResponse[];
}

export interface ReviewVersion {
  id: string;
  version: string;
  label: string;
  status: VersionStatus;
  revision: number;
  createdAt: string;
  createdBy: string;
  signedBy: string[];
  clauseCount: number;
  responseCount: number;
  hashAlgorithm: string;
  contentHash: string;
  snapshot?: VersionSnapshot;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  revision: number;
}

export interface DashboardStats {
  totalClauses: number;
  mandatoryCount: number;
  pendingReviews: number;
  differences: number;
  overdueClarifications: number;
  reusedProofs: number;
  activeVersion: string;
}

export interface ReviewDatabase {
  clauses: Clause[];
  responses: SupplierResponse[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  suppliers: Array<{ id: string; name: string }>;
  currentRevision: number;
}

export interface RevisionConflictItem {
  revision: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}

export interface VersionHashVerification {
  versionId: string;
  revision: number;
  contentHash: string;
  recomputedHash: string;
  matches: boolean;
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  baseRevision: number;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
  baseRevision: number;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
  baseRevision: number;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
}
