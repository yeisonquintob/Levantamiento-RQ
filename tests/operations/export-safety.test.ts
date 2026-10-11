import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import type { DocumentJsonValue } from "../../libs/shared/contracts/src/index.js";
import {
  buildExportDocumentSections,
  compactLines,
  pdfSafe,
  renderMarkdown,
  renderPdf,
  type ExportContentLine,
  type RenderApprovedDocumentInput,
} from "../../apps/operations-service/src/operations/export-document.renderer.js";
import {
  buildExportFixture,
  buildVentasPerdidasExportFixture,
} from "./export-document.fixture.js";

const line = (
  text: string,
  level = 0,
  bullet = false,
): ExportContentLine => ({ text, level, bullet });

function withSectionContent(
  input: RenderApprovedDocumentInput,
  key: string,
  content: DocumentJsonValue,
): RenderApprovedDocumentInput {
  return {
    ...input,
    version: {
      ...input.version,
      sections: input.version.sections.map((section) =>
        section.key === key ? { ...section, content } : section,
      ),
    },
  };
}

// Texto dibujado en el PDF: se leen los operadores Tj hexadecimales de los
// content streams y se decodifican como WinAnsi (0x80 = €).
async function pdfDrawnText(buffer: Buffer): Promise<string> {
  const pdf = await PDFDocument.load(buffer);
  const chunks: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const refs =
      contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const filter = stream.dict.get(PDFName.of("Filter"));
      const raw = Buffer.from(stream.getContents());
      const data = filter ? inflateSync(raw) : raw;
      const source = data.toString("latin1");
      for (const match of source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/gu)) {
        const bytes = Buffer.from(match[1] as string, "hex");
        chunks.push(
          [...bytes]
            .map((byte) => (byte === 0x80 ? "€" : String.fromCharCode(byte)))
            .join(""),
        );
      }
    }
  }
  return chunks.join("\n");
}

test("compactLines conserva líneas con «pendiente» y repetidas legítimas entre Sprints y tareas", () => {
  const input = [
    line("Sprint 1", 0),
    line("Tarea: Validar contratos", 1, true),
    line("Definiciones pendientes de D365", 1, true),
    line("Criterio de cierre revisado", 1, true),
    line("Sprint 2", 0),
    line("Tarea: Validar contratos", 1, true),
    line("Definiciones pendientes de D365", 1, true),
    line("Criterio de cierre revisado", 1, true),
    line("Pendiente", 1, false),
    line("Sprint 3:", 0),
    line("Tarea: Validar contratos", 1, true),
  ];
  const output = compactLines(input);
  assert.deepEqual(
    output.map((item) => item.text),
    input.map((item) => item.text),
  );
  // Solo el duplicado consecutivo idéntico del mismo nivel se colapsa.
  assert.equal(
    compactLines([line("A", 1, true), line("A", 1, true), line("A", 2, true)])
      .length,
    2,
  );
  // El ruido de plantilla sigue descartándose.
  assert.equal(compactLines([line("Fuente vinculada"), line("Hola")]).length, 1);
});

test("pdfSafe conserva ½ µ € × ± ° y cardinalidades, y sustituye lo exótico sin eliminar", () => {
  assert.equal(
    pdfSafe("½ 5 µs 10 € 2×3 ±1 20° 1..N 0..1 ñ á"),
    "½ 5 µs 10 € 2×3 ±1 20° 1..N 0..1 ñ á",
  );
  assert.equal(pdfSafe("0..∞"), "0..inf.");
  assert.equal(pdfSafe("a ≤ b → c ≠ d"), "a <= b -> c != d");
  // Emoji y CJK: marcador visible "?"; ancho cero se omite; tab pasa a espacio.
  assert.equal(pdfSafe("Hola 😀 世界 \u200B\t✓"), "Hola ? ??  OK");
});

test("el PDF se genera con símbolos exóticos y conserva ½ µ € y la cardinalidad del ER", async () => {
  const base = buildExportFixture("MEDIUM_REQUIREMENT");
  const attribute = (name: string) => ({
    name,
    dataType: "Texto",
    primaryKey: false,
    foreignKey: false,
    required: true,
  });
  const input = withSectionContent(base, "processFlow", {
    processFlows: {
      asIs: { title: "Actual", nodes: [], edges: [], sourceIds: [] },
      toBe: { title: "Futuro", nodes: [], edges: [], sourceIds: [] },
    },
    entityRelationship: {
      title: "Modelo ½ µs €",
      entities: [
        {
          id: "a",
          name: "Pedido €",
          description: "Costo ½ 😀",
          attributes: [attribute("latencia µs"), attribute("total € ∞")],
        },
        {
          id: "b",
          name: "Línea 世界",
          description: "Detalle",
          attributes: [attribute("cantidad ×")],
        },
      ],
      relationships: [
        { from: "a", to: "b", cardinality: "1..∞", label: "contiene ½ µs €" },
        { from: "b", to: "a", cardinality: "0..1", label: "pertenece 😀" },
      ],
      sourceIds: [],
    },
  });
  const rendered = await renderPdf(input);
  assert.equal(rendered.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  const text = await pdfDrawnText(rendered.buffer);
  assert.match(text, /1\.\.inf\./u);
  assert.match(text, /0\.\.1/u);
  assert.match(text, /contiene ½ µs €/u);
  assert.match(text, /latencia µs/u);
  assert.match(text, /Pedido €/u);
});

test("Markdown neutraliza HTML y esquemas peligrosos y conserva Markdown legítimo", async () => {
  const base = buildExportFixture("MEDIUM_REQUIREMENT");
  const hostile = [
    "# Especificaciones del prototipo",
    "",
    "## Seguridad",
    "",
    "<script>alert(1)</script>",
    '<iframe src="https://evil.test"></iframe>',
    '<img src=x onerror="alert(1)">',
    "[clic](javascript:alert(1))",
    "[datos](data:text/html;base64,AAAA)",
    "[vb](vbscript:msgbox(1))",
    "[ofuscado](java&#9;script:alert(1))",
    "![pixel](http://tracker.test/p.png)",
    "![seguro](https://tracker.test/p.png)",
    "![x](data:image/svg+xml;base64,AAAA)",
    "",
    "**negrita** y [sitio](https://example.com/a_(b)) y [correo](mailto:a@b.co)",
    "",
    "- elemento",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```html",
    "<b>código</b>",
    "```",
  ].join("\n");
  const prototype = withSectionContent(base, "solutionProposal", {
    description: "Prototipo.",
    prototypeMarkdown: hostile,
  });
  const markdown = (await renderMarkdown(prototype)).buffer.toString("utf8");
  assert.doesNotMatch(markdown, /<script/iu);
  assert.doesNotMatch(markdown, /<iframe/iu);
  assert.doesNotMatch(markdown, /<img/iu);
  assert.doesNotMatch(markdown, /\]\(\s*(?:javascript|data|vbscript):/iu);
  assert.doesNotMatch(markdown, /java&#9;script:/iu);
  assert.doesNotMatch(markdown, /!\[[^\]]*\]\(\s*https?:/iu);
  assert.match(markdown, /&lt;script/u);
  assert.match(markdown, /^clic$/mu);
  assert.match(markdown, /\*\*negrita\*\*/u);
  assert.match(markdown, /\[sitio\]\(https:\/\/example\.com\/a_\(b\)\)/u);
  assert.match(markdown, /\[correo\]\(mailto:a@b\.co\)/u);
  assert.match(markdown, /\| 1 \| 2 \|/u);
  assert.match(markdown, /<b>código<\/b>/u);
  assert.match(markdown, /Imagen omitida: pixel/u);
});

test("la numeración de PLAN SCRUM usa el número real con plantilla estándar y alterada", async () => {
  const base = buildVentasPerdidasExportFixture();
  const scrum = base.version.sections.find((item) => item.key === "scrumPlan")!;
  const template = (scrum.content as { sprints: DocumentJsonValue[] })
    .sprints[0] as Record<string, DocumentJsonValue>;
  const sprints = Array.from({ length: 36 }, (_, index) => ({
    ...template,
    code: `SP-${String(index + 1).padStart(3, "0")}`,
    number: index + 1,
    startDay: index * 15 + 1,
    endDay: index * 15 + 15,
    period: `Día ${index * 15 + 1} al Día ${index * 15 + 15}`,
  }));
  const content = {
    ...(scrum.content as Record<string, DocumentJsonValue>),
    sprints,
  };
  const check = async (input: RenderApprovedDocumentInput) => {
    const scrumSection = buildExportDocumentSections(input).find(
      (section) => section.number === 14,
    );
    assert.ok(scrumSection);
    const expected = scrumSection.displayNumber ?? scrumSection.number;
    const text = await pdfDrawnText((await renderPdf(input)).buffer);
    assert.match(text, new RegExp(`${expected} PLAN SCRUM · Detalle de Sprints`, "u"));
    assert.match(text, new RegExp(`${expected} PLAN SCRUM · Continuación`, "u"));
    if (expected !== 14) assert.doesNotMatch(text, /\b14 PLAN SCRUM/u);
    return expected;
  };
  const epics = Array.from({ length: 14 }, (_, index) => ({
    code: `EP-${String(index + 1).padStart(3, "0")}`,
    title: `Épica ${index + 1}`,
    features: [],
  }));
  const standard = withSectionContent(
    withSectionContent(base, "scrumPlan", content),
    "backlogStructure",
    { epics },
  );
  const standardNumber = await check(standard);

  // Plantilla alterada: sin secciones opcionales intermedias el número visible baja.
  const emptied = standard.version.sections.reduce(
    (input, section) =>
      ["milestones", "dataFieldsIntegrations", "tests"].includes(section.key)
        ? withSectionContent(input, section.key, "Sin información")
        : input,
    standard,
  );
  const altered = await check(emptied);
  assert.ok(altered < standardNumber, `${altered} no es menor que ${standardNumber}`);
});
