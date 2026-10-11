import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readStylesSync } from "../support/read-styles";

const read = (path: string): string => readFileSync(path, "utf8");

const controls = read("apps/web/src/app/appearance-controls.tsx");
const layout = read("apps/web/src/app/layout.tsx");
const settings = read("apps/web/src/app/workspace/settings/general/page.tsx");
const css = readStylesSync();

test("la preferencia de movimiento ofrece las cuatro opciones declaradas", () => {
  for (const [value, label] of [
    ["reduced", "Reducido"],
    ["fast", "Rápido"],
    ["normal", "Normal"],
    ["slow", "Lento"],
  ]) {
    assert.match(
      controls,
      new RegExp(`value: "${value}", label: "${label}"`),
    );
  }
  assert.match(controls, /<legend>Velocidad de transición<\/legend>/);
  assert.match(controls, /aria-pressed=\{motion === option\.value\}/);
});

test("la clave y el atributo se persisten e inicializan antes del primer pintado", () => {
  assert.match(controls, /const MOTION_KEY = "rq-motion"/);
  assert.match(controls, /dataset\.rqMotion = motion/);
  assert.match(controls, /localStorage\.setItem\(MOTION_KEY, value\)/);
  assert.match(layout, /data-rq-motion="normal"/);
  assert.match(layout, /localStorage\.getItem\("rq-motion"\)/);
  assert.match(layout, /\["reduced", "fast", "normal", "slow"\]/);
  assert.match(layout, /root\.dataset\.rqMotion = motion/);
});

test("la tarjeta de configuración menciona el movimiento", () => {
  assert.match(
    settings.replace(/\s+/g, " "),
    /El tema, el tamaño de texto y el movimiento se almacenan únicamente en este navegador\./,
  );
});

test("el CSS fija la duración por preferencia y respeta prefers-reduced-motion", () => {
  const target = '.rq-content[data-rq-navigation-direction]';
  const duration = (motion: string): RegExp =>
    new RegExp(
      `html\\[data-rq-motion="${motion}"\\] \\${target.replace(/\[/g, "\\[")}`.replace(
        /\\\\/g,
        "\\",
      ) + String.raw` \{\s*animation-duration: (\d+)ms;`,
    );

  assert.match(css, duration("normal"));
  assert.equal(css.match(duration("normal"))?.[1], "420");
  assert.ok(Number(css.match(duration("fast"))?.[1]) < 420);
  assert.equal(css.match(duration("slow"))?.[1], "760");
  assert.match(
    css,
    /html\[data-rq-motion="reduced"\] \.rq-content\[data-rq-navigation-direction\] \{\s*animation: none;/,
  );

  const base = css.match(
    /\.rq-content\[data-rq-navigation-direction\] \{([^}]*)\}/,
  );
  assert.ok(base);
  assert.doesNotMatch(base[1], /animation-duration/);

  const media = css.match(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.rq-content\[data-rq-navigation-direction\] \{\s*animation: none;\s*\}\s*\}\s*$/,
  );
  assert.ok(media, "la media query de movimiento reducido debe ir al final y anular la animación");
  assert.ok(
    (media.index ?? 0) > css.lastIndexOf('html[data-rq-motion="slow"]'),
  );
});
