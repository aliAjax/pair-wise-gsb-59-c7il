import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { TableModule } from "primeng/table";
import { TagModule } from "primeng/tag";
import { TextareaModule } from "primeng/textarea";
import {
  roleProfiles,
  type Clarification,
  type Clause,
  type FinalizeAttempt,
  type HashVerification,
  type ReviewVersion,
  type SupplierResponse,
} from "../../core/models/review.models";
import { ReviewGraphqlService } from "../../core/services/graphql.service";
import { ReviewActions } from "../../core/state/review.actions";
import {
  hasReviewDifference,
  selectClauses,
  selectFinalizeAttempts,
  selectFinalizeConflict,
  selectPendingClarifications,
  selectRevision,
  selectRole,
  selectVersions,
} from "../../core/state/review.selectors";
import {
  ClarificationTagComponent,
  StatusTagComponent,
  VersionTagComponent,
} from "../../shared/status-tag.component";

interface PendingClarification {
  clause: Clause;
  response: SupplierResponse;
  clarification: Clarification;
}

@Component({
  selector: "app-review-page",
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TableModule,
    TagModule,
    TextareaModule,
    ClarificationTagComponent,
    StatusTagComponent,
    VersionTagComponent,
  ],
  templateUrl: "./review.page.html",
  styleUrl: "./review.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPage {
  private readonly store = inject(Store);
  private readonly graphql = inject(ReviewGraphqlService);

  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly clauses = toSignal(this.store.select(selectClauses), {
    initialValue: [],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly revision = toSignal(this.store.select(selectRevision), {
    initialValue: 0,
  });
  readonly finalizeAttempts = toSignal(
    this.store.select(selectFinalizeAttempts),
    { initialValue: [] },
  );
  readonly pendingClarifications = toSignal(
    this.store.select(selectPendingClarifications),
    { initialValue: [] as PendingClarification[] },
  );
  readonly finalizeVisible = signal(false);
  readonly responseVisible = signal(false);
  readonly conflictVisible = signal(false);
  readonly verifyVisible = signal(false);
  readonly selectedClarification = signal<PendingClarification | null>(null);
  readonly selectedAttempt = signal<FinalizeAttempt | null>(null);
  readonly verification = signal<HashVerification | null>(null);
  readonly verifyTarget = signal<ReviewVersion | null>(null);
  readonly verifying = signal(false);
  readonly verifyFailed = signal(false);
  readonly canFinalize = computed(() => this.role() === "chair");
  readonly canRespond = computed(() =>
    ["procurement", "chair"].includes(this.role()),
  );
  readonly differences = computed(() =>
    this.clauses().flatMap((clause) =>
      clause.responses
        .filter(hasReviewDifference)
        .map((response) => ({ clause, response })),
    ),
  );
  readonly finalizedCount = computed(
    () => this.versions().filter((version) => version.status === "finalized").length,
  );
  readonly workingVersion = computed(
    () => this.versions().find((version) => version.status === "draft"),
  );

  readonly finalizeForm = new FormGroup({
    label: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
  });
  readonly responseForm = new FormGroup({
    responseText: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });

  constructor() {
    const conflict = toSignal(this.store.select(selectFinalizeConflict));
    effect(() => {
      const current = conflict();
      if (!current) {
        return;
      }
      const attempt =
        this.finalizeAttempts().find(
          (item) => item.id === current.attemptId,
        ) ??
        this.finalizeAttempts()[0] ??
        null;
      this.selectedAttempt.set(attempt);
      this.conflictVisible.set(true);
    });
  }

  shortHash(version: ReviewVersion): string {
    return version.contentHash
      ? `${version.contentHash.slice(0, 12)}…`
      : "待定稿生成";
  }

  openFinalize(): void {
    this.finalizeForm.reset({ label: "技术响应符合性评审汇总" });
    this.finalizeVisible.set(true);
  }

  finalizeVersion(): void {
    if (!this.canFinalize() || this.finalizeForm.invalid) {
      this.finalizeForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.finalizeVersion({
        input: {
          label: this.finalizeForm.controls.label.value,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          baseRevision: this.revision(),
        },
      }),
    );
    this.finalizeVisible.set(false);
  }

  openAttempt(attempt: FinalizeAttempt): void {
    this.selectedAttempt.set(attempt);
    this.conflictVisible.set(true);
  }

  closeConflict(): void {
    this.conflictVisible.set(false);
    this.store.dispatch(ReviewActions.dismissFinalizeConflict());
  }

  retryFinalize(): void {
    const attempt = this.selectedAttempt();
    if (!attempt || !this.canFinalize()) {
      return;
    }
    this.store.dispatch(
      ReviewActions.finalizeVersion({
        input: {
          label: attempt.label,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          baseRevision: this.revision(),
        },
      }),
    );
    this.conflictVisible.set(false);
  }

  verifyVersion(version: ReviewVersion): void {
    this.verifyTarget.set(version);
    this.verification.set(null);
    this.verifyFailed.set(false);
    this.verifying.set(true);
    this.verifyVisible.set(true);
    this.graphql.verifyVersionHash(version.id).subscribe({
      next: (result) => {
        this.verification.set(result);
        this.verifying.set(false);
      },
      error: () => {
        this.verifying.set(false);
        this.verifyFailed.set(true);
      },
    });
  }

  openResponse(item: PendingClarification): void {
    this.selectedClarification.set(item);
    this.responseForm.reset({ responseText: "" });
    this.responseVisible.set(true);
  }

  respondClarification(): void {
    const item = this.selectedClarification();
    if (
      !item ||
      !this.canRespond() ||
      this.responseForm.invalid
    ) {
      this.responseForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.respondClarification({
        input: {
          clarificationId: item.clarification.id,
          responseText: this.responseForm.controls.responseText.value,
          actor: roleProfiles[this.role()].name,
        },
      }),
    );
    this.responseVisible.set(false);
  }
}
