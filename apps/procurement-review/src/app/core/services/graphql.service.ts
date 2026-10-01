import { Injectable, inject } from "@angular/core";
import { Apollo, gql } from "apollo-angular";
import { Observable, map, throwError, catchError } from "rxjs";
import type {
  AssessmentInput,
  Clarification,
  ClarificationInput,
  ClarificationResponseInput,
  FinalizeVersionInput,
  HashVerification,
  ReviewVersion,
  ReviewerOpinion,
  WorkspaceQueryResult,
} from "../models/review.models";

const WORKSPACE_QUERY = gql`
  query ProcurementReviewWorkspace {
    workspace {
      revision
      clauses {
        id
        code
        title
        category
        requirement
        type
        weight
        parentId
        evidenceRequired
        order
        responses {
          id
          clauseId
          supplierId
          supplierName
          status
          responseText
          claimedScore
          attachmentName
          proofFingerprint
          submittedBy
          submittedAt
          reviewRound
          reviews {
            id
            responseId
            reviewer
            role
            decision
            score
            comment
            createdAt
          }
          clarifications {
            id
            responseId
            clauseId
            round
            requestText
            supplierResponse
            requestedAt
            dueAt
            respondedAt
            status
          }
        }
      }
      versions {
        id
        version
        label
        status
        revision
        createdAt
        createdBy
        signedBy
        clauseCount
        responseCount
        contentHash
      }
      auditLogs {
        id
        at
        actor
        action
        entity
        detail
        revision
      }
      finalizeAttempts {
        id
        at
        actor
        label
        baseRevision
        currentRevision
        status
        versionId
        conflicts {
          revision
          actor
          action
          entity
          detail
        }
      }
      dashboard {
        totalClauses
        mandatoryCount
        pendingReviews
        differences
        overdueClarifications
        reusedProofs
        activeVersion
      }
      suppliers {
        id
        name
      }
    }
  }
`;

const SUBMIT_ASSESSMENT = gql`
  mutation SubmitAssessment($input: AssessmentInput!) {
    submitAssessment(input: $input) {
      id
      responseId
      reviewer
      role
      decision
      score
      comment
      createdAt
    }
  }
`;

const REQUEST_CLARIFICATION = gql`
  mutation RequestClarification($input: ClarificationInput!) {
    requestClarification(input: $input) {
      id
      responseId
      clauseId
      round
      requestText
      supplierResponse
      requestedAt
      dueAt
      respondedAt
      status
    }
  }
`;

const RESPOND_CLARIFICATION = gql`
  mutation RespondClarification($input: ClarificationResponseInput!) {
    respondClarification(input: $input) {
      id
      responseId
      clauseId
      round
      requestText
      supplierResponse
      requestedAt
      dueAt
      respondedAt
      status
    }
  }
`;

const FINALIZE_VERSION = gql`
  mutation FinalizeVersion($input: FinalizeVersionInput!) {
    finalizeVersion(input: $input) {
      id
      version
      label
      status
      revision
      createdAt
      createdBy
      signedBy
      clauseCount
      responseCount
      contentHash
    }
  }
`;

const VERIFY_VERSION_HASH = gql`
  query VerifyVersionHash($versionId: ID!) {
    verifyVersionHash(versionId: $versionId) {
      versionId
      storedHash
      recomputedHash
      matches
      snapshotRevision
      snapshotTakenAt
    }
  }
`;

const RESET_REVIEW_DATA = gql`
  mutation ResetReviewData {
    resetReviewData
  }
`;

/** 定稿修订号冲突：服务端已保留尝试与冲突清单，可基于最新修订号重发。 */
export class VersionConflictError extends Error {
  constructor(
    message: string,
    readonly attemptId?: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "VersionConflictError";
  }
}

interface GraphQLErrorLike {
  message?: string;
  extensions?: Record<string, unknown>;
}

const firstGraphQLError = (error: unknown): GraphQLErrorLike | undefined => {
  const carrier = error as {
    graphQLErrors?: ReadonlyArray<GraphQLErrorLike>;
    errors?: ReadonlyArray<GraphQLErrorLike>;
  };
  const list = carrier?.graphQLErrors ?? carrier?.errors;
  return Array.isArray(list) ? list[0] : undefined;
};

@Injectable({ providedIn: "root" })
export class ReviewGraphqlService {
  private readonly apollo = inject(Apollo);

  loadWorkspace(): Observable<WorkspaceQueryResult> {
    return this.apollo
      .query<WorkspaceQueryResult>({
        query: WORKSPACE_QUERY,
        fetchPolicy: "network-only",
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审工作区。");
          }
          return result.data as WorkspaceQueryResult;
        }),
      );
  }

  submitAssessment(input: AssessmentInput): Observable<ReviewerOpinion> {
    return this.apollo
      .mutate<{ submitAssessment: ReviewerOpinion }>({
        mutation: SUBMIT_ASSESSMENT,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审意见。");
          }
          return result.data.submitAssessment;
        }),
      );
  }

  requestClarification(input: ClarificationInput): Observable<Clarification> {
    return this.apollo
      .mutate<{ requestClarification: Clarification }>({
        mutation: REQUEST_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清记录。");
          }
          return result.data.requestClarification;
        }),
      );
  }

  respondClarification(
    input: ClarificationResponseInput,
  ): Observable<Clarification> {
    return this.apollo
      .mutate<{ respondClarification: Clarification }>({
        mutation: RESPOND_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清回复。");
          }
          return result.data.respondClarification;
        }),
      );
  }

  finalizeVersion(input: FinalizeVersionInput): Observable<ReviewVersion> {
    return this.apollo
      .mutate<{ finalizeVersion: ReviewVersion }>({
        mutation: FINALIZE_VERSION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回版本信息。");
          }
          return result.data.finalizeVersion;
        }),
        catchError((error: unknown) => {
          const graphQLError = firstGraphQLError(error);
          if (graphQLError?.extensions?.["code"] === "VERSION_CONFLICT") {
            return throwError(
              () =>
                new VersionConflictError(
                  graphQLError.message ?? "定稿与最新修订号冲突。",
                  graphQLError.extensions?.["attemptId"] as string | undefined,
                  graphQLError.extensions?.["currentRevision"] as
                    | number
                    | undefined,
                ),
            );
          }
          return throwError(() => error);
        }),
      );
  }

  verifyVersionHash(versionId: string): Observable<HashVerification> {
    return this.apollo
      .query<{ verifyVersionHash: HashVerification }>({
        query: VERIFY_VERSION_HASH,
        variables: { versionId },
        fetchPolicy: "network-only",
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回哈希校验结果。");
          }
          return result.data.verifyVersionHash;
        }),
      );
  }

  resetReviewData(): Observable<boolean> {
    return this.apollo
      .mutate<{ resetReviewData: boolean }>({
        mutation: RESET_REVIEW_DATA,
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回重置结果。");
          }
          return result.data.resetReviewData;
        }),
      );
  }
}
