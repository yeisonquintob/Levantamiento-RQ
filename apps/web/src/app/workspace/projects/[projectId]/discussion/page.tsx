import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type {
  ProjectDetail,
  ProjectListResponse,
  ViabilityConfiguration,
} from "@levantamiento-rq/shared-contracts";

import { RequirementDiscussionWorkspace } from "./requirement-discussion-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export default async function RequirementDiscussionPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [{ projectId }, cookieStore] = await Promise.all([params, cookies()]);
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");

  let response: Response;
  let projectsResponse: Response;
  let viabilityResponse: Response;
  try {
    [response, projectsResponse, viabilityResponse] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      }),
      fetch(`${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`, {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      }),
      fetch(`${GATEWAY_URL}/api/v1/viability-criteria`, { cache: "no-store", headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` } }),
    ]);
  } catch {
    throw new Error("No fue posible consultar el proyecto seleccionado.");
  }

  if (response.status === 401 || projectsResponse.status === 401)
    redirect("/sign-in");
  if (response.status === 404) notFound();
  if (!response.ok || !projectsResponse.ok) {
    throw new Error("No fue posible abrir la discusión del proyecto.");
  }

  return (
    <RequirementDiscussionWorkspace
      project={(await response.json()) as ProjectDetail}
      projects={((await projectsResponse.json()) as ProjectListResponse).items}
      viability={viabilityResponse.ok ? await viabilityResponse.json() as ViabilityConfiguration : undefined}
    />
  );
}
