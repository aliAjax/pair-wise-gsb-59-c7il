import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
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
  type ReviewVersion,
  type SupplierResponse,
} from "../../core/models/review.models";
import { ReviewActions } from "../../core/state/review.actions";
import {
  hasReviewDifference,
  selectClauses,
  selectCurrentRevision,
  selectHashVerification,
  selectMandatoryConclusionGaps,
  selectPendingClarifications,
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

  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly clauses = toSignal(this.store.select(selectClauses), {
    initialValue: [],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly currentRevision = toSignal(this.store.select(selectCurrentRevision), {
    initialValue: 0,
  });
  readonly pendingClarifications = toSignal(
    this.store.select(selectPendingClarifications),
    { initialValue: [] as PendingClarification[] },
  );
  readonly mandatoryGaps = toSignal(
    this.store.select(selectMandatoryConclusionGaps),
    { initialValue: [] as Array<{ clause: Clause; response: SupplierResponse }> },
  );
  readonly hashVerification = toSignal(
    this.store.select(selectHashVerification),
    { initialValue: undefined },
  );
  readonly finalizeVisible = signal(false);
  readonly responseVisible = signal(false);
  readonly selectedClarification = signal<PendingClarification | null>(null);
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
  readonly finalizeBlockers = computed(() => {
    const blockers: string[] = [];
    const pending = this.pendingClarifications().length;
    if (pending > 0) {
      blockers.push(`${pending} 项澄清未完成`);
    }
    const gaps = this.mandatoryGaps().length;
    if (gaps > 0) {
      blockers.push(`${gaps} 项否决项未满两名评审员结论`);
    }
    return blockers;
  });

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
        },
      }),
    );
    this.finalizeVisible.set(false);
  }

  verifyHash(version: ReviewVersion): void {
    this.store.dispatch(
      ReviewActions.verifyVersionHash({ versionId: version.id }),
    );
  }

  closeHashVerification(): void {
    this.store.dispatch(ReviewActions.clearHashVerification());
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
          baseRevision: this.currentRevision(),
        },
      }),
    );
    this.responseVisible.set(false);
  }
}
