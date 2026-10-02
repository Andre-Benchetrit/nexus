function validarToolChoice(toolChoice, ferramentas = []) {
  if (toolChoice === null || toolChoice === undefined || toolChoice === '') return null;
  const nome = String(toolChoice);
  const disponiveis = new Set(
    ferramentas.map((ferramenta) => ferramenta?.definicao?.name).filter(Boolean)
  );
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(nome) || !disponiveis.has(nome)) {
    const erro = new Error(`Tool obrigatoria indisponivel: ${nome}.`);
    erro.codigo = 'TOOL_CHOICE_INVALID';
    throw erro;
  }
  return nome;
}

module.exports = { validarToolChoice };
