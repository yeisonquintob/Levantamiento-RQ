import source from "../apps/documents-service/src/database/data-source";
async function main() {
 source.setOptions({entities: []}); await source.initialize();
 try { console.log(JSON.stringify(await source.query(`SELECT p.Id, p.Code, p.Status ProjectStatus, d.Id DocumentId, d.Status DocumentStatus, d.CurrentVersionNumber, d.UpdatedByUserId, v.Status VersionStatus FROM RqProjectsDb.dbo.Projects p JOIN dbo.RequirementDocuments d ON d.ProjectId=p.Id JOIN dbo.DocumentVersions v ON v.DocumentId=d.Id AND v.VersionNumber=d.CurrentVersionNumber WHERE p.Code='RQ-2026-000259'`))); } finally { await source.destroy(); }
}
main().catch(e=>{console.error(e.message); process.exitCode=1;});
