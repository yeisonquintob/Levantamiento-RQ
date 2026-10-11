import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PrototypePromptExport } from "@levantamiento-rq/shared-contracts";

import {
  buildPromptExportTxt,
  promptExportFileName,
} from "../../apps/web/src/app/workspace/prototype/prototype-prompt-export";
import { CORPORATE_DEFAULT_V1 } from "../../apps/prototypes-service/src/visual/prototype-design-system";
import { resolveWorkspaceBackTarget } from "../../apps/web/src/app/workspace-navigation-transition";
import { readStylesSync } from "../support/read-styles";

const read = (path: string) => readFileSync(path, "utf8");
const exported: PrototypePromptExport = {
  generationId: "g",
  applicationName: "Portal de Cartera",
  applicationSummary: "Gestiona la cartera de clientes.",
  targetDevice: "RESPONSIVE",
  designSystem: CORPORATE_DEFAULT_V1,
  screens: [
    { screenCode: "login", name: "Inicio de sesión", route: "/login", order: 1, objective: "Autenticar al usuario", components: ["Formulario: usuario y clave"] },
    { screenCode: "home", name: "Panel", route: null, order: 2, objective: "Resumen", components: [] },
  ],
  items: [
    { screenCode: "login", screenName: "Inicio de sesión", screenOrder: 1, device: "WEB", fileName: "01-login-web.png", width: 1536, height: 1024, prompt: "Prompt uno" },
    { screenCode: "login", screenName: "Inicio de sesión", screenOrder: 1, device: "MOBILE", fileName: "01-login-mobile.png", width: 1024, height: 1536, prompt: "Prompt dos" },
  ],
};

test("el TXT es autosuficiente: aplicación, menú, guía de apariencia y un bloque por imagen", () => {
  const txt = buildPromptExportTxt(exported, new Date("2026-10-10T12:00:00Z"));
  assert.match(txt, /PROMPTS PARA GENERAR LAS IMÁGENES DEL PROTOTIPO · Portal de Cartera/u);
  assert.match(txt, /2 imágenes · Formato: Web \+ móvil/u);
  assert.match(txt, /Importar imágenes/u);
  // Aplicación y menú común.
  assert.match(txt, /Propósito: Gestiona la cartera de clientes\./u);
  assert.match(txt, /01\. Inicio de sesión {2}\(\/login\)\r\n {2}02\. Panel\r\n/u);
  // Guía de apariencia con los valores reales del sistema de diseño.
  assert.match(txt, /GUÍA DE APARIENCIA \(igual para TODAS las imágenes\)/u);
  assert.ok(txt.includes(CORPORATE_DEFAULT_V1.colors["primary"] as string));
  assert.ok(txt.includes(CORPORATE_DEFAULT_V1.typography["family"] as string));
  assert.match(txt, /barra lateral fija de 240px/u);
  // Un bloque por imagen con detalle de la pantalla y prompt.
  assert.match(txt, /\[01\/02\] Inicio de sesión · Web\r\nArchivo: 01-login-web\.png\r\nTamaño: 1536x1024\r\nObjetivo: Autenticar al usuario\r\nComponentes:\r\n {2}- Formulario: usuario y clave\r\nPROMPT:\r\nPrompt uno\r\nFIN DEL PROMPT/u);
  assert.match(txt, /\[02\/02\] Inicio de sesión · Móvil\r\nArchivo: 01-login-mobile\.png/u);
  assert.match(txt, /\[ \] 01-login-mobile\.png/u);
  assert.equal(promptExportFileName("Portal de Cartera"), "prompts-portal-de-cartera.txt");
});

test("la pantalla de resultado separa «Generar» de «Exportar» y la galería permite importar", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  assert.match(source, /Exportar prompts \(TXT\)/u);
  assert.match(source, /Importar imágenes/u);
  assert.match(source, /images\/import/u);
  assert.match(source, /prompt-export/u);
});

test("«Volver al listado» y «← Proyectos» ya no existen: la flecha lateral hace ese retorno", () => {
  assert.doesNotMatch(read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx"), /Volver al listado/u);
  assert.doesNotMatch(read("apps/web/src/app/workspace/execution/execution-workspace.tsx"), /← Proyectos/u);
  assert.equal(resolveWorkspaceBackTarget({ pathname: "/workspace/prototype", search: "?view=source" }), "/workspace/prototype");
  assert.equal(resolveWorkspaceBackTarget({ pathname: "/workspace/prototype", search: "" }), "/workspace");
  assert.equal(
    resolveWorkspaceBackTarget({ pathname: "/workspace/execution", search: "?projectId=abc" }),
    "/workspace/execution",
  );
});

test("tras interpretar el Markdown la IA detalla cada pantalla, una a una, con avance visible", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  assert.match(source, /\/screens\/\$\{encodeURIComponent\(screen\.id\)\}\/detail/u);
  assert.match(source, /await detailScreens\(current\)/u);
  assert.match(source, /await detailScreens\(planned\.generation\)/u);
  assert.match(source, /Detallando pantallas \$\{detailProgress\.done\}\/\$\{detailProgress\.total\}/u);
  assert.match(source, /Detallar de nuevo con la IA/u);
});

test("el texto se puede procesar de nuevo mientras no haya imágenes", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  assert.match(source, /"Procesar texto de nuevo"/u);
  assert.match(source, /\["PLANNED", "VISUAL_SPEC_READY"\]\.includes\(generation\.status\)[\s\S]{0,40}generation\.totalImages === 0/u);
  assert.match(source, /void processMarkdown\(canReprocess\)/u);
  assert.match(source, /async function processMarkdown\(force = false\)/u);
  assert.match(source, /\(Boolean\(plan\) && !canReprocess\)/u);
});

test("el detalle por pantalla se puede detener sin cancelar la generación", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  assert.match(source, /const detailAbortRef = useRef<AbortController \| null>\(null\)/u);
  assert.match(source, /Detener detalle/u);
  assert.match(source, /Detalle detenido: \$\{doneCount\} de \$\{totalCount\} pantallas detalladas/u);
  // El «Detener» general interrumpe primero el detalle y no marca la generación como fallida.
  assert.match(source, /if \(detailAbortRef\.current\) \{\s+detailAbortRef\.current\.abort\(\);\s+return;/u);
  assert.match(source, /Boolean\(detailProgress\) \|\|\s+\(Boolean\(plan\) && !canReprocess\)/u);
});

test("Procesar Markdown explica el bloqueo por proveedor sin ofrecer probar la conexión en la página", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  // Una IA que requiere prueba ya no deja el botón inerte sin explicación...
  assert.match(source, /Prueba la IA de imágenes en Configuración/u);
  assert.match(source, /Prueba la IA del Markdown en Configuración/u);
  // ...pero la prueba de conexión se hace solo en Configuración, no aquí.
  assert.doesNotMatch(source, /Probar conexión/u);
  assert.doesNotMatch(source, /ai-providers\/\$\{encodeURIComponent\(providerId\)\}\/test/u);

  // El botón principal es de una sola línea: título sin saltos y texto secundario recortado.
  const css = readStylesSync();
  assert.match(css, /\.rq-prototype-generate span \{[^}]*white-space: nowrap;/u);
  assert.match(css, /\.rq-prototype-generate small \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/u);
});

test("interpretar el Markdown exige elegir la IA de imágenes, no que esté probada; generar imágenes sí la exige", () => {
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  assert.match(source, /imageProviderSelected/u);
  assert.doesNotMatch(source, /imageProviderAvailable/u);
  // El botón «Generar N pantallas» queda deshabilitado con el motivo y ofrece exportar los prompts.
  assert.match(source, /Boolean\(imageProviderBlockReason\)/u);
  assert.match(source, /Mientras tanto puedes/u);
});

test("la columna izquierda de Generar prototipo se compacta para caber en una pantalla de poca altura", () => {
  const css = readStylesSync();
  assert.match(css, /PROTOTYPE_LEFT_ONE_SCREEN_V1/u);
  assert.match(css, /@media \(min-width: 1121px\) and \(max-height: 820px\)/u);
  assert.match(css, /\.rq-device-selection button > small \{\s*display: none;/u);
  assert.match(css, /@media \(min-width: 1121px\) and \(max-height: 700px\)/u);
});

test("un texto largo del botón principal no ensancha la columna izquierda y la lista de componentes no repite claves", () => {
  const css = readStylesSync();
  assert.match(css, /\.rq-prototype-generate \{[^}]*min-width: 0;[^}]*overflow: hidden;/u);
  assert.match(css, /\.rq-prototype-workspace \.rq-prototype-config > \* \{\s*min-width: 0;/u);
  const source = read("apps/web/src/app/workspace/prototype/prototype-workspace.tsx");
  // La IA puede devolver dos componentes con el mismo texto: la clave incluye la posición.
  assert.doesNotMatch(source, /key=\{component\}/u);
  assert.match(source, /key=\{`\$\{index\}-\$\{component\}`\}/u);
});
