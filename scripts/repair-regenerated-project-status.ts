import { randomUUID } from "node:crypto";
import source from "../apps/documents-service/src/database/data-source";
async function main() {
  source.setOptions({entities: []}); await source.initialize();
  try {
    await source.transaction(async manager => {
      const rows = await manager.query(`SELECT p.Id, p.Code, p.Title, p.Status FROM RqProjectsDb.dbo.Projects p WITH (UPDLOCK, HOLDLOCK) JOIN dbo.RequirementDocuments d ON d.ProjectId=p.Id JOIN dbo.DocumentVersions v ON v.DocumentId=d.Id AND v.VersionNumber=d.CurrentVersionNumber WHERE p.Code=@0 AND p.Status='APPROVED' AND d.Id=@1 AND d.CurrentVersionNumber=7 AND d.Status='DRAFT' AND v.Status='DRAFT'`, ['RQ-2026-000259', 'B2BCE352-88B8-48CB-A7AF-E82E064B732A']);
      if (rows.length !== 1) { console.log('Sin corrección pendiente que coincida con la versión verificada.'); return; }
      const row = rows[0];
      await manager.query(`UPDATE RqProjectsDb.dbo.Projects SET Status='DOCUMENT_GENERATED', UpdatedAt=SYSUTCDATETIME() WHERE Id=@0 AND Status='APPROVED'`, [row.Id]);
      await manager.query(`INSERT INTO RqProjectsDb.dbo.ProjectAuditEvents (Id,ProjectId,ActorUserId,ActorName,ProjectLabel,Action,MetadataJson,OccurredAt) VALUES (@0,@1,@2,@3,@4,'PROJECT_UPDATED',@5,SYSUTCDATETIME())`, [randomUUID(), row.Id, '00000000-0000-4000-8000-000000000005', 'Sistema · corrección de estado por regeneración', `${row.Code} · ${row.Title}`.slice(0,260), JSON.stringify({changes:[{field:'status',label:'Estado',before:'APPROVED',after:'DOCUMENT_GENERATED'}],reason:'Reconciliación autorizada: versión actual 7 en borrador'})]);
      console.log(`${row.Code}: APPROVED → DOCUMENT_GENERATED`);
    });
  } finally {await source.destroy();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
