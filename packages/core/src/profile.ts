import { z } from "zod";

export const linksSchema = z.object({
  linkedin: z.string().optional(),
  github: z.string().optional(),
  portfolio: z.string().optional(),
});

export const personalSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  links: linksSchema.default({}),
});

export const educationSchema = z.object({
  id: z.string().min(1),
  school: z.string(),
  degree: z.string(),
  field: z.string(),
  gpa: z.string().optional(),
  start: z.string(),
  end: z.string(),
});

export const experienceSchema = z.object({
  id: z.string().min(1),
  company: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(z.string()).default([]),
});

export const answerSchema = z.object({
  id: z.string().min(1),
  questionPatterns: z.array(z.string().min(1)).min(1),
  answer: z.string(),
  type: z.enum(["enum", "text", "number", "boolean"]),
  category: z.enum(["eeo", "screening", "custom"]),
});

/**
 * A piece of work the applicant can point at. Engineering applications ask for
 * these constantly ("share 1-3 links to relevant work and briefly describe
 * what you built"), and a link with no framing is worth much less than one
 * with the stack and the outcome — so the shape carries both, once, instead of
 * being reinvented per application.
 */
export const evidenceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().default(""),
  /** One sentence, first person: what you built and why it mattered. */
  summary: z.string().default(""),
  /** Technologies — also the matching signal against a job's requirements. */
  stack: z.array(z.string()).default([]),
  /** The measurable result, in the applicant's own words. */
  outcome: z.string().default(""),
});

/**
 * A rated answer the applicant has committed to ("Python proficiency: High").
 * Real forms ask these repeatedly across companies; answering "High" at one
 * and "Medium" at the next is a self-inflicted inconsistency, so the canonical
 * answer lives here and every application reads from it.
 */
export const selfAssessmentSchema = z.object({
  id: z.string().min(1),
  /** The subject as the applicant thinks of it: "Python", "System design". */
  topic: z.string().min(1),
  /** Their answer, in the vocabulary forms use: "High", "Daily", "Advanced". */
  level: z.string().min(1),
  /** Optional justification, usable as grounding for a written answer. */
  note: z.string().default(""),
});

export const profileSchema = z.object({
  personal: personalSchema,
  skills: z.array(z.string()).default([]),
  education: z.array(educationSchema).default([]),
  experience: z.array(experienceSchema).default([]),
  // Optional rather than defaulted: a profile written before these existed
  // stays valid as-is, and every read site already treats absence as empty.
  evidence: z.array(evidenceSchema).optional(),
  selfAssessments: z.array(selfAssessmentSchema).optional(),
});

export const resumeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  isPrimary: z.boolean().default(false),
  targetRole: z.string().optional(),
  note: z.string().optional(),
  text: z.string().optional(),
  /** A hint, not a guarantee — the underlying file may still be missing (e.g. an
   *  out-of-band deletion). The file route's 404 is the real, authoritative check. */
  hasFile: z.boolean().default(false),
  createdAt: z.number(),
});

export type Links = z.infer<typeof linksSchema>;
export type Personal = z.infer<typeof personalSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type SelfAssessment = z.infer<typeof selfAssessmentSchema>;
export type AnswerEntry = z.infer<typeof answerSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ResumeSummary = z.infer<typeof resumeSchema>;
