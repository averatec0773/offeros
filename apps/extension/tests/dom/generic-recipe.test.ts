// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { looksLikeApplicationForm, matchAts, GENERIC_RECIPE } from "../../src/lib/autofill/recipes";

/**
 * Whether an arbitrary page is worth offering to fill.
 *
 * This runs only after the user has enabled OfferOS on a page, and it decides
 * whether the engine registers at all. It is deliberately wrong in the safe
 * direction: a missed application form leaves the user filling it themselves,
 * which is where they already were, while a false positive puts their phone
 * number in a newsletter box on a page that never asked for it.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document;
};

describe("what counts as an application form", () => {
  it("a file upload is close to conclusive — résumés do not appear on comment boxes", () => {
    mount(`<form><label for="r">Resume</label><input id="r" type="file" /></form>`);
    expect(looksLikeApplicationForm(document)).toBe(true);
  });

  it("three or more labelled questions count", () => {
    mount(`<form>
      <label for="a">Full name</label><input id="a" />
      <label for="b">Email</label><input id="b" />
      <label for="c">Why do you want this role?</label><textarea id="c"></textarea>
    </form>`);
    expect(looksLikeApplicationForm(document)).toBe(true);
  });

  it("counts aria-labelled and label-wrapped controls too", () => {
    mount(`<form>
      <input aria-label="Full name" />
      <label>Email <input /></label>
      <span id="lbl">Phone</span><input aria-labelledby="lbl" />
    </form>`);
    expect(looksLikeApplicationForm(document)).toBe(true);
  });
});

describe("what does not", () => {
  it("a newsletter signup", () => {
    mount(`<form><label for="e">Email</label><input id="e" type="email" />
      <button>Subscribe</button></form>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("a search box", () => {
    mount(`<form><input aria-label="Search" type="search" /></form>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("a two-field login", () => {
    mount(`<form>
      <label for="u">Username</label><input id="u" />
      <label for="p">Password</label><input id="p" type="password" />
    </form>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("a blog comment box", () => {
    mount(`<article><p>A post.</p>
      <form><label for="c">Leave a comment</label><textarea id="c"></textarea></form>
    </article>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("three UNLABELLED inputs — a page we cannot read is not one we should fill", () => {
    mount(`<form><input /><input /><input /></form>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("a page with no form at all", () => {
    mount(`<main><h1>About us</h1><p>We are a company.</p></main>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });

  it("does not add up separate small forms into one application", () => {
    // A search box in the header plus a newsletter box in the footer is three
    // labelled fields on the page and zero application forms.
    mount(`<header><form><label for="s">Search</label><input id="s" /></form></header>
      <footer><form><label for="e">Email</label><input id="e" />
      <label for="z">Zip</label><input id="z" /></form></footer>`);
    expect(looksLikeApplicationForm(document)).toBe(false);
  });
});

describe("the generic recipe stays out of automatic matching", () => {
  it("is never returned for a URL", () => {
    // Automatic injection is unchanged: an unknown host still matches nothing.
    for (const url of [
      "https://careers.example.com/apply",
      "https://ats.example.com/jobs/1",
      "https://example.com",
    ]) {
      expect(matchAts(url), url).toBeNull();
    }
  });

  it("carries no site knowledge — a plain form selector and nothing else", () => {
    expect(GENERIC_RECIPE.urlPatterns).toEqual([]);
    expect(GENERIC_RECIPE.formSelector).toBe("form");
    expect(GENERIC_RECIPE.pierceShadow).toBeUndefined();
  });
});
