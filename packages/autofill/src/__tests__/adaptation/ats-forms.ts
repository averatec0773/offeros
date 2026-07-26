// Realistic ATS application-form shapes, expressed as the field descriptors the
// scanner would produce. Each fillable field declares the canonical target it
// SHOULD resolve to (`expects`) — this is the form's ground truth, kept
// independent of the classifier so a classify miss scores as a miss rather than
// being silently skipped. `expects: "skip"` marks controls the engine must
// leave alone (file uploads, free-text questions, location comboboxes).

import type { FieldDescriptor } from "../../classify";

export type ExpectedTarget =
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "address"
  | "linkedin"
  | "github"
  | "portfolio"
  | "skip";

export interface FormField {
  expects: ExpectedTarget;
  desc: Partial<FieldDescriptor>;
}

export interface AtsForm {
  id: string;
  fields: FormField[];
}

const f = (expects: ExpectedTarget, desc: Partial<FieldDescriptor>): FormField => ({
  expects,
  desc,
});

export const ATS_FORMS: AtsForm[] = [
  {
    id: "greenhouse",
    fields: [
      f("firstName", { label: "First Name", required: true }),
      f("lastName", { label: "Last Name", required: true }),
      f("email", { label: "Email", required: true }),
      f("phone", { label: "Phone" }),
      f("skip", { type: "file", label: "Resume/CV" }),
      f("linkedin", { label: "LinkedIn Profile" }),
      f("portfolio", { label: "Website" }),
      f("skip", { label: "Why do you want to work here?" }),
    ],
  },
  {
    id: "lever",
    fields: [
      f("fullName", { label: "Full name", required: true }),
      f("email", { label: "Email", required: true }),
      f("phone", { label: "Phone" }),
      f("skip", { type: "file", label: "Resume/CV" }),
      f("linkedin", { label: "LinkedIn URL" }),
      f("github", { label: "GitHub URL" }),
      f("portfolio", { label: "Portfolio or personal website" }),
      f("skip", { label: "What is your desired salary?" }),
    ],
  },
  {
    id: "ashby",
    fields: [
      f("fullName", { label: "Name", required: true }),
      f("email", { label: "Email", required: true }),
      f("linkedin", { label: "LinkedIn", required: true }),
      f("github", { label: "GitHub" }),
      f("skip", { type: "file", label: "Resume" }),
      f("skip", { label: "Location" }),
    ],
  },
  {
    id: "icims",
    fields: [
      f("firstName", { label: "First Name", name: "firstName", required: true }),
      f("lastName", { label: "Last Name", name: "lastName", required: true }),
      f("email", { label: "Email Address", required: true }),
      f("phone", { label: "Mobile Number" }),
      f("address", { label: "Address" }),
      f("skip", { type: "file", label: "Attach Resume" }),
    ],
  },
  {
    // Edge-label form: the same nine values under the harder labels real ATS use.
    id: "edge-labels",
    fields: [
      f("firstName", { label: "Given Name" }),
      f("lastName", { label: "Surname" }),
      f("email", { label: "E-mail" }),
      f("phone", { label: "Cell" }),
      f("phone", { label: "Contact Number", name: "contactNumber" }),
      f("linkedin", { label: "LinkedIn profile URL" }),
      f("github", { label: "GitHub username or URL" }),
      f("portfolio", { label: "Personal Website" }),
      f("fullName", { label: "Full Legal Name" }),
    ],
  },
];

export function toDescriptor(field: FormField, index: number): FieldDescriptor {
  return {
    fieldId: `f${index}`,
    label: "",
    name: "",
    autocomplete: "",
    type: "text",
    placeholder: "",
    ariaLabel: "",
    ...field.desc,
  };
}
