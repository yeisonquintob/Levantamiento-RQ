import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SignInForm } from "./sign-in-form";
import { authenticatedSignInDestination } from "./sign-in-navigation-policy";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function resolveAuthenticatedDestination() {
  const accessToken = (await cookies()).get("rq_access")?.value;
  if (!accessToken) return null;

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("mustChangePassword" in payload) ||
      typeof payload.mustChangePassword !== "boolean"
    ) {
      return null;
    }

    return authenticatedSignInDestination(payload.mustChangePassword);
  } catch {
    return null;
  }
}

export default async function SignInPage() {
  const destination = await resolveAuthenticatedDestination();
  if (destination) redirect(destination);

  return (
    <div className="rq-auth-page">
      <a className="rq-skip-link" href="#inicio-sesion">
        Saltar al formulario
      </a>

      <main className="rq-auth-main" id="inicio-sesion">
        <SignInForm />
      </main>
    </div>
  );
}
