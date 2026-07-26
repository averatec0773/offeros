// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ArtifactViewer } from "../artifact-viewer";
import type { Artifact } from "@offeros/core";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const artifact: Artifact = {
  id: "a1",
  taskId: "t1",
  kind: "resume",
  versions: [
    {
      id: "v1",
      content: "Jordan Rivera\nLed the ML pipeline redesign",
      rationale: "Initial tailored draft.",
      changedLines: ["Led the ML pipeline redesign"],
      createdAt: 1,
    },
    {
      id: "v2",
      content: "Jordan Rivera\nLed the ML pipeline redesign, cutting latency 40%",
      rationale: "Applied the tweak.",
      changedLines: ["Led the ML pipeline redesign, cutting latency 40%"],
      createdAt: 2,
    },
  ],
  currentVersionId: "v2",
  createdAt: 1,
  updatedAt: 2,
};

describe("ArtifactViewer", () => {
  it("renders the current version's content and highlights its changed lines", () => {
    render(<ArtifactViewer artifact={artifact} />);

    expect(screen.getByText("Jordan Rivera")).toBeTruthy();
    const changedLine = screen.getByText("Led the ML pipeline redesign, cutting latency 40%");
    expect(changedLine.className).toContain("bg-brand/15");
  });

  it("switches versions when a version button is clicked", () => {
    render(<ArtifactViewer artifact={artifact} />);

    fireEvent.click(screen.getByRole("button", { name: "v1" }));

    expect(screen.getByText("Led the ML pipeline redesign")).toBeTruthy();
    expect(screen.queryByText("Led the ML pipeline redesign, cutting latency 40%")).toBeNull();
  });
});

const structuredArtifact: Artifact = {
  id: "a2",
  taskId: "t1",
  kind: "resume",
  versions: [
    {
      id: "v1",
      content: "Jordan Rivera\njordan@example.com\n\nSUMMARY\nML engineer.",
      rationale: "Initial tailored draft.",
      changedLines: ["Led the ML pipeline redesign, cutting latency 40%."],
      resumeData: {
        summary: "ML engineer.",
        experience: [
          {
            company: "Acme",
            title: "ML Engineer",
            dates: "2021 – Present",
            bullets: ["Led the ML pipeline redesign, cutting latency 40%.", "Shipped a service."],
          },
        ],
        education: [
          {
            school: "UT Austin",
            degree: "BS",
            field: "Computer Science",
            dates: "2016 – 2020",
            details: "",
          },
        ],
        skills: ["Python", "Machine Learning"],
      },
      createdAt: 1,
    },
  ],
  currentVersionId: "v1",
  createdAt: 1,
  updatedAt: 1,
};

describe("ArtifactViewer structured résumé view", () => {
  it("renders header, summary, experience bullets, education, and skills from resumeData", () => {
    render(<ArtifactViewer artifact={structuredArtifact} />);

    expect(screen.getByText("Jordan Rivera")).toBeTruthy();
    expect(screen.getByText("jordan@example.com")).toBeTruthy();
    expect(screen.getByText("ML engineer.")).toBeTruthy();
    expect(screen.getByText(/ML Engineer/)).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
    const changedBullet = screen.getByText(/Led the ML pipeline redesign, cutting latency 40%\./);
    expect(changedBullet.className).toContain("bg-brand/15");
    const unchangedBullet = screen.getByText(/Shipped a service\./);
    expect(unchangedBullet.className).not.toContain("bg-brand/15");
    expect(screen.getByText(/UT Austin/)).toBeTruthy();
    expect(screen.getByText(/Python, Machine Learning/)).toBeTruthy();
  });

  it("falls back to the raw text render for a resume version without resumeData", () => {
    const { container } = render(<ArtifactViewer artifact={artifact} />);
    expect(screen.getByText("Jordan Rivera")).toBeTruthy();
    // No resumeData → the <pre> text fallback renders, not the structured view.
    expect(container.querySelector("pre")).toBeTruthy();
    expect(screen.queryByText("Summary")).toBeNull();
  });
});

const structuredArtifactWithBlankEntries: Artifact = {
  id: "a3",
  taskId: "t1",
  kind: "resume",
  versions: [
    {
      id: "v1",
      content: "Jordan Rivera\njordan@example.com",
      rationale: "Initial tailored draft.",
      resumeData: {
        summary: "",
        experience: [
          { company: "", title: "", dates: "", bullets: [] },
          {
            company: "Acme",
            title: "ML Engineer",
            dates: "2021 – Present",
            bullets: ["Shipped a service."],
          },
        ],
        education: [
          { school: "", degree: "", field: "", dates: "", details: "" },
          {
            school: "UT Austin",
            degree: "BS",
            field: "Computer Science",
            dates: "2016 – 2020",
            details: "",
          },
        ],
        skills: [],
      },
      createdAt: 1,
    },
  ],
  currentVersionId: "v1",
  createdAt: 1,
  updatedAt: 1,
};

describe("ArtifactViewer structured résumé view — blank entries", () => {
  it("skips an all-blank experience/education entry instead of rendering a bare row", () => {
    render(<ArtifactViewer artifact={structuredArtifactWithBlankEntries} />);
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(screen.getByText(/UT Austin/)).toBeTruthy();
    // Only the real entries render — no bare "— ()" row for the blank ones.
    expect(screen.queryByText(/^—\s*\(\)$/)).toBeNull();
  });
});

describe("ArtifactViewer Download PDF", () => {
  function stubObjectUrl() {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    return { createObjectURL, revokeObjectURL };
  }

  it("requests the pdf route for the artifact's kind and task", async () => {
    stubObjectUrl();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ArtifactViewer artifact={artifact} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/agent/tasks/t1/artifacts/resume/pdf");
  });

  it("downloads the blob using the server's filename and shows a render note", async () => {
    const { createObjectURL } = stubObjectUrl();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="Acme_Engineer_Resume_2026-07-24.pdf"',
          "x-offeros-render-note":
            "rendered with the builtin renderer — no LaTeX template/pdflatex",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ArtifactViewer artifact={artifact} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() =>
      expect(screen.getByText(/rendered with the builtin renderer/i)).toBeTruthy(),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("Acme_Engineer_Resume_2026-07-24.pdf");

    clickSpy.mockRestore();
  });

  it("shows the enveloped error message when the pdf route fails", async () => {
    stubObjectUrl();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: false,
          errorCode: 40000,
          errorMsg:
            "pdflatex failed to compile the résumé\n\n! Undefined control sequence.\nl.42 \\foo",
          result: null,
        },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ArtifactViewer artifact={artifact} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));

    await waitFor(() =>
      expect(screen.getByText("pdflatex failed to compile the résumé")).toBeTruthy(),
    );
    expect(screen.queryByText(/Undefined control sequence/)).toBeNull();

    fireEvent.click(screen.getByText(/Show details/i));
    expect(screen.getByText(/Undefined control sequence/)).toBeTruthy();
  });

  it("disables the button and shows a busy label while generating", async () => {
    stubObjectUrl();
    let resolveFetch: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ArtifactViewer artifact={artifact} />);
    const button = screen.getByRole("button", { name: /Download PDF/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/Generating/i)).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: /Generating/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveFetch!(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    await waitFor(() => expect(screen.getByText(/Download PDF/i)).toBeTruthy());
  });
});
