import assert from "node:assert/strict";
import test from "node:test";
import { ProjectsService } from "../../apps/projects-service/src/projects/projects.service";

test("el servidor guarda Documento generado para un borrador verificado y registra el cambio", async () => {
  const saved: unknown[] = [];
  const audited: unknown[] = [];
  const project = {id:'project',status:'APPROVED',participants:[]};
  const service = { requireAccessibleProject:async()=>project, requireManageAccess:()=>{},
    dataSource:{transaction:async(fn: (manager: unknown)=>Promise<void>)=>fn({getRepository:()=>({save:async(p: unknown)=>saved.push(p)})})},
    recordAudit:async(...args: unknown[])=>audited.push(args),
  };
  const original = globalThis.fetch;
  globalThis.fetch = async()=>new Response(JSON.stringify({projectId:'project',status:'DRAFT'}));
  try {
    await ProjectsService.prototype.documentGenerated.call(service as never, {id:'actor',permissions:['documents.ai.apply']} as never,'project','doc','token');
    assert.equal(project.status,'DOCUMENT_GENERATED'); assert.equal(saved.length,1); assert.equal(audited.length,1);
  } finally {globalThis.fetch=original;}
});

test("no cambia el proyecto si la versión ya está aprobada o pertenece a otro proyecto", async()=>{
  const original=globalThis.fetch;
  try {
    for (const result of [{projectId:'project',status:'APPROVED'},{projectId:'other',status:'DRAFT'}]) {
      const project={id:'project',status:'APPROVED'};
      const service={requireAccessibleProject:async()=>project,requireManageAccess:()=>{}};
      globalThis.fetch=async()=>new Response(JSON.stringify(result));
      await assert.rejects(ProjectsService.prototype.documentGenerated.call(service as never,{permissions:['documents.ai.apply']} as never,'project','doc','token'));
      assert.equal(project.status,'APPROVED');
    }
  } finally {globalThis.fetch=original;}
});
