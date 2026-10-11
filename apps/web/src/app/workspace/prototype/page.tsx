import { Suspense } from "react";

import { PrototypeWorkspace } from "./prototype-workspace";

export default function PrototypePage() {
  return (
    <Suspense fallback={null}>
      <PrototypeWorkspace />
    </Suspense>
  );
}
