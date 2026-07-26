// Synthetic persona used to fill captured real-world forms in the captured-form
// eval harness (packages/autofill/src/__tests__/adaptation/captured-report.ts).
// "Jordan Rivera" is not a real person — values match the ground-truth fixtures
// under captured/*.groundtruth.json.

import type { FillProfile } from "../../../types";

export const JORDAN_RIVERA_PROFILE: FillProfile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan.rivera@example.com",
    phone: "+1 555 0100",
    address: "",
    country: "United States",
    links: {},
  },
  skills: ["TypeScript", "React", "Python"],
  answerBank: [
    {
      id: "authorized-to-work",
      questionPatterns: ["authorized to work"],
      answer: "Yes",
      type: "boolean",
      category: "eeo",
    },
    {
      id: "sponsorship",
      questionPatterns: ["require visa sponsorship", "visa sponsorship"],
      answer: "No",
      type: "boolean",
      category: "eeo",
    },
  ],
};
