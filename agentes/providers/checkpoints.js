function emitirCheckpoint(onCheckpoint, tipo, dados = {}) {
  if (typeof onCheckpoint !== 'function') return;
  onCheckpoint(tipo, dados);
}

module.exports = { emitirCheckpoint };
