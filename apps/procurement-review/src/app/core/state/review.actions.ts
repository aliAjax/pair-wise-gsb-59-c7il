import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type {
  AssessmentInput,
  ClauseFilters,
  ClarificationInput,
  ClarificationResponseInput,
  FinalizeVersionInput,
  ReviewRole,
  ReviewState,
  SubmissionConflict,
  VersionHashVerification,
} from "../models/review.models";

export const ReviewActions = createActionGroup({
  source: "Procurement Review",
  events: {
    "Load Review Data": emptyProps(),
    "Load Review Data Success": props<{
      workspace: Pick<
        ReviewState,
        | "clauses"
        | "versions"
        | "auditLogs"
        | "dashboard"
        | "suppliers"
        | "currentRevision"
      >;
      toast?: string;
    }>(),
    "Load Review Data Failure": props<{ error: string }>(),
    "Set Role": props<{ role: ReviewRole }>(),
    "Set Filters": props<{ filters: Partial<ClauseFilters> }>(),
    "Toggle Supplier": props<{ supplierId: string }>(),
    "Clear Toast": emptyProps(),
    "Submit Assessment": props<{ input: AssessmentInput }>(),
    "Request Clarification": props<{ input: ClarificationInput }>(),
    "Respond Clarification": props<{ input: ClarificationResponseInput }>(),
    "Finalize Version": props<{ input: FinalizeVersionInput }>(),
    "Submission Conflict": props<{ conflict: SubmissionConflict }>(),
    "Retry Conflicted Submission": emptyProps(),
    "Dismiss Conflict": emptyProps(),
    "Verify Version Hash": props<{ versionId: string }>(),
    "Verify Version Hash Success": props<{
      verification: VersionHashVerification;
    }>(),
    "Verify Version Hash Failure": props<{ error: string }>(),
    "Clear Hash Verification": emptyProps(),
    "Reset Review Data": emptyProps(),
  },
});
