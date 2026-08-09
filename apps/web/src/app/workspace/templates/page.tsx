import { permanentRedirect } from "next/navigation";

export default function LegacyTemplatesPage() {
  permanentRedirect("/workspace/settings/templates");
}
