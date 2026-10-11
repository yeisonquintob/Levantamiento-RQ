"use client";

export {
  functionalStoryDescriptionForDisplay,
  cleanDocumentText,
  presentSectionContent,
} from "./document-section-presenter/shared";
export { normalizeHeaderRecord } from "./document-section-presenter/header-model";
export { normalizeObjectives } from "./document-section-presenter/objectives-section";
export {
  parseProblemNarrative,
  normalizeProblemDescription,
} from "./document-section-presenter/problem-description-section";
export { normalizeScope } from "./document-section-presenter/scope-section";
export { normalizeNonFunctionalRequirements } from "./document-section-presenter/non-functional-section";
export { normalizePendingSection } from "./document-section-presenter/pending-section";
export { ProcessFlowDiagram } from "./document-section-presenter/process-flow-diagram";
export {
  resolveDiagramModels,
  hasProcessFlowModelContent,
  hasEntityRelationshipModelContent,
} from "./document-section-presenter/diagram-models";
export {
  type SwimlaneBox,
  swimlaneEdgeLabel,
  swimlaneLayout,
  type SwimlaneRoute,
  swimlaneRoute,
  swimlaneLabelPosition,
} from "./document-section-presenter/swimlane-layout";
export {
  type EntityBox,
  type EntityRelationshipLayout,
  entityRelationshipLayout,
  entityRelationshipSides,
  entityRelationshipRoute,
  parseCardinality,
  cardinalityMark,
} from "./document-section-presenter/entity-relationship-layout";
export { RequirementStoryDetail } from "./document-section-presenter/requirement-story-detail";
export {
  normalizeStoryAcceptanceCriteria,
  composeRequirementsContent,
  type ConfirmedManualMilestoneOption,
  confirmedManualMilestoneOptions,
  type CommonEpicMilestoneRootSummary,
  commonEpicMilestoneRoots,
  integratedPoint6Point7Issues,
  assignPendingFunctionalStoryToMilestone,
} from "./document-section-presenter/requirements-model";
export { IntegratedPoint6Point7Panel } from "./document-section-presenter/requirements-view";
export {
  type PendingPlanningAssignmentKind,
  assignPendingPlanningItem,
  createParentForPendingPlanningItem,
} from "./document-section-presenter/backlog-planning-model";
export {
  ScrumView,
  ScrumEditor,
} from "./document-section-presenter/scrum-section";
export { WorkPlanStages } from "./document-section-presenter/work-plan-section";
export { normalizeApprovalsSection } from "./document-section-presenter/approvals-section";

import React from "react";
import {
  type DocumentJsonValue,
  type DocumentSectionKey,
} from "@levantamiento-rq/shared-contracts";
import {
  ApprovalsView,
  ApprovalsEditor,
} from "./document-section-presenter/approvals-section";
import { BacklogStructureEditor } from "./document-section-presenter/backlog-structure-editor";
import { BacklogStructureView } from "./document-section-presenter/backlog-structure-view";
import {
  HeaderView,
  HeaderEditor,
  KnownSectionView,
  KnownSectionEditor,
} from "./document-section-presenter/header-known-sections";
import { NarrativeView } from "./document-section-presenter/narrative";
import {
  NON_FUNCTIONAL_FIELDS,
  normalizeNonFunctionalRequirements,
} from "./document-section-presenter/non-functional-section";
import {
  ObjectivesView,
  ObjectivesEditor,
} from "./document-section-presenter/objectives-section";
import {
  PendingView,
  PendingEditor,
} from "./document-section-presenter/pending-section";
import {
  HumanValue,
  SafeValueEditor,
  type BusinessEditorProps,
} from "./document-section-presenter/primitives";
import {
  ProblemDescriptionView,
  ProblemDescriptionEditor,
} from "./document-section-presenter/problem-description-section";
import { ProcessModelsEditor } from "./document-section-presenter/process-models-editor";
import { ProcessModelsView } from "./document-section-presenter/process-models-view";
import { RequirementsEditor } from "./document-section-presenter/requirements-editor";
import { RequirementsView } from "./document-section-presenter/requirements-view";
import {
  ScopeView,
  KpiDashboardView,
  KpiDashboardEditor,
  ScopeEditor,
} from "./document-section-presenter/scope-section";
import {
  PENDING,
  recordValue,
  presentSectionContent,
  restoreSectionContent,
} from "./document-section-presenter/shared";
import {
  SolutionProposalView,
  SolutionProposalEditor,
} from "./document-section-presenter/solution-proposal-section";
import {
  TestsView,
  TestsEditor,
} from "./document-section-presenter/tests-section";
import {
  WorkPlanView,
  WorkPlanEditor,
} from "./document-section-presenter/work-plan-section";

function editableTemplateSectionValue(
  sectionKey: DocumentSectionKey,
  value: DocumentJsonValue,
): DocumentJsonValue {
  if (
    sectionKey !== "writingRules" &&
    sectionKey !== "visualFormat" &&
    sectionKey !== "automationInstruction"
  ) {
    return value;
  }
  const record = recordValue(value);
  return record?.templateControlled === true && Object.keys(record).length === 1
    ? PENDING
    : value;
}

export function DocumentHumanValue({ value }: { value: DocumentJsonValue }) {
  return <HumanValue value={presentSectionContent(value)} />;
}

export function DocumentSectionView({
  sectionKey,
  value,
  context,
}: {
  sectionKey: DocumentSectionKey;
  value: DocumentJsonValue;
  templateControlled?: boolean;
  context?: {
    projectId?: string;
    backlogStructure?: DocumentJsonValue | null;
    milestones?: DocumentJsonValue | null;
    scope?: DocumentJsonValue | null;
    solutionProposal?: DocumentJsonValue | null;
    templateName?: string;
    templateVersion?: string;
  };
}) {
  const presented = presentSectionContent(value);
  if (sectionKey === "automationInstruction")
    return (
      <KpiDashboardView
        backlogValue={context?.backlogStructure}
        projectId={context?.projectId}
        scopeValue={context?.scope}
        value={presented}
      />
    );
  if (sectionKey === "writingRules" || sectionKey === "visualFormat")
    return (
      <NarrativeView
        value={editableTemplateSectionValue(sectionKey, presented)}
      />
    );
  if (sectionKey === "header") return <HeaderView value={presented} />;
  if (sectionKey === "objectives") return <ObjectivesView value={presented} />;
  if (sectionKey === "problemDescription")
    return <ProblemDescriptionView value={presented} />;
  if (sectionKey === "scope") return <ScopeView value={presented} />;
  if (sectionKey === "solutionProposal")
    return <SolutionProposalView value={presented} />;
  if (sectionKey === "processFlow")
    return <ProcessModelsView value={presented} />;
  if (sectionKey === "milestones")
    return (
      <RequirementsView
        backlogValue={context?.backlogStructure}
        value={presented}
      />
    );
  if (sectionKey === "backlogStructure")
    return <BacklogStructureView value={presented} />;
  if (sectionKey === "nonFunctionalRequirements") {
    const normalized = normalizeNonFunctionalRequirements(presented);
    return (
      <KnownSectionView
        fields={NON_FUNCTIONAL_FIELDS}
        value={normalized ?? presented}
      />
    );
  }
  if (sectionKey === "tests") return <TestsView value={presented} />;
  if (sectionKey === "assumptionsDependenciesPending")
    return <PendingView value={presented} />;
  if (sectionKey === "scrumPlan")
    return (
      <WorkPlanView
        backlogValue={context?.backlogStructure}
        value={presented}
      />
    );
  if (sectionKey === "approvalsAndChangeControl")
    return <ApprovalsView value={presented} />;
  return <NarrativeView value={presented} />;
}

export function DocumentSectionBusinessEditor({
  sectionKey,
  value,
  readOnly,
  onChange,
  context,
}: {
  sectionKey: DocumentSectionKey;
  context?: {
    projectId?: string;
    backlogStructure?: DocumentJsonValue | null;
    milestones?: DocumentJsonValue | null;
    scope?: DocumentJsonValue | null;
    solutionProposal?: DocumentJsonValue | null;
    templateName?: string;
    templateVersion?: string;
  };
} & BusinessEditorProps) {
  const presented = presentSectionContent(value);
  const change = (next: DocumentJsonValue) =>
    onChange(restoreSectionContent(value, next));
  if (sectionKey === "header")
    return (
      <HeaderEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "objectives")
    return (
      <ObjectivesEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "problemDescription")
    return (
      <ProblemDescriptionEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "scope")
    return (
      <ScopeEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "solutionProposal")
    return (
      <SolutionProposalEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "processFlow")
    return (
      <ProcessModelsEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "milestones")
    return (
      <RequirementsEditor
        backlogValue={context?.backlogStructure}
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "backlogStructure")
    return (
      <BacklogStructureEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "nonFunctionalRequirements") {
    const normalized = normalizeNonFunctionalRequirements(presented);
    return (
      <KnownSectionEditor
        fields={NON_FUNCTIONAL_FIELDS}
        narrativeLabel="Requerimientos no funcionales"
        onChange={change}
        readOnly={readOnly}
        value={normalized ?? presented}
      />
    );
  }
  if (sectionKey === "tests")
    return (
      <TestsEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "assumptionsDependenciesPending")
    return (
      <PendingEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "approvalsAndChangeControl")
    return (
      <ApprovalsEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "automationInstruction")
    return (
      <KpiDashboardEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "scrumPlan")
    return (
      <WorkPlanEditor
        backlogValue={context?.backlogStructure}
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "writingRules" || sectionKey === "visualFormat")
    return (
      <SafeValueEditor
        label="Contenido de la sección"
        onChange={change}
        readOnly={readOnly}
        value={editableTemplateSectionValue(sectionKey, presented)}
      />
    );
  return (
    <SafeValueEditor
      label="Contenido de la sección"
      onChange={change}
      readOnly={readOnly}
      value={presented}
    />
  );
}
