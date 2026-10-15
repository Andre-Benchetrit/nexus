const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".dotx"]);

function validateKnowledgeFile(file, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  if (!file) return "Selecione um arquivo PDF, DOCX ou DOTX.";
  const extension = String(file.name || "").match(/\.[^.]+$/)?.[0]?.toLocaleLowerCase("en-US");
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return "Formato inválido. Selecione um arquivo PDF, DOCX ou DOTX.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "O arquivo selecionado está vazio ou não pôde ser lido.";
  }
  if (file.size > maxBytes) {
    return `O arquivo excede o limite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}

function createKnowledgeImportController(onStateChange, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  let state = { fileName: "", error: null, pending: false };
  let inFlight = false;

  function publish(next) {
    state = { ...state, ...next };
    onStateChange({ ...state });
  }

  function clear(input, error = null) {
    if (input) input.value = "";
    publish({ fileName: "", error, pending: false });
  }

  return {
    select(file, input) {
      const error = validateKnowledgeFile(file, maxBytes);
      if (error) {
        clear(input, error);
        return false;
      }
      publish({ fileName: file.name, error: null });
      return true;
    },

    cancel(input) {
      clear(input);
    },

    async submit(input, form, upload, onSuccess) {
      if (inFlight) return false;
      const file = input?.files?.[0] || null;
      const error = validateKnowledgeFile(file, maxBytes);
      if (error) {
        publish({ fileName: "", error });
        if (input) input.value = "";
        return false;
      }

      inFlight = true;
      publish({ pending: true, error: null });
      try {
        await upload(form);
        if (form && typeof form.reset === "function") form.reset();
        clear(input);
        if (onSuccess) onSuccess();
        return true;
      } catch (cause) {
        publish({ error: cause instanceof Error
          ? cause.message
          : "Não foi possível importar o documento. Tente novamente." });
        return false;
      } finally {
        inFlight = false;
        if (state.pending) publish({ pending: false });
      }
    }
  };
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  createKnowledgeImportController,
  validateKnowledgeFile
};
