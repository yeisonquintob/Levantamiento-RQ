import { rmSync } from "node:fs";

import { AUTH_FILE } from "./support";

/** La sesión guardada es una credencial: no se deja en disco al terminar. */
export default function globalTeardown(): void {
  rmSync(AUTH_FILE, { force: true });
}
