import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

  assert.match(
    sidebar,
    /<span className="rq-nav__label">Administración<\/span>/,
  );
  assert.match(sidebar, /href="\/workspace\/settings"/);
  assert.match(sidebar, />Configuración<\/span>/);
  assert.doesNotMatch(sidebar, /href="\/workspace\/templates"/);
  assert.doesNotMatch(sidebar, /href="\/workspace\/audit"/);
  assert.doesNotMatch(sidebar, /href="\/workspace\/settings\/templates"/);
  assert.doesNotMatch(sidebar, /href="\/workspace\/settings\/users"/);
  assert.doesNotMatch(sidebar, /href="\/workspace\/settings\/ai-providers"/);
  assert.doesNotMatch(sidebar, />Plantillas<\/span>/);
  assert.doesNotMatch(sidebar, />Usuarios<\/span>/);
  assert.doesNotMatch(sidebar, />Proveedores IA<\/span>/);
  assert.doesNotMatch(sidebar, />Auditoría<\/span>/);
});

test("Configuración reúne los cinco submódulos y preferencias personales", async () => {
  const page = await readFile(
    "apps/web/src/app/workspace/settings/page.tsx",
    "utf8",
  );
  const navigation = await readFile(
    "apps/web/src/app/workspace/settings/settings-navigation.tsx",
    "utf8",
  );

  assert.match(page, /Preferencias personales/);
  assert.match(page, /Administración del sistema/);
  assert.match(page, /title="General"/);
  assert.match(page, /title="Plantillas"/);
  assert.match(page, /title="Usuarios y roles"/);
  assert.match(page, /title="Proveedores de IA"/);
  assert.match(page, /title="Auditoría"/);
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
