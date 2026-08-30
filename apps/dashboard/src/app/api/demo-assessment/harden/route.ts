import { ManagedDemoConflictError, ManagedDemoNotReadyError } from "@mcp-breaker/evaluation";

import { getManagedDemoJob, jobResponse, localMutationError } from "../../../../lib/demo-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  const rejected = localMutationError(request);
  if (rejected !== undefined) {
    return rejected;
  }
  try {
    return jobResponse(getManagedDemoJob().startHardening(), 202);
  } catch (error) {
    if (
      error instanceof ManagedDemoConflictError ||
      error instanceof ManagedDemoNotReadyError ||
      error instanceof Error && (error.name === "ManagedDemoConflictError" || error.name === "ManagedDemoNotReadyError")
    ) {
      return jobResponse({ error: error.message, job: getManagedDemoJob().snapshot() }, 409);
    }
    throw error;
  }
}
