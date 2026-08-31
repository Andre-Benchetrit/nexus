INSERT INTO nexus.principals (slug,tipo,nome)
VALUES ('knowledge-sync','tecnico','Sincronizacao documental Nexus')
ON CONFLICT (slug) DO UPDATE SET ativo=true,atualizado_em=now();

INSERT INTO nexus.principal_departments (principal_id,department_id)
SELECT p.id,d.id FROM nexus.principals p CROSS JOIN nexus.departments d
WHERE p.slug='knowledge-sync' AND d.ativo=true
ON CONFLICT DO NOTHING;

INSERT INTO nexus.permission_overrides
  (principal_id,permission_id,department_id,efeito,motivo)
SELECT pr.id,pe.id,NULL,'permitir','Ator tecnico restrito a sincronizacao da base documental oficial'
FROM nexus.principals pr CROSS JOIN nexus.permissions pe
WHERE pr.slug='knowledge-sync'
  AND pe.codigo IN ('documentacao.importar','documentacao.administrar.global')
  AND NOT EXISTS (
    SELECT 1 FROM nexus.permission_overrides po
    WHERE po.principal_id=pr.id AND po.permission_id=pe.id
      AND po.department_id IS NULL AND po.efeito='permitir'
  );
