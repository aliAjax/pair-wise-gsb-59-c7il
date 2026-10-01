import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type {
  AssessmentInput,
  ClauseFilters,
  ClarificationInput,
  ClarificationResponseInput,
  FinalizeVersionInput,
  ReviewRole,
  WorkspaceSlice,
} from "../models/review.models";

export const ReviewActions = createActionGroup({
  source: "Procurement Review",
  events: {
    "Load Review Data": emptyProps(),
    "Load Review Data Success": props<{
      workspace: WorkspaceSlice;
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
    "Finalize Version Conflict": props<{
      workspace: WorkspaceSlice;
      attemptId?: string;
      message: string;
    }>(),
    "Dismiss Finalize Conflict": emptyProps(),
    "Reset Review Data": emptyProps(),
  },
});
