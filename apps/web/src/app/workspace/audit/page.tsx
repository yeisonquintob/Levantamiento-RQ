import { permanentRedirect } from "next/navigation";

export default function LegacyAuditPage() {
  permanentRedirect("/workspace/settings/audit");
}
