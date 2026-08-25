-- Administradores globais existentes precisam enxergar os setores que ja
-- foram criados antes do vinculo automatico introduzido no Hub.
INSERT INTO nexus.principal_departments (principal_id, department_id)
SELECT DISTINCT ra.principal_id, d.id
FROM nexus.role_assignments ra
JOIN nexus.roles r ON r.id=ra.role_id AND r.slug='administrador'
CROSS JOIN nexus.departments d
WHERE ra.department_id IS NULL AND d.ativo=true
ON CONFLICT DO NOTHING;

