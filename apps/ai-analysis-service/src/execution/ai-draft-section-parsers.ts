import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisDraftSection,
  type DocumentSectionKey,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";
import { requireDefined } from "../common/require-defined";
import {
  object,
  string,
  pushReconciliationWarning,
  nullableString,
  strings,
  pendingSummaryStrings,
  array,
} from "./ai-draft-parse-primitives";
import {
  parseFunctionalUserStoriesV41,
  parsePlanningBacklogStructureV41,
} from "./ai-draft-v41-backlog-parsers";
import { parseRequirements, parseTests } from "./ai-draft-artifact-parsers";
import { parseBacklogStructure } from "./ai-draft-backlog-parsers";
import { PENDING_DEFINITION } from "./ai-draft-constants";
import {
  normalizedObjectiveReference,
  classifyFuzzyObjectiveReference,
  type KpiObjectiveFailure,
  KpiObjectiveReferenceError,
} from "./ai-draft-objective-reference";

function parseSectionContent(
  value: unknown,
  key: DocumentSectionKey,
  name: string,
  requireStructuredKpis = false,
): DocumentJsonValue {
  /*
   * Compatibilidad de lectura para resultados V1/V2 y trazas V3 anteriores
   * a la estructura de objetivos/KPIs. El esquema de salida actual obliga
   * objetos para nuevas generaciones.
   */
  if (typeof value === "string") {
    if (key === "scope" && requireStructuredKpis) {
      throw new Error(
        `${name} debe usar el objeto canónico de Alcance con exactamente 3 KPI estructurados.`,
      );
    }
    return string(value, name, 30_000);
  }

  /*
   * V4_PERSISTED_SECTION_COMPATIBILITY
   *
   * El proveedor devuelve estas secciones como texto porque ese es el
   * contrato externo de Structured Outputs. Después de validar V4,
   * parseV4 deriva representaciones estructuradas para Requerimientos,
   * Esquema y Pruebas.
   *
   * Ese draft normalizado se persiste en AnalysisResult.ContentJson.
   * Cuando se reintenta aplicar el resultado, vuelve a pasar por
   * parseAiAnalysisDraft().
   *
   * Por eso esta segunda lectura debe aceptar EXCLUSIVAMENTE las
   * representaciones internas canónicas que el propio parser produjo.
   *
   * No se relaja el contrato que OpenAI debe cumplir.
   */

  if (
    key === "milestones" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const persisted = object(value, name);

    const rawFunctionalRequirements = array(
      persisted.functionalRequirements,
      `${name}.functionalRequirements`,
      300,
    );
    const usesV41FunctionalStories = rawFunctionalRequirements.some((item) => {
      const candidate = object(item, `${name}.functionalRequirements[]`);
      return (
        Object.hasOwn(candidate, "role") ||
        (typeof candidate.code === "string" &&
          candidate.code.trim().toUpperCase().startsWith("HU-F-"))
      );
    });
    const functionalRequirements = usesV41FunctionalStories
      ? parseFunctionalUserStoriesV41(rawFunctionalRequirements)
      : parseRequirements(rawFunctionalRequirements);
    const nonFunctionalRequirements = parseRequirements(
      persisted.nonFunctionalRequirements,
    );

    if (
      !usesV41FunctionalStories &&
      functionalRequirements.some(
        (requirement) =>
          "sectionKey" in requirement &&
          requirement.sectionKey !== "milestones",
      )
    ) {
      throw new Error(
        `${name}.functionalRequirements contiene un requerimiento de tipo incorrecto.`,
      );
    }

    if (
      nonFunctionalRequirements.some(
        (requirement) => requirement.sectionKey !== "nonFunctionalRequirements",
      )
    ) {
      throw new Error(
        `${name}.nonFunctionalRequirements contiene un requerimiento de tipo incorrecto.`,
      );
    }

    return {
      functionalRequirements,
      nonFunctionalRequirements,
    } as unknown as DocumentJsonValue;
  }

  if (
    key === "backlogStructure" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const backlog = object(value, name);
    const firstEpic =
      Array.isArray(backlog.epics) && backlog.epics.length > 0
        ? object(backlog.epics[0], `${name}.epics[0]`)
        : null;
    const firstFeature =
      firstEpic &&
      Array.isArray(firstEpic.features) &&
      firstEpic.features.length > 0
        ? object(firstEpic.features[0], `${name}.epics[0].features[0]`)
        : null;
    const firstStory =
      firstFeature &&
      Array.isArray(firstFeature.userStories) &&
      firstFeature.userStories.length > 0
        ? object(
            firstFeature.userStories[0],
            `${name}.epics[0].features[0].userStories[0]`,
          )
        : null;
    const usesV41Planning = Boolean(
      firstStory &&
      (Array.isArray(firstStory.functionalRequirementCodes) ||
        (typeof firstStory.code === "string" &&
          firstStory.code.trim().toUpperCase().startsWith("HU-P-"))),
    );
    return (usesV41Planning
      ? parsePlanningBacklogStructureV41(value)
      : parseBacklogStructure(value)) as unknown as DocumentJsonValue;
  }

  if (key === "tests" && Array.isArray(value)) {
    return parseTests(value) as unknown as DocumentJsonValue;
  }
  if (key === "header") {
    const content = object(value, name);
    return {
      title: string(content.title, `${name}.title`, 1_000),
      projectCode: string(content.projectCode, `${name}.projectCode`, 200),
      documentVersion: string(
        content.documentVersion,
        `${name}.documentVersion`,
        100,
      ),
      createdDate: string(content.createdDate, `${name}.createdDate`, 100),
      requestingArea: string(
        content.requestingArea,
        `${name}.requestingArea`,
        500,
      ),
      status: string(content.status, `${name}.status`, 100),
    };
  }

  if (key === "objectives") {
    const content = object(value, name);
    const qualitative = strings(content.qualitative, `${name}.qualitative`, 20);
    const quantitative = strings(
      content.quantitative,
      `${name}.quantitative`,
      20,
    );
    if (qualitative.length === 0 || quantitative.length === 0) {
      throw new Error(
        `${name} debe incluir objetivos cualitativos y cuantitativos.`,
      );
    }
    return {
      general: string(content.general, `${name}.general`, 5_000),
      qualitative,
      quantitative,
    };
  }

  if (key === "scope") {
    const content = object(value, name);
    const kpis = array(content.kpis, `${name}.kpis`, 3);
    if (kpis.length !== 3) {
      throw new Error(`${name}.kpis debe contener exactamente 3 indicadores.`);
    }
    return {
      included: strings(content.included, `${name}.included`, 100),
      excluded: strings(content.excluded, `${name}.excluded`, 100),
      involvedSystems: strings(
        content.involvedSystems,
        `${name}.involvedSystems`,
        100,
      ),
      kpis: kpis.map((item, index) => {
        const kpi = object(item, `${name}.kpis[${index}]`);
        const parsed = {
          name: string(kpi.name, `${name}.kpis[${index}].name`, 300),
          relatedObjective: string(
            kpi.relatedObjective,
            `${name}.kpis[${index}].relatedObjective`,
            2_000,
          ),
          measurement: string(
            kpi.measurement,
            `${name}.kpis[${index}].measurement`,
            2_000,
          ),
          target: string(kpi.target, `${name}.kpis[${index}].target`, 1_000),
        };
        if (
          parsed.name === PENDING_DEFINITION ||
          parsed.relatedObjective === PENDING_DEFINITION ||
          parsed.measurement === PENDING_DEFINITION
        ) {
          throw new Error(
            `${name}.kpis[${index}] debe definir nombre, objetivo relacionado y medición; solo target puede quedar pendiente.`,
          );
        }
        if (/^KPI\s*(?:#|N[ÚU]MERO|NO\.?|0*)?\s*\d+$/iu.test(parsed.name)) {
          throw new Error(
            `${name}.kpis[${index}].name debe describir el indicador y no usar un nombre genérico.`,
          );
        }
        return {
          ...parsed,
        };
      }),
    };
  }

  if (key === "solutionProposal") {
    const content = object(value, name);
    const alignment = object(content.flowAlignment, `${name}.flowAlignment`);
    return {
      objective: string(content.objective, `${name}.objective`, 2_000),
      description: string(content.description, `${name}.description`, 3_000),
      involvedElements: strings(
        content.involvedElements,
        `${name}.involvedElements`,
        12,
      ),
      flowAlignment: {
        currentState: string(
          alignment.currentState,
          `${name}.flowAlignment.currentState`,
          2_000,
        ),
        evaluation: string(
          alignment.evaluation,
          `${name}.flowAlignment.evaluation`,
          2_000,
        ),
        expectedResult: string(
          alignment.expectedResult,
          `${name}.flowAlignment.expectedResult`,
          2_000,
        ),
      },
      prototypeMarkdown:
        content.prototypeMarkdown === undefined
          ? null
          : nullableString(
              content.prototypeMarkdown,
              `${name}.prototypeMarkdown`,
              30_000,
            ),
    };
  }

  if (key === "problemDescription") {
    const content = object(value, name);
    const operationalImpact = strings(
      content.operationalImpact,
      `${name}.operationalImpact`,
      100,
    );
    if (operationalImpact.length === 0) {
      throw new Error(
        `${name}.operationalImpact debe contener al menos un impacto o pendiente explícito.`,
      );
    }
    return {
      currentState: string(
        content.currentState,
        `${name}.currentState`,
        15_000,
      ),
      operationalImpact,
    };
  }

  if (key === "assumptionsDependenciesPending") {
    const content = object(value, name);
    return {
      assumptions: pendingSummaryStrings(
        content.assumptions,
        `${name}.assumptions`,
      ),
      dependencies: pendingSummaryStrings(
        content.dependencies,
        `${name}.dependencies`,
      ),
      pendingItems: pendingSummaryStrings(
        content.pendingItems,
        `${name}.pendingItems`,
      ),
    };
  }

  if (key === "approvalsAndChangeControl") {
    const content = object(value, name);
    const approvals = array(content.approvals, `${name}.approvals`, 3);
    if (approvals.length !== 3) {
      throw new Error(
        `${name}.approvals debe incluir elaboración, revisión y aprobación.`,
      );
    }
    const changeControl = array(
      content.changeControl,
      `${name}.changeControl`,
      1,
    );
    const parsedApprovals = approvals.map((item, index) => {
      const approval = object(item, `${name}.approvals[${index}]`);
      return {
        name: string(approval.name, `${name}.approvals[${index}].name`, 500),
        position: string(
          approval.position,
          `${name}.approvals[${index}].position`,
          500,
        ),
        responsibility: string(
          approval.responsibility,
          `${name}.approvals[${index}].responsibility`,
          200,
        ),
        approvalMoment: string(
          approval.approvalMoment,
          `${name}.approvals[${index}].approvalMoment`,
          1_000,
        ),
        status: string(
          approval.status,
          `${name}.approvals[${index}].status`,
          200,
        ),
      };
    });
    const expectedResponsibilities = ["Elaboración", "Revisión", "Aprobación"];
    if (
      parsedApprovals.some(
        (approval, index) =>
          approval.responsibility !== expectedResponsibilities[index],
      )
    ) {
      throw new Error(
        `${name}.approvals debe conservar el orden Elaboración, Revisión y Aprobación.`,
      );
    }
    return {
      approvals: parsedApprovals,
      changeControl: changeControl.map((item, index) => {
        const change = object(item, `${name}.changeControl[${index}]`);
        return {
          version: string(
            change.version,
            `${name}.changeControl[${index}].version`,
            100,
          ),
          date: string(
            change.date,
            `${name}.changeControl[${index}].date`,
            100,
          ),
          description: string(
            change.description,
            `${name}.changeControl[${index}].description`,
            2_000,
          ),
          approvedBy: string(
            change.approvedBy,
            `${name}.changeControl[${index}].approvedBy`,
            500,
          ),
        };
      }),
    };
  }

  return string(value, name, 30_000);
}

export function parseSections(
  value: unknown,
  requireStructuredKpis = false,
  warnings?: string[],
): AiAnalysisDraftSection[] {
  const legacyDefinitions = DOCUMENT_SECTION_DEFINITIONS.filter(
    (section) => section.key !== "solutionProposal",
  );
  const allowedLengths = new Set([
    legacyDefinitions.length,
    legacyDefinitions.length + 1,
    DOCUMENT_SECTION_DEFINITIONS.length,
    DOCUMENT_SECTION_DEFINITIONS.length + 1,
  ]);
  if (!Array.isArray(value) || !allowedLengths.has(value.length)) {
    throw new Error(
      `El resultado debe contener ${DOCUMENT_SECTION_DEFINITIONS.length} secciones base o ${DOCUMENT_SECTION_DEFINITIONS.length + 1} cuando incluye Plan Scrum.`,
    );
  }

  const includesScrum = value.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { key?: unknown }).key === "scrumPlan",
  );
  const hasSolutionProposal = value.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { key?: unknown }).key === "solutionProposal",
  );
  const baseExpectedSections = hasSolutionProposal
    ? DOCUMENT_SECTION_DEFINITIONS
    : legacyDefinitions;
  const expectedSections = includesScrum
    ? [...baseExpectedSections, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : [...baseExpectedSections];

  /*
   * CANONICAL_SECTION_NORMALIZATION
   *
   * Structured Outputs garantiza que cada elemento de sections cumpla
   * uno de los esquemas permitidos, pero items.anyOf no representa una
   * posición diferente para cada elemento del array.
   *
   * Por ello el proveedor puede devolver las secciones válidas en un
   * orden distinto.
   *
   * El sistema acepta solamente un conjunto COMPLETO y SIN DUPLICADOS
   * y posteriormente lo normaliza al orden canónico.
   *
   * No se aceptan claves desconocidas, faltantes ni duplicadas.
   */

  const historicalBaseSections = [
    ...legacyDefinitions.slice(0, 4),
    ...(hasSolutionProposal
      ? [
          {
            key: "solutionProposal" as const,
            title: "Solución propuesta del profesional de soluciones",
          },
        ]
      : []),
    ...legacyDefinitions.slice(4, 5),
    {
      key: "milestones" as const,
      title: "Requerimientos por hito o funcionalidad",
    },
    {
      key: "nonFunctionalRequirements" as const,
      title: "Requerimientos no funcionales",
    },
    ...legacyDefinitions.slice(7),
  ];
  const historicalSections = includesScrum
    ? [...historicalBaseSections, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : historicalBaseSections;

  const rawSections = value.map((item, index) =>
    object(item, `sections[${index}]`),
  );

  const matchesLayout = (
    layout: readonly {
      readonly key: DocumentSectionKey;
      readonly title: string;
    }[],
  ): boolean => {
    const expectedKeys = new Set(layout.map((section) => section.key));

    const actualKeys = rawSections.map((section) => section.key);

    return (
      actualKeys.length === layout.length &&
      new Set(actualKeys).size === layout.length &&
      actualKeys.every(
        (key) =>
          typeof key === "string" &&
          expectedKeys.has(key as DocumentSectionKey),
      )
    );
  };

  const compatibleSections = matchesLayout(expectedSections)
    ? expectedSections
    : matchesLayout(historicalSections)
      ? historicalSections
      : null;

  if (!compatibleSections) {
    const receivedKeys = rawSections.map((section) =>
      typeof section.key === "string" ? section.key : "<sin-key>",
    );

    throw new Error(
      `Las secciones deben contener exactamente una vez cada clave canónica. Recibidas: ${receivedKeys.join(", ")}.`,
    );
  }

  const sectionsByKey = new Map(
    rawSections.map((section) => [section.key, section] as const),
  );

  /*
   * Importante:
   *
   * iteramos compatibleSections y NO rawSections.
   *
   * Así el resultado interno siempre queda en el orden canónico aunque
   * OpenAI haya enviado una permutación válida.
   */
  const sections = compatibleSections.map((expected, index) => {
    const section = sectionsByKey.get(expected.key);

    if (!section) {
      throw new Error(`Falta la sección canónica ${expected.key}.`);
    }

    if (section.title !== expected.title) {
      throw new Error(
        `El título de ${expected.key} no respeta la plantilla canónica.`,
      );
    }

    return {
      key: expected.key,
      title: expected.title,
      content: parseSectionContent(
        section.content,
        expected.key,
        `sections[${index}].content`,
        requireStructuredKpis,
      ),
    };
  });

  const objectives = sections.find((section) => section.key === "objectives");
  const scope = sections.find((section) => section.key === "scope");
  if (
    objectives &&
    typeof objectives.content === "object" &&
    !Array.isArray(objectives.content) &&
    objectives.content !== null &&
    scope &&
    typeof scope.content === "object" &&
    !Array.isArray(scope.content) &&
    scope.content !== null
  ) {
    const objectiveContent = objectives.content as Readonly<
      Record<string, DocumentJsonValue>
    >;
    const scopeContent = scope.content as Readonly<
      Record<string, DocumentJsonValue>
    >;
    const specificObjectives = [
      ...strings(objectiveContent.qualitative, "objectives.qualitative", 20),
      ...strings(objectiveContent.quantitative, "objectives.quantitative", 20),
    ];
    const knownSpecificObjectives = new Set(specificObjectives);
    const normalizedSpecificObjectives = new Map<string, string[]>();
    for (const objective of specificObjectives) {
      const normalized = normalizedObjectiveReference(objective);
      const candidates = normalizedSpecificObjectives.get(normalized) ?? [];
      normalizedSpecificObjectives.set(normalized, [...candidates, objective]);
    }
    const kpiFailures: KpiObjectiveFailure[] = [];
    for (const [index, item] of array(
      scopeContent.kpis,
      "scope.kpis",
      3,
    ).entries()) {
      const kpi = object(item, `scope.kpis[${index}]`);
      const relatedObjective = string(
        kpi.relatedObjective,
        `scope.kpis[${index}].relatedObjective`,
        2_000,
      );
      if (knownSpecificObjectives.has(relatedObjective)) continue;

      const normalizedCandidates =
        normalizedSpecificObjectives.get(
          normalizedObjectiveReference(relatedObjective),
        ) ?? [];
      let canonicalObjective: string | null = null;
      let repairMethod = "";
      if (normalizedCandidates.length === 1) {
        canonicalObjective = requireDefined(
          normalizedCandidates[0],
          "Invariante: existe exactamente un candidato normalizado.",
        );
        repairMethod = "normalización textual";
      } else if (normalizedCandidates.length > 1) {
        kpiFailures.push({ kpiIndex: index, reason: "AMBIGUOUS" });
        continue;
      } else {
        const fuzzy = classifyFuzzyObjectiveReference(
          relatedObjective,
          specificObjectives,
        );
        if (fuzzy.status === "SINGLE") {
          canonicalObjective = fuzzy.objective;
          repairMethod = "coincidencia léxica inequívoca";
        } else {
          kpiFailures.push({
            kpiIndex: index,
            reason: fuzzy.status === "AMBIGUOUS" ? "AMBIGUOUS" : "NO_MATCH",
          });
          continue;
        }
      }

      // Keep the stored relation canonical even when the provider only
      // changed casing, accents, punctuation or made a safe lexical
      // paraphrase. The provider text is never persisted as the relation:
      // the exact objective generated in section 2 is restored.
      (kpi as Record<string, unknown>).relatedObjective = canonicalObjective;
      if (warnings) {
        pushReconciliationWarning(
          warnings,
          `KPI ${index + 1}: relatedObjective se canonicalizó automáticamente mediante ${repairMethod} al objetivo específico "${canonicalObjective}".`,
        );
      }
    }

    /*
     * Fail-closed: si algún KPI no tiene exactamente un candidato seguro, no
     * seleccionamos objetivos por proximidad ni por posición. El error tipado
     * conserva por KPI si fue "sin coincidencia" o "ambiguo".
     */
    if (kpiFailures.length > 0) {
      throw new KpiObjectiveReferenceError(kpiFailures);
    }
  }

  return sections;
}
