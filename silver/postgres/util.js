function citar(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

function flagBooleano(campo) {
  return `CASE lower(trim(CAST(${campo} AS VARCHAR))) ` +
    `WHEN 't' THEN true WHEN 'true' THEN true WHEN '1' THEN true ` +
    `WHEN 's' THEN true WHEN 'sim' THEN true ` +
    `WHEN 'f' THEN false WHEN 'false' THEN false WHEN '0' THEN false ` +
    `WHEN 'n' THEN false WHEN 'nao' THEN false ELSE NULL END`;
}

function texto(campo) {
  return `nullif(trim(CAST(${campo} AS VARCHAR)), '')`;
}

module.exports = { citar, flagBooleano, texto };
