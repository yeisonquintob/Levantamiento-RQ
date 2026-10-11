import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ProjectListResponse } from "@levantamiento-rq/shared-contracts";

import { ExecutionWorkspace } from "./execution-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export default async function ExecutionPage() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");

  let projects: ProjectListResponse["items"] = [];
  let error: string | undefined;
  try {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`,
      {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      },
    );
    if (response.status === 401) redirect("/sign-in");
    if (!response.ok) throw new Error();
    projects = ((await response.json()) as ProjectListResponse).items;
  } catch {
    error = "No fue posible cargar los proyectos disponibles.";
  }

  return <ExecutionWorkspace initialError={error} projects={projects} />;
}
