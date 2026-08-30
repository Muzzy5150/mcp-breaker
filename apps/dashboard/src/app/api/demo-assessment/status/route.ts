import { getManagedDemoJob, jobResponse } from "@/lib/demo-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const refreshReadiness = new URL(request.url).searchParams.get("refresh") === "1";
  return jobResponse(await getManagedDemoJob().status({ ensureReadiness: true, refreshReadiness }));
}
