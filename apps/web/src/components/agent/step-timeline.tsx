import { Check } from "lucide-react";
import { PIPELINE_STEPS, type AgentTask } from "@offeros/core";
import { ActionRequiredCard } from "./action-required-card";

type AgentStep = {
  key: string;
  label: string;
  state: "done" | "current" | "pending";
};

const FILL_STEP_KEY = "fill-form";

// Derive per-step state from the task. When applicationInfo needs input,
// the "Fill out application form" step is the current (action-required) step;
// otherwise the current step is task.step (count of steps completed so far).
function deriveSteps(task: AgentTask): AgentStep[] {
  const actionRequired = task.applicationInfo?.status === 2 && task.status !== "done";
  const currentIndex = actionRequired
    ? PIPELINE_STEPS.findIndex((s) => s.key === FILL_STEP_KEY)
    : task.step;

  return PIPELINE_STEPS.map((step, i) => ({
    key: step.key,
    label: step.label,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "pending",
  }));
}

function RailDot({ state }: { state: AgentStep["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-5.5 items-center justify-center rounded-full bg-brand">
        <Check className="size-3.5 text-brand-foreground" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex size-5.5 items-center justify-center rounded-full border-2 border-brand bg-card">
        <span className="size-1.5 rounded-full bg-brand" />
      </span>
    );
  }
  return <span className="size-5.5 rounded-full border-2 border-border bg-card" />;
}

export function StepTimeline({
  task,
  onReFill,
  onFixed,
  onApplied,
}: {
  task: AgentTask;
  onReFill?: () => void;
  onFixed?: () => void;
  onApplied?: () => void;
}) {
  const steps = deriveSteps(task);
  const actionRequired = task.applicationInfo?.status === 2 && task.status !== "done";

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <ol>
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const showActionCard = actionRequired && step.key === FILL_STEP_KEY;

          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <RailDot state={step.state} />
                {!isLast && (
                  <span
                    className={`w-0.5 flex-1 ${
                      step.state === "done" ? "bg-brand/40" : "bg-border"
                    }`}
                  />
                )}
              </div>

              <div className={`min-w-0 flex-1 ${isLast ? "pb-0" : "pb-4"}`}>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span
                    className={`text-body ${
                      step.state === "pending"
                        ? "font-medium text-muted-foreground"
                        : "font-semibold text-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.state === "done" && (
                    <Check className="size-4 shrink-0 text-brand" strokeWidth={3} />
                  )}
                  {step.state === "current" && !showActionCard && (
                    <span className="shrink-0 text-micro font-semibold text-muted-foreground">
                      {task.status === "queued" ? "Queued" : "In progress"}
                    </span>
                  )}
                  {showActionCard && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warn-bg px-2 py-0.5 text-micro font-semibold text-foreground">
                      <span className="size-1.5 rounded-full bg-warn" />
                      Action Required
                    </span>
                  )}
                </div>

                {showActionCard && task.applicationInfo && (
                  <div className="mt-2">
                    <ActionRequiredCard
                      applicationInfo={task.applicationInfo}
                      onReFill={onReFill}
                      onFixed={onFixed}
                      onApplied={onApplied}
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
