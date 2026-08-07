import { describe, expect, it } from "vitest";
import { classifyField, isCoverLetterLabel, type FieldDescriptor } from "../classify";

const d = (partial: Partial<FieldDescriptor>): FieldDescriptor => ({
  fieldId: "f1",
  label: "",
  name: "",
  autocomplete: "",
  type: "text",
  placeholder: "",
  ariaLabel: "",
  ...partial,
});

describe("classifyField", () => {
  it("uses autocomplete first (most reliable)", () => {
    expect(classifyField(d({ autocomplete: "email" }))).toBe("email");
    expect(classifyField(d({ autocomplete: "tel" }))).toBe("phone");
    expect(classifyField(d({ autocomplete: "given-name" }))).toBe("firstName");
    expect(classifyField(d({ autocomplete: "family-name" }))).toBe("lastName");
  });

  it("classifies by label text", () => {
    expect(classifyField(d({ label: "Email address" }))).toBe("email");
    expect(classifyField(d({ label: "Phone number" }))).toBe("phone");
    expect(classifyField(d({ label: "First name" }))).toBe("firstName");
    expect(classifyField(d({ label: "Last name" }))).toBe("lastName");
    expect(classifyField(d({ label: "Full name" }))).toBe("fullName");
    expect(classifyField(d({ label: "LinkedIn Profile" }))).toBe("linkedin");
    expect(classifyField(d({ label: "GitHub URL" }))).toBe("github");
    expect(classifyField(d({ label: "Portfolio / Website" }))).toBe("portfolio");
  });

  it("classifies a file input labeled resume", () => {
    expect(classifyField(d({ type: "file", label: "Resume/CV" }))).toBe("resume");
  });

  it("classifies a file input labeled cover letter as coverLetter", () => {
    expect(classifyField(d({ type: "file", label: "Cover Letter" }))).toBe("coverLetter");
    expect(classifyField(d({ type: "file", label: "Upload your cover letter" }))).toBe(
      "coverLetter",
    );
    expect(classifyField(d({ type: "file", label: "Motivation Letter" }))).toBe("coverLetter");
  });

  it("does not classify a non-file cover-letter field as coverLetter (textareas stay ungoverned by the classifier)", () => {
    expect(classifyField(d({ type: "textarea", label: "Cover Letter" }))).toBeNull();
    expect(classifyField(d({ type: "text", label: "Cover Letter" }))).toBeNull();
  });

  it("classifies a hyphenated cover-letter file label (isCoverLetterLabel is the shared matcher with task-mode)", () => {
    expect(classifyField(d({ type: "file", label: "Cover-Letter" }))).toBe("coverLetter");
  });

  it("falls back to name/id tokens when there is no label", () => {
    expect(classifyField(d({ name: "candidate_email" }))).toBe("email");
    expect(classifyField(d({ name: "first_name" }))).toBe("firstName");
  });

  it("does not misclassify a generic question", () => {
    expect(classifyField(d({ label: "Why do you want to work here?" }))).toBeNull();
    expect(classifyField(d({ label: "Are you authorized to work in the US?" }))).toBeNull();
  });

  it("prefers firstName/lastName over fullName when both words present", () => {
    expect(classifyField(d({ label: "First Name" }))).toBe("firstName");
  });

  it("handles compound autocomplete values (section/scope prefixes)", () => {
    expect(classifyField(d({ autocomplete: "section-contact email" }))).toBe("email");
    expect(classifyField(d({ autocomplete: "shipping street-address" }))).toBe("address");
    expect(classifyField(d({ autocomplete: "home tel" }))).toBe("phone");
  });

  it("ignores autocomplete values with no mapped token", () => {
    expect(classifyField(d({ autocomplete: "off" }))).toBeNull();
    expect(classifyField(d({ autocomplete: "on", label: "Email" }))).toBe("email");
  });
});

describe("isCoverLetterLabel", () => {
  it("matches regardless of hyphenation/punctuation — the single source of truth shared with task-mode's isCoverLetterField", () => {
    expect(isCoverLetterLabel("Cover Letter")).toBe(true);
    expect(isCoverLetterLabel("Cover-Letter")).toBe(true);
    expect(isCoverLetterLabel("Cover_Letter")).toBe(true);
    expect(isCoverLetterLabel("Motivation Letter")).toBe(true);
  });

  it("rejects unrelated labels", () => {
    expect(isCoverLetterLabel("Why do you want this role?")).toBe(false);
    expect(isCoverLetterLabel("")).toBe(false);
  });
});

describe("classifyField precision fixes", () => {
  it("does not misclassify a location/city question as address", () => {
    expect(classifyField(d({ label: "What is your current location?" }))).toBeNull();
    expect(classifyField(d({ label: "Preferred work location" }))).toBeNull();
  });

  it("classifies a combined First and Last Name field as fullName", () => {
    expect(classifyField(d({ label: "First and Last Name" }))).toBe("fullName");
    expect(classifyField(d({ label: "Full Legal Name" }))).toBe("fullName");
  });

  it("still classifies a real address field", () => {
    expect(classifyField(d({ label: "Street address" }))).toBe("address");
    expect(classifyField(d({ autocomplete: "street-address" }))).toBe("address");
  });

  it("classifies Ashby's Legal Name as fullName", () => {
    expect(classifyField(d({ label: "Legal Name" }))).toBe("fullName");
  });

  it("does not apply personal rules to long question-like labels", () => {
    expect(
      classifyField(
        d({
          label: "We would like to contact you via SMS or WhatsApp to provide updates via email",
        }),
      ),
    ).toBeNull();
    expect(classifyField(d({ label: "Email address" }))).toBe("email");
  });

  it("does not classify 'Other website' as portfolio", () => {
    expect(classifyField(d({ label: "Other website" }))).toBeNull();
  });

  it("classifies hyphenated 'E-mail' as email", () => {
    expect(classifyField(d({ label: "E-mail" }))).toBe("email");
    expect(classifyField(d({ label: "E-mail address" }))).toBe("email");
  });

  it("classifies 'Cell' and 'Contact Number' as phone", () => {
    expect(classifyField(d({ label: "Cell" }))).toBe("phone");
    expect(classifyField(d({ label: "Cell phone" }))).toBe("phone");
    expect(classifyField(d({ label: "Contact Number" }))).toBe("phone");
  });

  it("does not treat 'cell' inside another word as phone", () => {
    expect(classifyField(d({ label: "Cancellation policy" }))).toBeNull();
  });

  it("does not treat the 'e mail' seam in 'Mailing Address' as email", () => {
    expect(classifyField(d({ label: "Home Mailing Address" }))).toBe("address");
    expect(classifyField(d({ name: "home_mailing_address" }))).toBe("address");
  });
});

describe("per-signal matching (placeholder must not poison the label)", () => {
  const base = { fieldId: "f", name: "", autocomplete: "", type: "text", placeholder: "", ariaLabel: "" };
  it("bare 'Name' with a generic placeholder still classifies as fullName", () => {
    expect(classifyField({ ...base, label: "Name", placeholder: "Type here..." })).toBe("fullName");
  });
  it("verbose linkedin question classifies despite a placeholder", () => {
    expect(
      classifyField({ ...base, label: "Please add your LinkedIn profile", placeholder: "Type here..." }),
    ).toBe("linkedin");
  });
  it("most recent company / job title map to the new canonicals", () => {
    expect(classifyField({ ...base, label: "What is your most recent company?" })).toBe("recentCompany");
    expect(classifyField({ ...base, label: "What is your most recent job title?" })).toBe("recentTitle");
  });
  it("choice controls are never text-classified (option label containing 'city')", () => {
    expect(classifyField({ ...base, label: "New York City Office", type: "checkbox" })).toBeNull();
    expect(classifyField({ ...base, label: "Yes - I consent to receiving text messages", type: "radio" })).toBeNull();
    expect(classifyField({ ...base, label: "Which office?", type: "radio-group", options: ["A"] })).toBeNull();
  });
});
