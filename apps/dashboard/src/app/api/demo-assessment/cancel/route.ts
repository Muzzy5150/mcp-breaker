import { ManagedDemoNotReadyError } from "@mcp-breaker/evaluation";

import { getManagedDemoJob, jobResponse, localMutationError } from "@/lib/demo-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejected = localMutationError(request);
  if (rejected !== undefined) {
    return rejected;
  }
  try {
    return jobResponse(await getManagedDemoJob().cancel());
  } catch (error) {
    if (error instanceof ManagedDemoNotReadyError) {
      return jobResponse({ error: error.message, job: getManagedDemoJob().snapshot() }, 409);
    }
    throw error;
  }
}
