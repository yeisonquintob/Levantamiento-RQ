import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defaultSidebarConfiguration,
  SIDEBAR_MENU_DEFINITIONS,
} from "../../apps/web/src/app/sidebar-navigation.js";
import {
  canManageSystem,
  canManageTemplates,
} from "../../apps/web/src/app/workspace/settings/settings-access.js";

test("el sidebar deja Configuración como único acceso administrativo", async () => {
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");
  const sidebar = shell.slice(
    shell.indexOf("<aside"),
    shell.indexOf("</aside>"),
  );

  // El menú se define y se coloca en sidebar-navigation.ts (configurable desde
  // Configuración > Barra lateral); el shell solo lo consume.
  assert.match(shell, /SIDEBAR_MENU_DEFINITIONS/);
  const definitions = new Map(
    SIDEBAR_MENU_DEFINITIONS.map((menu) => [menu.id, menu]),
  );
  assert.equal(definitions.get("settings")?.href, "/workspace/settings");
  assert.equal(definitions.get("settings")?.label, "Configuración");

  const configuration = defaultSidebarConfiguration();
  const administration = configuration.sections.find(
    (section) => section.id === "administration",
  );
  assert.equal(administration?.name, "Administración");
  assert.deepEqual(
    configuration.menus
      .filter((menu) => menu.sectionId === "administration")
      .map((menu) => menu.id),
    ["settings"],
  );

  // Ningún submódulo administrativo es un menú propio del sidebar.
  const hrefs = SIDEBAR_MENU_DEFINITIONS.map((menu) => menu.href);
  const labels = SIDEBAR_MENU_DEFINITIONS.map((menu) => menu.label);
  for (const forbidden of [
    "/workspace/templates",
    "/workspace/audit",
    "/workspace/settings/templates",
    "/workspace/settings/users",
    "/workspace/settings/ai-providers",
  ]) {
    assert.ok(!hrefs.includes(forbidden), `menú no permitido: ${forbidden}`);
  }
  for (const forbidden of [
    "Plantillas",
    "Usuarios",
    "Proveedores IA",
    "Auditoría",
  ]) {
    assert.ok(
      !labels.includes(forbidden),
      `etiqueta no permitida: ${forbidden}`,
    );
  }
  assert.doesNotMatch(
    sidebar,
    /href="\/workspace\/settings\/(?:templates|users|ai-providers)"/,
  );
});

test("Configuración reúne sus submódulos en un centro con acceso según el perfil", async () => {
  const page = await readFile(
    "apps/web/src/app/workspace/settings/page.tsx",
    "utf8",
  );
  const navigation = await readFile(
    "apps/web/src/app/workspace/settings/settings-navigation.tsx",
    "utf8",
  );

  assert.match(page, /Centro de administración/);
  assert.match(page, /Opciones de configuración/);
  assert.match(
    page,
    /Se muestran únicamente las opciones disponibles para tu perfil/,
  );
  const cards: Array<[string, string]> = [
    ["General", "/workspace/settings/general"],
    ["Parámetros", "/workspace/settings/parameters"],
    ["Plantillas", "/workspace/settings/templates"],
    ["Usuarios y roles", "/workspace/settings/users"],
    ["Proveedores de IA", "/workspace/settings/ai-providers"],
    ["Criterios de viabilidad", "/workspace/settings/viability"],
    ["Auditoría", "/workspace/settings/audit"],
  ];
  for (const [title, href] of cards) {
    assert.match(page, new RegExp(`href="${href}"`), `falta ${href}`);
    assert.match(page, new RegExp(`title="${title}"`), `falta ${title}`);
  }
  // El acceso depende del perfil: plantillas y administración del sistema solo
  // se muestran con los permisos correspondientes.
  assert.match(page, /showTemplates \? \(/);
  assert.match(page, /showSystemAdministration \? \(/);
  assert.match(navigation, /aria-current=\{isCurrent \? "page" : undefined\}/);
  assert.match(navigation, /aria-label="Secciones de Configuración"/);
});

test("las rutas administrativas reutilizan las superficies funcionales", async () => {
  const templates = await readFile(
    "apps/web/src/app/workspace/settings/templates/page.tsx",
    "utf8",
  );
  const users = await readFile(
    "apps/web/src/app/workspace/settings/users/page.tsx",
    "utf8",
  );
  const providers = await readFile(
    "apps/web/src/app/workspace/settings/ai-providers/page.tsx",
    "utf8",
  );
  const audit = await readFile(
    "apps/web/src/app/workspace/settings/audit/page.tsx",
    "utf8",
  );

  assert.match(templates, /TemplatesWorkspace/);
  assert.match(templates, /\/api\/v1\/templates/);
  assert.match(users, /UsersWorkspace/);
  assert.match(users, /\/api\/v1\/users/);
  assert.match(providers, /AiProvidersWorkspace/);
  assert.match(providers, /\/api\/v1\/admin\/ai-providers/);
  assert.match(audit, /AuditWorkspace/);
  assert.match(audit, /\/api\/v1\/projects/);
});

test("las URLs administrativas anteriores redirigen permanentemente", async () => {
  const templatesRedirect = await readFile(
    "apps/web/src/app/workspace/templates/page.tsx",
    "utf8",
  );
  const auditRedirect = await readFile(
    "apps/web/src/app/workspace/audit/page.tsx",
    "utf8",
  );

  assert.match(
    templatesRedirect,
    /permanentRedirect\("\/workspace\/settings\/templates"\)/,
  );
  assert.match(
    auditRedirect,
    /permanentRedirect\("\/workspace\/settings\/audit"\)/,
  );
});

test("los permisos existentes filtran accesos sin conceder capacidades", () => {
  const regularUser = { roles: ["REQUESTER"], permissions: [] };
  const templateManager = {
    roles: ["REQUESTER"],
    permissions: ["documents.templates.manage"],
  };
  const administrator = {
    roles: ["ADMIN"],
    permissions: ["system.admin"],
  };

  assert.equal(canManageTemplates(regularUser), false);
  assert.equal(canManageSystem(regularUser), false);
  assert.equal(canManageTemplates(templateManager), true);
  assert.equal(canManageSystem(templateManager), false);
  assert.equal(canManageTemplates(administrator), true);
  assert.equal(canManageSystem(administrator), true);
});

test("el hub usa una grilla responsive de tres, dos y una columna", async () => {
  const css = await readFile("apps/web/src/app/auth.css", "utf8");

  assert.match(
    css,
    /\.rq-settings-hub-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 1100px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*?\.rq-settings-hub-grid,[\s\S]*?grid-template-columns: 1fr/,
  );
});
