import { createReducer, on } from "@ngrx/store";
import type { ReviewState } from "../models/review.models";
import { ReviewActions } from "./review.actions";

export const initialReviewState: ReviewState = {
  clauses: [],
  versions: [],
  auditLogs: [],
  suppliers: [],
  filters: {
    keyword: "",
    category: "",
    type: "all",
    differencesOnly: false,
  },
  role: "reviewer_a",
  selectedSupplierIds: ["SUP-A", "SUP-B", "SUP-C"],
  currentRevision: 0,
  loading: false,
  saving: false,
};

export const reviewReducer = createReducer(
  initialReviewState,
  on(ReviewActions.loadReviewData, (state) => ({
    ...state,
    loading: true,
    error: undefined,
  })),
  on(
    ReviewActions.loadReviewDataSuccess,
    (state, { workspace, toast }) => ({
      ...state,
      ...workspace,
      loading: false,
      saving: false,
      error: undefined,
      conflict: undefined,
      toast,
    }),
  ),
  on(ReviewActions.loadReviewDataFailure, (state, { error }) => ({
    ...state,
    loading: false,
    saving: false,
    error,
  })),
  on(ReviewActions.setRole, (state, { role }) => ({
    ...state,
    role,
    toast: undefined,
  })),
  on(ReviewActions.setFilters, (state, { filters }) => ({
    ...state,
    filters: {
      ...state.filters,
      ...filters,
    },
  })),
  on(ReviewActions.toggleSupplier, (state, { supplierId }) => {
    const selected = state.selectedSupplierIds.includes(supplierId);
    const next = selected
      ? state.selectedSupplierIds.filter((id) => id !== supplierId)
      : [...state.selectedSupplierIds, supplierId];
    return {
      ...state,
      selectedSupplierIds: next.length > 0 ? next : state.selectedSupplierIds,
    };
  }),
  on(ReviewActions.clearToast, (state) => ({
    ...state,
    toast: undefined,
    error: undefined,
  })),
  on(ReviewActions.submissionConflict, (state, { conflict }) => ({
    ...state,
    saving: false,
    conflict,
    currentRevision: conflict.currentRevision,
  })),
  on(ReviewActions.dismissConflict, (state) => ({
    ...state,
    conflict: undefined,
  })),
  on(ReviewActions.verifyVersionHash, (state) => ({
    ...state,
    saving: true,
    hashVerification: undefined,
    error: undefined,
  })),
  on(
    ReviewActions.verifyVersionHashSuccess,
    (state, { verification }) => ({
      ...state,
      saving: false,
      hashVerification: verification,
    }),
  ),
  on(ReviewActions.verifyVersionHashFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(ReviewActions.clearHashVerification, (state) => ({
    ...state,
    hashVerification: undefined,
  })),
  on(
    ReviewActions.submitAssessment,
    ReviewActions.requestClarification,
    ReviewActions.respondClarification,
    ReviewActions.finalizeVersion,
    ReviewActions.retryConflictedSubmission,
    ReviewActions.resetReviewData,
    (state) => ({
      ...state,
      saving: true,
      error: undefined,
      toast: undefined,
    }),
  ),
);
