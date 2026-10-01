import { parse } from "graphql";

export const typeDefs = parse(`
  enum ClauseType {
    mandatory
    scoring
    evidence
  }

  enum ComplianceStatus {
    compliant
    deviation
    clarification
    pending
  }

  enum ReviewRole {
    procurement
    reviewer_a
    reviewer_b
    chair
  }

  enum ClarificationStatus {
    open
    responded
    overdue
  }

  enum VersionStatus {
    draft
    finalized
  }

  type Clause {
    id: ID!
    code: String!
    title: String!
    category: String!
    requirement: String!
    type: ClauseType!
    weight: Int!
    parentId: String
    evidenceRequired: Boolean!
    order: Int!
    responses: [SupplierResponse!]!
  }

  type ReviewerOpinion {
    id: ID!
    responseId: String!
    reviewer: String!
    role: ReviewRole!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    createdAt: String!
  }

  type Clarification {
    id: ID!
    responseId: String!
    clauseId: String!
    round: Int!
    requestText: String!
    supplierResponse: String
    requestedAt: String!
    dueAt: String!
    respondedAt: String
    status: ClarificationStatus!
  }

  type SupplierResponse {
    id: ID!
    clauseId: String!
    supplierId: String!
    supplierName: String!
    status: ComplianceStatus!
    responseText: String!
    claimedScore: Int!
    attachmentName: String!
    proofFingerprint: String!
    submittedBy: String!
    submittedAt: String!
    reviewRound: Int!
    reviews: [ReviewerOpinion!]!
    clarifications: [Clarification!]!
  }

  type VersionSnapshot {
    frozenAt: String!
    responses: [SupplierResponse!]!
  }

  type ReviewVersion {
    id: ID!
    version: String!
    label: String!
    status: VersionStatus!
    revision: Int!
    createdAt: String!
    createdBy: String!
    signedBy: [String!]!
    clauseCount: Int!
    responseCount: Int!
    hashAlgorithm: String!
    contentHash: String!
    snapshot: VersionSnapshot
  }

  type AuditLog {
    id: ID!
    at: String!
    actor: String!
    action: String!
    entity: String!
    detail: String!
    revision: Int!
  }

  type VersionHashVerification {
    versionId: ID!
    revision: Int!
    contentHash: String!
    recomputedHash: String!
    matches: Boolean!
  }

  type DashboardStats {
    totalClauses: Int!
    mandatoryCount: Int!
    pendingReviews: Int!
    differences: Int!
    overdueClarifications: Int!
    reusedProofs: Int!
    activeVersion: String!
  }

  type Supplier {
    id: ID!
    name: String!
  }

  type WorkspaceData {
    clauses: [Clause!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
    currentRevision: Int!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
    baseRevision: Int!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
    baseRevision: Int!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
    baseRevision: Int!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
    verifyVersionHash(versionId: ID!): VersionHashVerification!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): ReviewerOpinion!
    requestClarification(input: ClarificationInput!): Clarification!
    respondClarification(input: ClarificationResponseInput!): Clarification!
    finalizeVersion(input: FinalizeVersionInput!): ReviewVersion!
    resetReviewData: Boolean!
  }
`);
