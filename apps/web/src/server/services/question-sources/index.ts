import { fillHistorySource } from "./fill-history";
import { prescanSource } from "./prescan";
import type { QuestionSource } from "./types";

/**
 * Every way OfferOS knows that a form asks something.
 *
 * Adding one is an import and an entry. Nothing above this file knows which
 * sources exist — the read model iterates the array, and the cards, pages and
 * agent tools above it never see a source at all. If adding a source ever
 * requires a change outside this file and the source itself, the seam is wrong
 * and the seam is what should change.
 *
 * (The same rule the vendor adapters and the PDF renderers are held to. Those
 * two registries are worth reading before adding a third kind of thing here.)
 */
export const QUESTION_SOURCES: QuestionSource[] = [fillHistorySource, prescanSource];

export type { QuestionSource } from "./types";
