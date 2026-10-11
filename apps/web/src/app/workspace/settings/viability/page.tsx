import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ViabilityConfiguration } from "@levantamiento-rq/shared-contracts";
import { ViabilityWorkspace } from "./viability-workspace";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";
export default async function ViabilityPage() {
  const token = (await cookies()).get("rq_access")?.value;
  if (!token) redirect("/sign-in");
  const response = await fetch(`${GATEWAY_URL}/api/v1/viability-criteria`, { cache: "no-store", headers: { cookie: `rq_access=${encodeURIComponent(token)}` } });
  if (response.status === 401) redirect("/sign-in");
  return <ViabilityWorkspace initialConfiguration={response.ok ? await response.json() as ViabilityConfiguration : undefined} initialError={response.ok ? undefined : "No fue posible cargar los criterios de viabilidad."} />;
}
