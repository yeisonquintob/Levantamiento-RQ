export type SignInReason = "expired" | "inactivity";

export interface SignInUrlPolicyResult {
  changed: boolean;
  reason: SignInReason | null;
  safeSearch: string;
}

const ALLOWED_REASONS = new Set<SignInReason>(["expired", "inactivity"]);

export function applySignInUrlPolicy(search: string): SignInUrlPolicyResult {
  const original = search.startsWith("?") ? search.slice(1) : search;
  const parameters = new URLSearchParams(original);
  const candidate = parameters.get("reason");
  const reason =
    candidate && ALLOWED_REASONS.has(candidate as SignInReason)
      ? (candidate as SignInReason)
      : null;
  const safeParameters = new URLSearchParams();

  if (reason) safeParameters.set("reason", reason);

  const safeQuery = safeParameters.toString();

  return {
    changed: original !== safeQuery,
    reason,
    safeSearch: safeQuery ? `?${safeQuery}` : "",
  };
}
