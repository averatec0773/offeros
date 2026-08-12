import type { VendorAdapter } from "../types";
import { greenhouseAdapter } from "./greenhouse";

/**
 * Every platform the server knows how to read.
 *
 * Adding one is an import and an entry. Nothing in the ladder, the merge or
 * any caller knows which adapters exist — if adding a platform ever needs a
 * change outside this file and the adapter itself, the seam is wrong and the
 * seam is what should change.
 *
 * Deliberately absent: platforms whose postings are built entirely by
 * JavaScript and which publish no API worth calling. Fetching those from a
 * server yields an empty shell, and the right answer for them is the browser
 * extension, which sees the page the applicant sees.
 */
export const VENDOR_ADAPTERS: VendorAdapter[] = [greenhouseAdapter];
