import type { CoverageScope, ObservedQuestion } from "@offeros/core";
import type { Db } from "../../db/client";
import { listEvents } from "../../repositories/application-event-repo";
import { listApplications } from "../../repositories/application-repo";
import { shapesFor } from "../../repositories/form-memory-repo";
import type { QuestionSource } from "./types";

/**
 * Questions a platform told us about before we applied.
 *
 * A reconnaissance reads the platform's public description of its own form and
 * records the question keys it found on the application's `job-checked` event;
 * the questions themselves live in the shape table. Earlier and cheaper than a
 * fill, and describing the form as advertised rather than as met — which is why
 * the read model prefers a fill sighting when it has both.
 *
 * Attribution comes from the event, so these sightings DO carry an application.
 * What the shape table alone could not tell us is how many times a question has
 * been seen across applications we never recorded an event for; that is why
 * `timesSeen` and `seenOnApplications` are separate numbers upstream.
 */
export const prescanSource: QuestionSource = {
  id: "prescan",
  observe(db: Db, scope: CoverageScope): ObservedQuestion[] {
    const applicationIds = scope.applicationId
      ? [scope.applicationId]
      : listApplications(db).map((a) => a.id);

    const out: ObservedQuestion[] = [];
    for (const applicationId of applicationIds) {
      for (const event of listEvents(db, applicationId)) {
        if (event.kind !== "job-checked") continue;
        const keys = Array.isArray(event.payload?.questionKeys)
          ? (event.payload.questionKeys as unknown[]).filter(
              (k): k is string => typeof k === "string",
            )
          : [];
        if (keys.length === 0) continue;
        for (const shape of shapesFor(db, keys)) {
          out.push({
            questionKey: shape.questionKey,
            question: shape.question,
            control: shape.classifiedType,
            required: shape.required,
            origin: "prescan",
            vendor: shape.vendor,
            applicationId,
            at: event.at,
          });
        }
      }
    }
    return out;
  },
};
