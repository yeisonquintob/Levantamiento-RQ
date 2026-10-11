// Formulario «Nuevo proveedor» de IA: orden, modelo instalado, unidades claras
// y estado de conexión visible.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FILE =
  "apps/web/src/app/workspace/settings/ai-providers/ai-providers-workspace.tsx";

test("el Endpoint va antes que el Modelo porque la lista de modelos depende de él", async () => {
  const source = await readFile(FILE, "utf8");
  const endpoint = source.indexOf("<span>Endpoint</span>");
  const model = source.indexOf('? "Workflow / modelo"');
  assert.ok(endpoint > 0 && model > 0);
  assert.ok(endpoint < model, "el Endpoint debe preceder al Modelo");
});

test("el modelo de Ollama se elige de una lista desplegable con los instalados en el servidor", async () => {
  const source = await readFile(FILE, "utf8");
  assert.doesNotMatch(source, /datalist/u);
  assert.match(source, /ollamaModels\.length > 0/u);
  assert.match(source, /<select[\s\S]*?ollamaModels\.map/u);
  assert.match(source, /\(no instalado en este servidor\)/u);
  assert.match(source, /modelo\(s\) instalado\(s\) en el servidor/u);
  // Sin lista (sin conexión) se puede escribir a mano.
  assert.match(source, /No se pudo listar: escribe el modelo/u);
});

test("el tiempo se muestra en minutos y se guarda en milisegundos", async () => {
  const source = await readFile(FILE, "utf8");
  assert.match(source, /Tiempo máximo por respuesta \(minutos\)/u);
  assert.match(
    source,
    /Math\.round\(Number\(form\.timeoutMinutes\) \* 60_000\)/u,
  );
  assert.match(source, /minutesFromMs\(provider\.timeoutMs\)/u);
  assert.doesNotMatch(source, /Timeout \(ms\)/u);
  assert.match(source, /Contexto máximo \(tokens de entrada\)/u);
  assert.match(source, /Respuesta máxima \(tokens de salida\)/u);
  // Proveedores con clave de nube (OpenAI, Anthropic, Gemini, Groq, Cerebras): 10 min; local: 15.
  assert.match(source, /isKeyProviderKind\(form\.providerType\) \? 10 : 15/u);
});

test("el resultado de «Probar conexión» se ve dentro del formulario y se explica el predeterminado", async () => {
  const [source, css] = await Promise.all([
    readFile(FILE, "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);
  assert.match(
    source,
    /className="rq-ai-connection rq-ai-provider-form__wide"/u,
  );
  assert.match(source, /role="status"/u);
  assert.match(source, /setConnection\(\{\s*tone: "success"/u);
  assert.match(source, /Habilita el proveedor para poder marcarlo como/u);
  assert.match(source, /debe superar «Probar\s+conexión» antes/u);
  assert.match(
    css,
    /\.rq-ai-connection\[data-tone="danger"\][\s\S]*?--rq-color-danger-text/u,
  );
  assert.match(
    css,
    /\.rq-ai-provider-form \.rq-field input,[\s\S]*?height: var\(--rq-control-height\)/u,
  );
});

// Lista de proveedores: vista limpia.
test("la lista deja a la vista Editar y Probar; el resto va en «Más acciones»", async () => {
  const source = await readFile(FILE, "utf8");
  assert.match(source, /function ProviderMoreMenu/u);
  assert.match(source, /aria-haspopup="menu"/u);
  assert.match(source, /role="menu"/u);
  assert.equal((source.match(/role="menuitem"/gu) ?? []).length, 4);
  // Escape cierra el menú y devuelve el foco; también se cierra al hacer clic fuera.
  assert.match(
    source,
    /event\.key === "Escape"[\s\S]*?triggerRef\.current\?\.focus\(\)/u,
  );
  assert.match(source, /pointerdown/u);
  // Posición fija: no queda recortado por el desplazamiento de la tabla.
  assert.match(
    source,
    /style=\{\{ top: position\.top, right: position\.right \}\}/u,
  );
  // «Rotar clave» solo existe cuando el proveedor usa credencial.
  assert.match(
    source,
    /provider\.requiresCredential \? \(\s*<button[\s\S]*?Rotar clave/u,
  );
  // Las acciones bloqueadas explican el motivo.
  assert.match(
    source,
    /Es el proveedor predeterminado: elige otro antes de deshabilitarlo\./u,
  );
  assert.match(
    source,
    /Para eliminarlo, deshabilítalo y quítale la condición de predeterminado\./u,
  );
});

test("la nota de administración segura ocupa una línea y se despliega bajo demanda", async () => {
  const [source, css] = await Promise.all([
    readFile(FILE, "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);
  assert.match(source, /<details className="rq-ai-security-note">/u);
  assert.match(source, /Las claves nunca se muestran/u);
  assert.match(css, /details\.rq-ai-security-note > summary/u);
  assert.match(
    css,
    /\.rq-ai-row-menu__item--danger:not\(:disabled\)[\s\S]*?--rq-color-danger-text/u,
  );
});
