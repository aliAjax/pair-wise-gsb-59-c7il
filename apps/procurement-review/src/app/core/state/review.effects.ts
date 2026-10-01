import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { Store } from "@ngrx/store";
import { catchError, map, Observable, of, switchMap, withLatestFrom } from "rxjs";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  ConflictSubmissionInput,
  RevisionConflictItem,
  SubmissionConflictKind,
} from "../models/review.models";
import { ReviewGraphqlService } from "../services/graphql.service";
import { ReviewActions } from "./review.actions";
import { selectReviewState } from "./review.selectors";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "GraphQL 请求失败，请检查本地 mock server。";
};

interface GraphqlErrorLike {
  message?: string;
  extensions?: Record<string, unknown>;
}

const graphqlErrorsOf = (error: unknown): GraphqlErrorLike[] => {
  if (!error || typeof error !== "object") {
    return [];
  }
  const candidate = error as {
    errors?: unknown;
    graphQLErrors?: unknown;
  };
  const list = Array.isArray(candidate.errors)
    ? candidate.errors
    : Array.isArray(candidate.graphQLErrors)
      ? candidate.graphQLErrors
      : [];
  return list as GraphqlErrorLike[];
};

interface RevisionConflictPayload {
  currentRevision: number;
  conflicts: RevisionConflictItem[];
}

const asRevisionConflict = (error: unknown): RevisionConflictPayload | null => {
  for (const graphqlError of graphqlErrorsOf(error)) {
    const extensions = graphqlError.extensions as
      | {
          code?: unknown;
          currentRevision?: unknown;
          conflicts?: unknown;
        }
      | undefined;
    if (
      extensions?.code === "REVISION_CONFLICT" &&
      typeof extensions.currentRevision === "number"
    ) {
      return {
        currentRevision: extensions.currentRevision,
        conflicts: Array.isArray(extensions.conflicts)
          ? (extensions.conflicts as RevisionConflictItem[])
          : [],
      };
    }
  }
  return null;
};

@Injectable()
export class ReviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly graphql = inject(ReviewGraphqlService);

  private mutationPipeline<T>(
    request: Observable<T>,
    toast: string,
    conflictContext: {
      kind: SubmissionConflictKind;
      input: ConflictSubmissionInput;
    },
  ) {
    return request.pipe(
      switchMap(() => this.graphql.loadWorkspace()),
      map(({ workspace }) =>
        ReviewActions.loadReviewDataSuccess({ workspace, toast }),
      ),
      catchError((error: unknown) => {
        const conflict = asRevisionConflict(error);
        if (conflict) {
          return of(
            ReviewActions.submissionConflict({
              conflict: {
                kind: conflictContext.kind,
                input: conflictContext.input,
                baseRevision: conflictContext.input.baseRevision,
                currentRevision: conflict.currentRevision,
                conflicts: conflict.conflicts,
                attemptedAt: new Date().toISOString(),
              },
            }),
          );
        }
        return of(
          ReviewActions.loadReviewDataFailure({
            error: errorMessage(error),
          }),
        );
      }),
    );
  }

  loadReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.loadReviewData),
      switchMap(() =>
        this.graphql.loadWorkspace().pipe(
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({ workspace }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  submitAssessment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.submitAssessment),
      switchMap(({ input }) =>
        this.mutationPipeline(
          this.graphql.submitAssessment(input),
          "评审意见已提交，其他评审员意见保持不变。",
          { kind: "assessment", input },
        ),
      ),
    ),
  );

  requestClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.requestClarification),
      switchMap(({ input }) =>
        this.mutationPipeline(
          this.graphql.requestClarification(input),
          "澄清要求已发出，并写入审计日志。",
          { kind: "clarification-request", input },
        ),
      ),
    ),
  );

  respondClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.respondClarification),
      switchMap(({ input }) =>
        this.mutationPipeline(
          this.graphql.respondClarification(input),
          "澄清回复已登记，等待评审员复核。",
          { kind: "clarification-response", input },
        ),
      ),
    ),
  );

  retryConflictedSubmission$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.retryConflictedSubmission),
      withLatestFrom(this.store.select(selectReviewState)),
      switchMap(([, state]) => {
        const conflict = state.conflict;
        if (!conflict) {
          return of(ReviewActions.dismissConflict());
        }
        const baseRevision = state.currentRevision;
        if (conflict.kind === "assessment") {
          const input: AssessmentInput = {
            ...(conflict.input as AssessmentInput),
            baseRevision,
          };
          return this.mutationPipeline(
            this.graphql.submitAssessment(input),
            `已基于最新修订号 ${baseRevision} 重发，评审意见已提交。`,
            { kind: "assessment", input },
          );
        }
        if (conflict.kind === "clarification-request") {
          const input: ClarificationInput = {
            ...(conflict.input as ClarificationInput),
            baseRevision,
          };
          return this.mutationPipeline(
            this.graphql.requestClarification(input),
            `已基于最新修订号 ${baseRevision} 重发，澄清要求已发出。`,
            { kind: "clarification-request", input },
          );
        }
        const input: ClarificationResponseInput = {
          ...(conflict.input as ClarificationResponseInput),
          baseRevision,
        };
        return this.mutationPipeline(
          this.graphql.respondClarification(input),
          `已基于最新修订号 ${baseRevision} 重发，澄清回复已登记。`,
          { kind: "clarification-response", input },
        );
      }),
    ),
  );

  finalizeVersion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.finalizeVersion),
      switchMap(({ input }) =>
        this.graphql.finalizeVersion(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "已按当前修订号定稿并锁定，快照哈希可复算。",
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  verifyVersionHash$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.verifyVersionHash),
      switchMap(({ versionId }) =>
        this.graphql.verifyVersionHash(versionId).pipe(
          map((verification) =>
            ReviewActions.verifyVersionHashSuccess({ verification }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.verifyVersionHashFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  resetReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.resetReviewData),
      switchMap(() =>
        this.graphql.resetReviewData().pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "评审演示数据已恢复。",
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
