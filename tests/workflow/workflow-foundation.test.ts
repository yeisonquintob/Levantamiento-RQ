import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKFLOW_ACTIVITY_TYPES,
  WORKFLOW_ASSIGNMENT_ROLES,
  WORKFLOW_ASSIGNMENT_STATUSES,
  WORKFLOW_REVIEW_STATUSES,
} from "../../libs/shared/contracts/src/lib/workflow.js";
import { loadWorkflowAuthConfig } from "../../apps/workflow-service/src/reviews/workflow-auth.config.js";
import {
  parseAddComment,
  parseCreateReview,
  parseDecision,
} from "../../apps/workflow-service/src/reviews/workflow-input.js";

test("el contrato publica los estados y acciones del Punto 19", () => {
  assert.deepEqual(WORKFLOW_REVIEW_STATUSES, [
    "IN_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED",
    "REJECTED",
    "CANCELLED",
  ]);
  assert.deepEqual(WORKFLOW_ASSIGNMENT_ROLES, ["REVIEWER", "APPROVER"]);
  assert.deepEqual(WORKFLOW_ASSIGNMENT_STATUSES, ["PENDING", "COMPLETED"]);
  assert.deepEqual(WORKFLOW_ACTIVITY_TYPES, [
    "REVIEW_REQUESTED",
    "COMMENTED",
    "CHANGES_REQUESTED",
    "APPROVED",
    "REJECTED",
  ]);
});

test("RqWorkflowDb mantiene referencias externas sin claves foráneas", async () => {
  const migration = await readFile(
    "apps/workflow-service/src/database/migrations/1786406400000-CreateWorkflowFoundation.ts",
    "utf8",
  );

  for (const table of [
    "WorkflowReviewRequests",
    "WorkflowReviewAssignments",
    "WorkflowReviewActivities",
  ]) {
    assert.match(migration, new RegExp(`dbo\\.${table}`));
  }

  assert.match(migration, /FK_WorkflowReviewAssignments_Request/);
  assert.match(migration, /FK_WorkflowReviewActivities_Request/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(
    migration,
    /RqProjectsDb|RqDocumentsDb|RqIdentityDb|FOREIGN KEY \(ProjectId\)|FOREIGN KEY \(DocumentId\)|FOREIGN KEY \(UserId\)/,
  );
});

test("la migración protege estados, auditoría e idempotencia", async () => {
  const migration = await readFile(
    "apps/workflow-service/src/database/migrations/1786406400000-CreateWorkflowFoundation.ts",
    "utf8",
  );

  assert.match(migration, /CK_WorkflowReviewRequests_Status/);
  assert.match(migration, /CK_WorkflowReviewAssignments_Role/);
  assert.match(migration, /CK_WorkflowReviewActivities_Type/);
  assert.match(migration, /CorrelationId uniqueidentifier NOT NULL/);
  assert.match(migration, /IdempotencyKey nvarchar\(120\) NULL/);
  assert.match(migration, /UX_WorkflowReviewActivities_Request_IdempotencyKey/);
});

test("TypeORM usa una sola integración y registra entidades propias", async () => {
  const packageFile = await readFile(
    "apps/workflow-service/package.json",
    "utf8",
  );
  const entities = await readFile(
    "apps/workflow-service/src/reviews/workflow-review.entities.ts",
    "utf8",
  );
  const moduleFile = await readFile(
    "apps/workflow-service/src/app/app.module.ts",
    "utf8",
  );

  assert.match(packageFile, /"@nestjs\/typeorm": "11\.0\.3"/);
  assert.match(packageFile, /"typeorm": "0\.3\.31"/);
  assert.match(entities, /@Entity\(\{ name: "WorkflowReviewRequests" \}\)/);
  assert.match(entities, /@Entity\(\{ name: "WorkflowReviewAssignments" \}\)/);
  assert.match(entities, /@Entity\(\{ name: "WorkflowReviewActivities" \}\)/);
  assert.match(moduleFile, /TypeOrmModule\.forFeature\(workflowEntities\)/);
  assert.match(moduleFile, /databaseConfig\.enabled/);
});

test("Workflow publica comandos repetibles para activar y verificar su base", async () => {
  const packageFile = await readFile("package.json", "utf8");
  const environmentExample = await readFile(
    "apps/workflow-service/.env.example",
    "utf8",
  );
  const ensureScript = await readFile(
    "scripts/workflow-ensure-database.ts",
    "utf8",
  );
  const verifyScript = await readFile(
    "scripts/workflow-verify-database.ts",
    "utf8",
  );

  for (const command of [
    "workflow:db:ensure",
    "workflow:db:state",
    "workflow:db:verify",
    "workflow:migration:run",
    "workflow:migration:revert",
  ]) {
    assert.match(packageFile, new RegExp(`"${command}"`));
  }

  assert.match(environmentExample, /DATABASE_ENABLED=true/);
  assert.match(environmentExample, /WORKFLOW_CREATE_DATABASE=false/);
  assert.match(ensureScript, /WORKFLOW_CREATE_DATABASE/);
  assert.match(verifyScript, /CreateWorkflowFoundation1786406400000/);
});

test("la entrada exige concurrencia optimista y limita comentarios", () => {
  assert.deepEqual(
    parseCreateReview({ expectedDocumentRevision: 3, comment: "Lista" }),
    { expectedDocumentRevision: 3, comment: "Lista" },
  );
  assert.deepEqual(
    parseAddComment({
      expectedReviewRevision: 2,
      comment: " Revisar alcance ",
    }),
    { expectedReviewRevision: 2, comment: "Revisar alcance" },
  );
  assert.deepEqual(
    parseDecision({
      expectedReviewRevision: 2,
      expectedDocumentRevision: 4,
    }),
    {
      expectedReviewRevision: 2,
      expectedDocumentRevision: 4,
      comment: null,
    },
  );
  assert.throws(() =>
    parseAddComment({ expectedReviewRevision: 1, comment: "" }),
  );
  assert.throws(() => parseCreateReview({ expectedDocumentRevision: 0 }));
});

test("la configuración segura valida secreto, URLs y tiempos", () => {
  const config = loadWorkflowAuthConfig({
    JWT_ACCESS_SECRET: "s".repeat(32),
    PROJECTS_SERVICE_URL: "http://projects.internal:3002/",
    DOCUMENTS_SERVICE_URL: "http://documents.internal:3004/",
    PROJECTS_TIMEOUT_MS: "1200",
    DOCUMENTS_TIMEOUT_MS: "1500",
  });

  assert.equal(config.projectsServiceUrl, "http://projects.internal:3002");
  assert.equal(config.documentsServiceUrl, "http://documents.internal:3004");
  assert.equal(config.projectsTimeoutMs, 1200);
  assert.equal(config.documentsTimeoutMs, 1500);
  assert.throws(() => loadWorkflowAuthConfig({ JWT_ACCESS_SECRET: "short" }));
});

test("la API coordina revisiones sin apropiarse de datos documentales", async () => {
  const controller = await readFile(
    "apps/workflow-service/src/reviews/workflow-reviews.controller.ts",
    "utf8",
  );
  const service = await readFile(
    "apps/workflow-service/src/reviews/workflow-reviews.service.ts",
    "utf8",
  );
  const documentsClient = await readFile(
    "apps/workflow-service/src/reviews/documents-access.client.ts",
    "utf8",
  );

  for (const action of ["comments", "request-changes", "approve", "reject"]) {
    assert.match(controller, new RegExp(action));
  }
  assert.match(controller, /WorkflowAccessTokenGuard/);
  assert.match(service, /expectedReviewRevision/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /WorkflowReviewActivityEntity/);
  assert.match(documentsClient, /submit-review/);
  assert.match(documentsClient, /"approve" \| "reject"/);
  assert.doesNotMatch(
    service,
    /DocumentVersionEntity|RequirementDocumentEntity/,
  );
});
