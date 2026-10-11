const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

let activeRefresh: Promise<Response> | null = null;

function refreshSession(): Promise<Response> {
  if (!activeRefresh) {
    activeRefresh = fetch(`${GATEWAY_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    }).finally(() => {
      activeRefresh = null;
    });
  }

  return activeRefresh;
}

/**
 * Ejecuta una petición autenticada y, ante un access token vencido, renueva
 * la sesión y repite exactamente una vez. Una falla transitoria del refresh
 * nunca se interpreta como cierre de sesión.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (response.status !== 401) return response;

  const refresh = await refreshSession();

  if (refresh.ok) {
    return fetch(input, {
      ...init,
      credentials: "include",
    });
  }

  if (refresh.status === 401 || refresh.status === 403) {
    window.location.assign("/sign-in?reason=expired");
    throw new Error("Sesión vencida.");
  }

  throw new Error("No fue posible renovar la sesión en este momento.");
}
