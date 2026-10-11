export function authenticatedSignInDestination(
  mustChangePassword: boolean | null,
): "/change-password" | "/workspace" | null {
  if (mustChangePassword === null) return null;
  return mustChangePassword ? "/change-password" : "/workspace";
}
