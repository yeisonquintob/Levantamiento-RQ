import { type DocumentVersionDetail } from "@levantamiento-rq/shared-contracts";
import {
  backlogStructureTreeLines,
  flowDiagramFromSteps,
  requirementsGroupTables,
  structuredFlowDiagram,
  structuredFlowSteps,
  structuredMilestoneTables,
  structuredScrumLines,
  structuredTestTables,
} from "./export-document.structures";
import {
  TEMPLATE_CONTROLLED_EXPORT_TEXT,
  compactLines,
  flattenDocumentContent,
  jsonRecord,
  mermaidFlowSteps,
  templatePlaceholderOnly,
  versionSection,
} from "./export-document.text";
import {
  type ExportSectionPresentation,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

export function sectionPresentation(
  section: DocumentVersionDetail["sections"][number],
): ExportSectionPresentation {
  if (templatePlaceholderOnly(section)) {
    return {
      lines: [
        {
          text:
            TEMPLATE_CONTROLLED_EXPORT_TEXT[section.key] ??
            "Contenido institucional controlado por la plantilla.",
          level: 0,
          bullet: false,
        },
      ],
      flowSteps: [],
      tables: [],
    };
  }

  if (section.key === "header") {
    const content = jsonRecord(section.content);
    const visibleHeader = content
      ? Object.fromEntries(
          [
            "title",
            "projectCode",
            "documentVersion",
            "createdDate",
            "requestingArea",
            "status",
          ].flatMap((key) =>
            content[key] === undefined ? [] : [[key, content[key]]],
          ),
        )
      : typeof section.content === "string"
        ? section.content
            .split(/\r?\n/u)
            .filter(
              (line) =>
                !/^\s*(?:elaborado|preparado|revisado|aprobado)\s+por\s*:/iu.test(
                  line,
                ),
            )
            .join("\n")
        : section.content;
    return {
      lines: compactLines(flattenDocumentContent(visibleHeader)),
      flowSteps: [],
      tables: [],
    };
  }

  if (section.key === "processFlow" && typeof section.content === "string") {
    const match = section.content.match(/```mermaid\s*([\s\S]*?)```/iu);

    if (match) {
      const code = match[1] ?? "";
      const before = section.content
        .slice(0, match.index ?? 0)
        .trim()
        .replace(
          /flowchart\s*\(mermaid\)\s*representado\s*a\s*partir\s*de\s*la\s*fuente\s*:?\s*$/iu,
          "",
        )
        .trim();

      const after = section.content
        .slice((match.index ?? 0) + match[0].length)
        .trim();

      const narrative = [before, after].filter(Boolean).join("\n");

      return {
        lines: narrative ? compactLines(flattenDocumentContent(narrative)) : [],
        flowSteps: mermaidFlowSteps(code),
        tables: [],
        flowDiagram: flowDiagramFromSteps(
          "Flujo funcional",
          mermaidFlowSteps(code),
        ),
      };
    }

    if (/^\s*(?:flowchart|graph)\b/iu.test(section.content)) {
      return {
        lines: [],
        flowSteps: mermaidFlowSteps(section.content),
        tables: [],
        flowDiagram: flowDiagramFromSteps(
          "Flujo funcional",
          mermaidFlowSteps(section.content),
        ),
      };
    }
  }

  const content = jsonRecord(section.content);
  if (content) {
    if (section.key === "solutionProposal") {
      const visibleContent = { ...content };
      delete visibleContent.prototypeMarkdown;
      return {
        lines: compactLines(flattenDocumentContent(visibleContent)),
        flowSteps: [],
        tables: [],
      };
    }
    if (section.key === "processFlow") {
      return {
        lines: content.title
          ? compactLines(flattenDocumentContent(content.title))
          : [],
        flowSteps: structuredFlowSteps(content),
        tables: [],
        flowDiagram: structuredFlowDiagram(content),
      };
    }
    if (
      section.key === "milestones" &&
      (content.features || content.userStories)
    ) {
      return {
        lines: [],
        flowSteps: [],
        tables: structuredMilestoneTables(content),
      };
    }
    if (
      section.key === "milestones" &&
      (content.functionalRequirements || content.nonFunctionalRequirements)
    ) {
      return {
        lines: [],
        flowSteps: [],
        tables: requirementsGroupTables(content),
      };
    }
    if (section.key === "backlogStructure" && content.epics) {
      return {
        lines: backlogStructureTreeLines(content),
        flowSteps: [],
        tables: [],
      };
    }
    if (section.key === "tests" && content.scenarios) {
      return {
        lines: [],
        flowSteps: [],
        tables: structuredTestTables(content),
      };
    }
    if (section.key === "scrumPlan" && content.sprints) {
      return {
        lines: structuredScrumLines(content),
        flowSteps: [],
        tables: [],
      };
    }
  }

  return {
    lines: compactLines(flattenDocumentContent(section.content)),
    flowSteps: [],
    tables: [],
  };
}

export function presentationFor(
  input: RenderApprovedDocumentInput,
  key: DocumentVersionDetail["sections"][number]["key"],
): ExportSectionPresentation {
  const section = versionSection(input, key);
  return section
    ? sectionPresentation(section)
    : { lines: [], flowSteps: [], tables: [], flowDiagram: null };
}
