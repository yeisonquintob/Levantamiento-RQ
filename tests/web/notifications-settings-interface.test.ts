import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("abrir una notificación la marca como leída y actualiza el indicador", async () => {
  const [workspace, indicator] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/notifications/notifications-workspace.tsx",
      "utf8",
    ),
    readFile("apps/web/src/app/notifications-indicator.tsx", "utf8"),
  ]);

  const viewPromptStart = workspace.indexOf("async function viewPrompt");
  const persistReadInsideView = workspace.indexOf(
    "await persistRead(notification)",
    viewPromptStart,
  );
  const promptRequest = workspace.indexOf(
    "/analysis-requests/",
    viewPromptStart,
  );

  assert.ok(viewPromptStart >= 0);
  assert.ok(persistReadInsideView > viewPromptStart);
  assert.ok(promptRequest > persistReadInsideView);
  assert.match(workspace, /rq-notification-event-button/u);
  assert.match(workspace, /announceNotificationsChanged\(\)/u);
  assert.match(indicator, /addEventListener\(NOTIFICATIONS_CHANGED_EVENT/u);
});

test("el resumen de configuración evita bloques duplicados", async () => {
  const page = await readFile(
    "apps/web/src/app/workspace/settings/page.tsx",
    "utf8",
  );

  assert.doesNotMatch(page, /RqPageHero/u);
  assert.doesNotMatch(page, /rq-settings-personal/u);
  assert.match(page, /Opciones de configuración/u);
});
