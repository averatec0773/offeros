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

export const profileSchema = z.object({
  personal: personalSchema,
  skills: z.array(z.string()).default([]),
  education: z.array(educationSchema).default([]),
  experience: z.array(experienceSchema).default([]),
});

export const resumeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  isPrimary: z.boolean().default(false),
  targetRole: z.string().optional(),
  note: z.string().optional(),
  text: z.string().optional(),
  createdAt: z.number(),
});

export type Links = z.infer<typeof linksSchema>;
export type Personal = z.infer<typeof personalSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type AnswerEntry = z.infer<typeof answerSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ResumeSummary = z.infer<typeof resumeSchema>;
