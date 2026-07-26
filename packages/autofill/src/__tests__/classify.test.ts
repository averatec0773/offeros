import { describe, expect, it } from "vitest";
import { classifyField, type FieldDescriptor } from "../classify";

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
