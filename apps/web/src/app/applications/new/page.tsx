import { JobComposer } from "@/components/agent/job-composer";

export default function NewApplicationPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="mb-6 text-heading font-semibold">Add a job</h1>
      <JobComposer />
    </main>
  );
}
