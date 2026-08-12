import type { FieldDescriptor } from "./classify";
import { replayForm, type ReplayRow } from "./replay";
import type { FillProfile } from "./types";

/**
 * The canary lab: proof that a filled value came from THIS profile.
 *
 * A fill can be right by accident. A hardcoded default, a value bleeding in
 * from the wrong source, a classifier that happens to pick the one answer that
 * fits — all look identical to a correct fill when there is only one profile
 * to compare against, because "the right value" and "the value we always
 * write" are the same string. The classic cure is canaries: several synthetic
 * profiles whose values are deliberately mutually distinguishable, replayed
 * over the same forms. Then provenance becomes checkable — every planned
 * value must be traceable to the ACTIVE profile, and a value matching a
 * DIFFERENT canary's distinctive material is a cross-contamination bug by
 * definition, not a judgement call.
 *
 * Everything here is synthetic (example.com, 555 phones, no real person) and
 * exists to be replayed OFFLINE over captured forms. Canary profiles must
 * never be filled into a live employer's form and never submitted anywhere —
 * fabricating applications is not a testing strategy.
 */

export interface CanaryPersona {
  id: string;
  profile: FillProfile;
}

/** Three personas, mutually distinguishable on every value a form might ask
 *  for: disjoint names, contacts, links, skills and free-text answers. The
 *  shared parts (country, yes/no commitments) are deliberately identical —
 *  shared vocabulary can never prove provenance, so it must not differ in
 *  ways that would let a test pass for the wrong reason. */
export function canaryPersonas(): CanaryPersona[] {
  const answers = (heard: string, id: string): FillProfile["answerBank"] => [
    {
      id: `${id}-authorized`,
      questionPatterns: ["authorized to work"],
      answer: "Yes",
      type: "boolean",
      category: "eeo",
    },
    {
      id: `${id}-sponsorship`,
      questionPatterns: ["require visa sponsorship", "visa sponsorship"],
      answer: "No",
      type: "boolean",
      category: "eeo",
    },
    {
      id: `${id}-heard`,
      questionPatterns: ["how did you hear"],
      answer: heard,
      type: "text",
      category: "screening",
    },
  ];

  return [
    {
      id: "canary-avery",
      profile: {
        personal: {
          name: "Avery Stone",
          email: "avery.stone@example.com",
          phone: "+1 555 0111",
          address: "12 Birch Lane",
          city: "Austin",
          state: "Texas",
          postalCode: "73301",
          country: "United States",
          links: { linkedin: "https://linkedin.com/in/averystone" },
        },
        skills: ["TypeScript", "React"],
        answerBank: answers("University career fair", "avery"),
        education: [
          {
            school: "Birchwood College",
            degree: "Bachelor of Science",
            field: "Computer Science",
            start: "2014",
            end: "2018",
          },
        ],
        experience: [
          {
            company: "Northwind Systems",
            title: "Senior Engineer",
            start: "2021",
            end: "Present",
            bullets: ["Led the avery-side ingestion rewrite."],
          },
          {
            company: "Lakeside Analytics",
            title: "Engineer",
            start: "2018",
            end: "2021",
            bullets: ["Built the avery reporting service."],
          },
        ],
      },
    },
    {
      id: "canary-riley",
      profile: {
        personal: {
          name: "Riley Marsh",
          email: "riley.marsh@example.com",
          phone: "+1 555 0222",
          address: "48 Cedar Court",
          city: "Denver",
          state: "Colorado",
          postalCode: "80014",
          country: "United States",
          links: { linkedin: "https://linkedin.com/in/rileymarsh" },
        },
        skills: ["Python", "Django"],
        answerBank: answers("A friend's referral", "riley"),
        education: [
          {
            school: "Cedarcrest University",
            degree: "Bachelor of Science",
            field: "Computer Science",
            start: "2014",
            end: "2018",
          },
        ],
        experience: [
          {
            company: "Fernvale Robotics",
            title: "Senior Engineer",
            start: "2021",
            end: "Present",
            bullets: ["Led the riley-side ingestion rewrite."],
          },
          {
            company: "Harbour Data",
            title: "Engineer",
            start: "2018",
            end: "2021",
            bullets: ["Built the riley reporting service."],
          },
        ],
      },
    },
    {
      id: "canary-quinn",
      profile: {
        personal: {
          name: "Quinn Barrow",
          email: "quinn.barrow@example.com",
          phone: "+1 555 0333",
          address: "7 Maple Row",
          city: "Portland",
          state: "Oregon",
          postalCode: "97035",
          country: "United States",
          links: { linkedin: "https://linkedin.com/in/quinnbarrow" },
        },
        skills: ["Java", "Spring"],
        answerBank: answers("An industry newsletter", "quinn"),
        education: [
          {
            school: "Maplefield Institute",
            degree: "Bachelor of Science",
            field: "Computer Science",
            start: "2014",
            end: "2018",
          },
        ],
        experience: [
          {
            company: "Sablewood Labs",
            title: "Senior Engineer",
            start: "2021",
            end: "Present",
            bullets: ["Led the quinn-side ingestion rewrite."],
          },
          {
            company: "Ridgeway Cloud",
            title: "Engineer",
            start: "2018",
            end: "2021",
            bullets: ["Built the quinn reporting service."],
          },
        ],
      },
    },
  ];
}

const normalize = (s: string): string => s.trim().toLowerCase();
const digitsOf = (s: string): string => s.replace(/\D/g, "");

/** Atoms shorter than this cannot identify anyone ("no", "yes", "tx") and
 *  would only produce false hits inside ordinary words. */
const MIN_ATOM_LENGTH = 4;
/** Digit runs shorter than this are postal codes and years, not identities. */
const MIN_DIGIT_ATOM_LENGTH = 7;

/**
 * Every string in a profile that could surface in a filled value, normalized.
 * Includes derived forms the engine actually writes (first/last name splits),
 * because provenance has to recognise the profile's material after the
 * engine's own transformations.
 */
export function profileAtoms(profile: FillProfile): Set<string> {
  const atoms = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const norm = normalize(value);
    if (norm.length >= MIN_ATOM_LENGTH) atoms.add(norm);
    const digits = digitsOf(value);
    if (digits.length >= MIN_DIGIT_ATOM_LENGTH) atoms.add(digits);
  };

  const p = profile.personal;
  add(p.name);
  for (const part of p.name.split(/\s+/)) add(part);
  add(p.email);
  add(p.phone);
  add(p.address);
  add(p.city);
  add(p.state);
  add(p.country);
  add(p.postalCode);
  add(p.recentCompany);
  add(p.recentTitle);
  add(p.highestDegree);
  for (const link of Object.values(p.links)) add(link);
  for (const skill of profile.skills) add(skill);
  for (const entry of profile.answerBank) add(entry.answer);
  return atoms;
}

/** Atoms that belong to exactly ONE persona — the only material that can
 *  prove (or disprove) provenance. "United States" proves nothing. */
export function distinctiveAtoms(personas: CanaryPersona[]): Map<string, Set<string>> {
  const all = personas.map((persona) => ({ id: persona.id, atoms: profileAtoms(persona.profile) }));
  const out = new Map<string, Set<string>>();
  for (const { id, atoms } of all) {
    const others = new Set(
      all.filter((entry) => entry.id !== id).flatMap((entry) => [...entry.atoms]),
    );
    out.set(id, new Set([...atoms].filter((atom) => !others.has(atom))));
  }
  return out;
}

export interface ProvenanceLeak {
  fieldId: string;
  label: string;
  value: string;
  /** The persona whose distinctive material showed up where it must not. */
  leakedFrom: string;
  atom: string;
}

export interface ProvenanceReport {
  personaId: string;
  fields: number;
  planned: number;
  /** Values containing another persona's distinctive material. Any entry here
   *  is a bug — there is no benign reading of it. */
  leaks: ProvenanceLeak[];
  /** Non-empty planned values not traceable to any of the active persona's
   *  atoms. Not automatically bugs (derived formatting, engine constants),
   *  but the audit trail a reviewer reads before trusting a fill. */
  unexplained: { fieldId: string; label: string; value: string }[];
}

/** True when the value carries the atom, in text or in digits. */
function carries(value: string, atom: string): boolean {
  if (/^\d+$/.test(atom)) return digitsOf(value).includes(atom);
  return normalize(value).includes(atom);
}

/**
 * Replay `fields` as `activeId` and check every planned value's provenance
 * against the whole canary set.
 */
export function checkProvenance(
  fields: FieldDescriptor[],
  personas: CanaryPersona[],
  activeId: string,
): ProvenanceReport {
  const active = personas.find((persona) => persona.id === activeId);
  if (!active) throw new Error(`unknown canary persona: ${activeId}`);

  const rows: ReplayRow[] = replayForm(fields, active.profile);
  const distinct = distinctiveAtoms(personas);
  const activeAtoms = profileAtoms(active.profile);

  const leaks: ProvenanceLeak[] = [];
  const unexplained: ProvenanceReport["unexplained"] = [];
  let planned = 0;

  for (const row of rows) {
    if (row.status !== "fillable" || row.chosenValue === "") continue;
    planned += 1;

    for (const persona of personas) {
      if (persona.id === activeId) continue;
      for (const atom of distinct.get(persona.id) ?? []) {
        if (carries(row.chosenValue, atom)) {
          leaks.push({
            fieldId: row.fieldId,
            label: row.label,
            value: row.chosenValue,
            leakedFrom: persona.id,
            atom,
          });
        }
      }
    }

    const explained = [...activeAtoms].some((atom) => carries(row.chosenValue, atom));
    if (!explained)
      unexplained.push({ fieldId: row.fieldId, label: row.label, value: row.chosenValue });
  }

  return { personaId: activeId, fields: rows.length, planned, leaks, unexplained };
}
