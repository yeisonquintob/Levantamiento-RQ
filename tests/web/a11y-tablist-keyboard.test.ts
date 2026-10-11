import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nextTabIndex } from "../../apps/web/src/app/tablist-keyboard";

test("las flechas recorren las pestañas en círculo y saltan las deshabilitadas", () => {
  const all = [true, true, true];
  assert.equal(nextTabIndex("ArrowRight", 0, all), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, all), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, all), 2);
  assert.equal(nextTabIndex("ArrowRight", 0, [true, false, true]), 2);
  assert.equal(nextTabIndex("ArrowLeft", 2, [true, false, true]), 0);
  assert.equal(nextTabIndex("Home", 2, [false, true, true]), 1);
  assert.equal(nextTabIndex("End", 0, [true, true, false]), 1);
});

test("otras teclas, listas vacías o pestañas desconocidas no mueven nada", () => {
  assert.equal(nextTabIndex("Enter", 0, [true, true]), null);
  assert.equal(nextTabIndex("ArrowRight", 0, []), null);
  assert.equal(nextTabIndex("ArrowRight", -1, [true]), null);
  assert.equal(nextTabIndex("ArrowRight", 0, [true, false]), 0);
});

test("el teclado de pestañas está montado una vez en el shell y los correos no se autocorrigen", () => {
  assert.match(readFileSync("apps/web/src/app/app-shell.tsx", "utf8"), /<TabListKeyboard \/>/u);
  for (const file of [
    "apps/web/src/app/sign-in/sign-in-form.tsx",
    "apps/web/src/app/workspace/settings/users/users-workspace.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const emails = source.match(/type="email"/gu)?.length ?? 0;
    const spellchecks = source.match(/spellCheck=\{false\}\s+type="email"/gu)?.length ?? 0;
    assert.equal(spellchecks, emails, file);
  }
});
