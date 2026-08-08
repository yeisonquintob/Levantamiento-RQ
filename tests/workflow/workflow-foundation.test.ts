import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKFLOW_ACTIVITY_TYPES,
  WORKFLOW_ASSIGNMENT_ROLES,
  WORKFLOW_ASSIGNMENT_STATUSES,
  WORKFLOW_REVIEW_STATUSES,
} from "../../libs/shared/contracts/src/lib/workflow.js";

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
