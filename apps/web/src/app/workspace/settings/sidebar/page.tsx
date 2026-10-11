import { redirect } from "next/navigation";

// La barra lateral ahora es una pestaña de Configuración → Parámetros.
export default function SidebarSettingsPage(): never {
  redirect("/workspace/settings/parameters");
}
