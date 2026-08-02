"use client";

import { useState } from "react";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export function SignOutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function signOut(): Promise<void> {
    setSubmitting(true);

    try {
      await fetch(`${GATEWAY_URL}/api/v1/auth/sign-out`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.assign("/sign-in");
    }
  }

  return (
    <button
      className="rq-action rq-action--compact"
      data-rq-tone="danger"
      disabled={submitting}
      onClick={signOut}
      type="button"
    >
      {submitting ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
