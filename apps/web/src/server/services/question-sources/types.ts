import type { CoverageScope, ObservedQuestion } from "@offeros/core";
import type { Db } from "../../db/client";

/**
 * One way of knowing that application forms ask a question.
 *
 * The whole interface is `observe`. A source is handed a scope and returns
 * sightings; it does not know what other sources exist, whether the user can
 * answer anything, or who is going to read the result. Everything about
 * coverage happens a layer up, exactly once.
 *
 * Adding a source is a file and a line in `index.ts`. If a new source ever
 * needs a change in the read model, in a card, or in an agent tool, the seam is
 * wrong and the seam is what should change — the same rule the vendor adapters
 * and the PDF renderers are held to.
 *
 * A source may return the same question many times (once per sighting). The
 * read model deduplicates by `questionKey`; a source counting for itself would
 * have to know about the others to avoid double counting, which is precisely
 * the knowledge this interface exists to withhold.
 */
export interface QuestionSource {
  /** Stable name, for tests and for tracing where a sighting came from. */
  id: string;
  /** Every sighting this source can attest to within the scope. */
  observe(db: Db, scope: CoverageScope): ObservedQuestion[];
}
