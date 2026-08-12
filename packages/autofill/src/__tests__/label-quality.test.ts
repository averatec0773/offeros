import { describe, it, expect } from "vitest";
import {
  isTransientText,
  isUsableLabel,
  looksLikeCaptcha,
  looksLikeIdentifier,
} from "../label-quality";

/**
 * Table-driven, because the rules are a table.
 *
 * Every rejected string here was seen on a real application form, listed to the
 * user as though it were a question. Every accepted one is an ordinary label
 * that must survive: the cost of over-rejecting is a field that goes to the AI
 * classifier unnecessarily, and the cost of under-rejecting is a form filled
 * from a question nobody asked.
 */

describe("widget states are not questions", () => {
  it.each([
    "Loading",
    "Loading...",
    "Loading…",
    "  loading  ",
    "No Results Found",
    "no results",
    "No matches found",
    "-None-",
    "— None —",
    "[none]",
    "None",
    "Select",
    "Select one",
    "Select an option",
    "Choose",
    "Search",
    "N/A",
    "--",
    "",
    "   ",
  ])("%o is a state, not a label", (text) => {
    expect(isTransientText(text)).toBe(true);
    expect(isUsableLabel(text)).toBe(false);
  });

  it.each([
    "Have you experience with load testing?",
    "Select the roles you have held",
    "Search experience (years)",
    "None of the above — please explain",
  ])("%o contains a state word but is a real question", (text) => {
    expect(isTransientText(text)).toBe(false);
    expect(isUsableLabel(text)).toBe(true);
  });
});

describe("machine names are not questions", () => {
  it.each([
    "rec-form_682152000000063542",
    "682152000000063542",
    "field_12345",
    "firstNameInput",
    "emailAddress",
    "field.name.first",
    "input-1",
    "rec-form_682152000000063542 rec-form_682152000000063550",
  ])("%o reads as an identifier", (text) => {
    expect(looksLikeIdentifier(text)).toBe(true);
    expect(isUsableLabel(text)).toBe(false);
  });

  it.each([
    "First Name",
    "Email",
    "Phone",
    "Why do you want to work here?",
    "LinkedIn Profile URL",
    "Are you legally authorized to work in the US?",
    "Résumé/CV",
    "Salary expectation (USD)",
    "Zip",
  ])("%o reads as a question", (text) => {
    expect(looksLikeIdentifier(text)).toBe(false);
    expect(isUsableLabel(text)).toBe(true);
  });

  it("keeps a lone ordinary word — a weak label is still a label", () => {
    // "Email" on its own is what half the forms in the world use.
    expect(isUsableLabel("Email")).toBe(true);
    expect(isUsableLabel("Phone")).toBe(true);
  });

  it("rejects a paragraph that swallowed the control", () => {
    expect(isUsableLabel("x".repeat(201))).toBe(false);
    expect(isUsableLabel("x".repeat(120))).toBe(true);
  });

  it("rejects a non-string rather than trusting it", () => {
    expect(isUsableLabel(null)).toBe(false);
    expect(isUsableLabel(undefined)).toBe(false);
  });
});

/**
 * A CAPTCHA is a site asking whether a person is present. Answering it for the
 * user would be lying to the employer for them, so it is never attempted — not
 * because it is hard, but because it is not ours to answer.
 */
describe("CAPTCHAs are recognised so they can be handed back", () => {
  it.each([
    { label: "Type below image text" },
    { label: "Enter the characters you see" },
    { label: "Security check" },
    { label: "Are you a human?" },
    { name: "g-recaptcha-response" },
    { id: "h-captcha-response" },
    { containerText: "I'm not a robot" },
    { containerText: "cf-turnstile widget" },
  ])("%o is a CAPTCHA", (subject) => {
    expect(looksLikeCaptcha(subject)).toBe(true);
  });

  it.each([
    { label: "First Name" },
    { label: "Why this company?" },
    { label: "Have you been checked for security clearance?" },
    {},
  ])("%o is an ordinary field", (subject) => {
    expect(looksLikeCaptcha(subject)).toBe(false);
  });
});
