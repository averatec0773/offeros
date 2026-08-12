// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";
import { buildFillPlan, type FillProfile } from "@offeros/autofill";

/**
 * A form with three experience rows, read off real markup.
 *
 * On a real application every one of these rows received the profile's most
 * recent job, so three employers came out as one company three times, and each
 * "Summary" went to a model that wrote a paragraph which could have described
 * anybody.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const profile: FillProfile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    address: "1 Example Way",
    recentCompany: "Northwind Systems",
    recentTitle: "Senior Engineer",
    links: {},
  },
  skills: [],
  answerBank: [],
  education: [
    {
      school: "Birchwood College",
      degree: "BSc",
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
      bullets: ["Led the ingestion rewrite."],
    },
    {
      company: "Lakeside Analytics",
      title: "Engineer",
      start: "2018",
      end: "2021",
      bullets: ["Built the reporting service."],
    },
    {
      company: "Harbour Data",
      title: "Junior Engineer",
      start: "2016",
      end: "2018",
      bullets: ["Maintained the ETL jobs."],
    },
  ],
};

const row = (n: number) => `
  <div class="crc-row">
    <label class="crm-from-label">Company</label><input id="" name="co_${n}" />
    <label class="crm-from-label">Occupation / Title</label><input id="" name="ti_${n}" />
    <label class="crm-from-label">Summary</label><textarea id="" name="su_${n}"></textarea>
    <label class="crm-from-label">Start Date</label><input id="" name="st_${n}" />
  </div>`;

const mount = () => {
  document.body.innerHTML = `<main><form>
    <div role="region" aria-label="Work Experience">${row(1)}${row(2)}${row(3)}</div>
    <div role="region" aria-label="Educational Details">
      <div class="crc-row">
        <label class="crm-from-label">School</label><input id="" name="sch_1" />
        <label class="crm-from-label">Start Date</label><input id="" name="est_1" />
      </div>
    </div>
  </form></main>`;
  const descriptors = scanFields(document.body, GENERIC_RECIPE).map((f) => f.descriptor);
  return new Map(
    buildFillPlan(descriptors, profile).map((item, i) => [descriptors[i]!.name, item]),
  );
};

describe("three rows, three jobs", () => {
  it("gives each row its own employer", () => {
    const by = mount();
    expect(by.get("co_1")!.value).toBe("Northwind Systems");
    expect(by.get("co_2")!.value).toBe("Lakeside Analytics");
    expect(by.get("co_3")!.value).toBe("Harbour Data");
  });

  it("gives each row its own title", () => {
    const by = mount();
    expect(by.get("ti_1")!.value).toBe("Senior Engineer");
    expect(by.get("ti_3")!.value).toBe("Junior Engineer");
  });

  it("fills each Summary from that job's own bullets, with no model involved", () => {
    const by = mount();
    expect(by.get("su_1")!.value).toBe("Led the ingestion rewrite.");
    expect(by.get("su_2")!.value).toBe("Built the reporting service.");
    expect(by.get("su_1")!.source).toBe("personal");
    expect(by.get("su_1")!.generatable).toBeUndefined();
  });

  it("reads a bare date from the section it sits in", () => {
    // "Start Date" appears in both sections and means a different thing in each.
    const by = mount();
    expect(by.get("st_1")!.value).toBe("2021");
    expect(by.get("est_1")!.value).toBe("2014");
  });

  it("keeps the education row on its own list", () => {
    const by = mount();
    expect(by.get("sch_1")!.value).toBe("Birchwood College");
  });
});
