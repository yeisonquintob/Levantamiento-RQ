import { ConflictException } from "@nestjs/common";

import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  getDocumentSectionDefinitions,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";

import type {
  AppliedDocumentTemplateEntity,
  DocumentSectionEntity,
} from "./document.entities";
import { isJsonObject, parseJson } from "./documents-json";

const LEGACY_DOCUMENT_SECTION_DEFINITIONS = DOCUMENT_SECTION_DEFINITIONS.filter(
  (section) => section.key !== "solutionProposal",
);

const HISTORICAL_DOCUMENT_SECTION_DEFINITIONS = [
  ...LEGACY_DOCUMENT_SECTION_DEFINITIONS.slice(0, 5),
  {
    key: "milestones",
    title: "Requerimientos por hito o funcionalidad",
  },
  {
    key: "nonFunctionalRequirements",
    title: "Requerimientos no funcionales",
  },
  ...LEGACY_DOCUMENT_SECTION_DEFINITIONS.slice(7),
] as const;
const SOLUTION_PROPOSAL_SECTION_DEFINITION = DOCUMENT_SECTION_DEFINITIONS.find(
  (section) => section.key === "solutionProposal",
);
if (!SOLUTION_PROPOSAL_SECTION_DEFINITION) {
  throw new Error(
    "La definición de la sección solutionProposal es obligatoria.",
  );
}
const HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION = [
  ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS.slice(0, 4),
  SOLUTION_PROPOSAL_SECTION_DEFINITION,
  ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS.slice(4),
] as const;

export function appliedTemplateIncludesScrum(
  template: AppliedDocumentTemplateEntity,
): boolean {
  const definition = parseJson(template.definitionJson);
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    return false;
  }
  const scrum = (definition as Readonly<Record<string, DocumentJsonValue>>)
    .scrum;
  return Boolean(
    scrum &&
    typeof scrum === "object" &&
    !Array.isArray(scrum) &&
    (scrum as Readonly<Record<string, DocumentJsonValue>>).enabled === true,
  );
}

/**
 * Devuelve la estructura de una plantilla propia (dinámica) o `null` cuando la
 * plantilla aplicada es canónica (o su definición no es interpretable), caso en
 * el que rige el layout canónico/histórico de siempre.
 */
export function customTemplateLayout(
  template: AppliedDocumentTemplateEntity | null | undefined,
): ResolvedTemplateLayout["sections"] | null {
  if (!template) return null;
  try {
    const layout = resolveTemplateLayout(
      parseJson(template.definitionJson),
      appliedTemplateIncludesScrum(template),
    );
    return layout.custom ? layout.sections : null;
  } catch (error) {
    if (error instanceof ConflictException) return null;
    throw error;
  }
}

interface ResolvedTemplateLayout {
  readonly sections: readonly {
    readonly key: string;
    readonly title: string;
  }[];
  /** `true` cuando la plantilla es propia (estructura dinámica) y no canónica. */
  readonly custom: boolean;
}

export function assertCanonicalTemplate(
  definition: DocumentJsonValue,
  includesScrum: boolean,
): readonly { readonly key: string; readonly title: string }[] {
  return resolveTemplateLayout(definition, includesScrum).sections;
}

export function resolveTemplateLayout(
  definition: DocumentJsonValue,
  includesScrum: boolean,
): ResolvedTemplateLayout {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    throw new ConflictException(
      "La plantilla aplicada no contiene una definición válida.",
    );
  }

  const record = definition as Readonly<Record<string, DocumentJsonValue>>;
  const order = record.sectionOrder;
  const sections = record.sections;
  const expected = getDocumentSectionDefinitions(includesScrum);
  const legacyBaseExpected = LEGACY_DOCUMENT_SECTION_DEFINITIONS;
  const legacyExpected = includesScrum
    ? [...legacyBaseExpected, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : legacyBaseExpected;
  const historicalExpected = includesScrum
    ? [
        ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS,
        DOCUMENT_SCRUM_SECTION_DEFINITION,
      ]
    : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS;
  const historicalWithSolutionExpected = includesScrum
    ? [
        ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION,
        DOCUMENT_SCRUM_SECTION_DEFINITION,
      ]
    : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION;

  if (!Array.isArray(order) || !Array.isArray(sections)) {
    throw new ConflictException(
      "La plantilla aplicada no contiene un orden de secciones válido.",
    );
  }

  const compatibleDefinitions = [
    expected,
    legacyExpected,
    historicalExpected,
    historicalWithSolutionExpected,
  ];
  const definitionExpected = compatibleDefinitions.find(
    (candidate) =>
      sections.length === candidate.length &&
      order.length === candidate.length &&
      candidate.every((expectedSection, index) => {
        const rawSection = sections[index];
        if (
          order[index] !== expectedSection.key ||
          !rawSection ||
          typeof rawSection !== "object" ||
          Array.isArray(rawSection)
        ) {
          return false;
        }
        const section = rawSection as Readonly<
          Record<string, DocumentJsonValue>
        >;
        /*
         * La clave y sectionOrder protegen la estructura. El título y el
         * número visual de plantillas publicadas antiguas se normalizan con
         * `expected` al crear el documento, en lugar de bloquear el proceso.
         */
        return section.key === expectedSection.key;
      }),
  );

  if (!definitionExpected) {
    if (
      sections.length < 1 ||
      sections.length > 50 ||
      order.length !== sections.length
    ) {
      throw new ConflictException(
        "Cantidad de secciones de plantilla inválida.",
      );
    }
    const scrum = record.scrum;
    if (!isJsonObject(scrum) || scrum.enabled !== includesScrum) {
      throw new ConflictException(
        "Configuración Scrum inconsistente en la plantilla.",
      );
    }
    const keys = new Set<string>();
    const customSections = sections.map((raw, index) => {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        typeof raw.key !== "string" ||
        !/^[a-z][a-zA-Z0-9]{2,63}$/.test(raw.key) ||
        keys.has(raw.key) ||
        raw.order !== index + 1 ||
        order[index] !== raw.key ||
        typeof raw.title !== "string" ||
        !raw.title.trim() ||
        typeof raw.required !== "boolean" ||
        typeof raw.guidance !== "string"
      ) {
        throw new ConflictException(
          "Estructura dinámica de plantilla inválida.",
        );
      }
      keys.add(raw.key);
      return { key: raw.key, title: raw.title.trim() };
    });
    return { sections: customSections, custom: true };
  }

  if (includesScrum) {
    const rawScrum = sections.at(-1);
    if (
      !rawScrum ||
      typeof rawScrum !== "object" ||
      Array.isArray(rawScrum) ||
      order.at(-1) !== DOCUMENT_SCRUM_SECTION_DEFINITION.key
    ) {
      throw new ConflictException(
        "La plantilla Scrum no conserva el punto 15 esperado.",
      );
    }
    const scrum = rawScrum as Readonly<Record<string, DocumentJsonValue>>;
    if (
      scrum.key !== DOCUMENT_SCRUM_SECTION_DEFINITION.key ||
      scrum.title !== DOCUMENT_SCRUM_SECTION_DEFINITION.title
    ) {
      throw new ConflictException(
        "La plantilla Scrum modifica el punto 15 canónico.",
      );
    }
  }

  return { sections: expected, custom: false };
}

export function assertSectionsLayout(
  sections: readonly DocumentSectionEntity[],
  appliedTemplate?: AppliedDocumentTemplateEntity | null,
): void {
  /*
   * Plantillas propias: el layout válido es el de la plantilla efectiva del
   * documento, no el canónico fijo. Los documentos canónicos conservan la
   * validación histórica de abajo.
   */
  const customLayout = customTemplateLayout(appliedTemplate);
  if (customLayout) {
    if (sections.length !== customLayout.length) {
      throw new ConflictException(
        `El documento debe contener ${customLayout.length} secciones según su plantilla aplicada.`,
      );
    }
    customLayout.forEach((expectedSection, index) => {
      const actual = sections[index];
      if (
        !actual ||
        actual.key !== expectedSection.key ||
        actual.orderIndex !== index + 1
      ) {
        throw new ConflictException(
          "El documento no conserva el orden de las secciones configuradas.",
        );
      }
    });
    return;
  }
  const includesScrum = sections.at(-1)?.key === "scrumPlan";
  const withoutScrum = includesScrum ? sections.slice(0, -1) : sections;
  const hasSolutionProposal = withoutScrum.some(
    (section) => section.key === "solutionProposal",
  );
  const historicalLayout = withoutScrum.some(
    (section) => section.key === "nonFunctionalRequirements",
  );
  const baseDefinitions = historicalLayout
    ? hasSolutionProposal
      ? HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION
      : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS
    : hasSolutionProposal
      ? DOCUMENT_SECTION_DEFINITIONS
      : LEGACY_DOCUMENT_SECTION_DEFINITIONS;
  const expected = includesScrum
    ? [...baseDefinitions, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : baseDefinitions;

  if (
    sections.length !== baseDefinitions.length &&
    sections.length !== baseDefinitions.length + 1
  ) {
    throw new ConflictException(
      `El documento debe contener ${baseDefinitions.length} secciones base${includesScrum ? " y Plan Scrum" : ""}.`,
    );
  }

  expected.forEach((expectedSection, index) => {
    const actual = sections[index];
    if (
      !actual ||
      actual.key !== expectedSection.key ||
      actual.orderIndex !== index + 1
    ) {
      throw new ConflictException(
        "El documento no conserva el orden de las secciones configuradas.",
      );
    }
  });
}
