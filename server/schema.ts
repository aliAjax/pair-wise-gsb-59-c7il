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

  enum FinalizeAttemptStatus {
    finalized
    conflicted
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
    revision: Int!
    takenAt: String!
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

  type ConflictEntry {
    revision: Int!
    actor: String!
    action: String!
    entity: String!
    detail: String!
  }

  type FinalizeAttempt {
    id: ID!
    at: String!
    actor: String!
    label: String!
    baseRevision: Int!
    currentRevision: Int!
    status: FinalizeAttemptStatus!
    versionId: String
    conflicts: [ConflictEntry!]!
  }

  type HashVerification {
    versionId: ID!
    storedHash: String!
    recomputedHash: String!
    matches: Boolean!
    snapshotRevision: Int!
    snapshotTakenAt: String!
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
    finalizeAttempts: [FinalizeAttempt!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
    revision: Int!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
    baseRevision: Int!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
    verifyVersionHash(versionId: ID!): HashVerification!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): ReviewerOpinion!
    requestClarification(input: ClarificationInput!): Clarification!
    respondClarification(input: ClarificationResponseInput!): Clarification!
    finalizeVersion(input: FinalizeVersionInput!): ReviewVersion!
    resetReviewData: Boolean!
  }
`);
