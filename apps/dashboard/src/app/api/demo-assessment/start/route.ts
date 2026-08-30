import { ManagedDemoConflictError } from "@mcp-breaker/evaluation";

import { getManagedDemoJob, jobResponse, localMutationError } from "../../../../lib/demo-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  const rejected = localMutationError(request);
  if (rejected !== undefined) {
    return rejected;
  }
  try {
    return jobResponse(getManagedDemoJob().startAssessment(), 202);
  } catch (error) {
    if (error instanceof ManagedDemoConflictError || error instanceof Error && error.name === "ManagedDemoConflictError") {
      return jobResponse({ error: error.message, job: getManagedDemoJob().snapshot() }, 409);
    }
    throw error;
  }
}
