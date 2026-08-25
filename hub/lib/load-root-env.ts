import path from "node:path";
import { config as loadDotenv } from "dotenv";

// O workspace Next executa com cwd em /hub durante o desenvolvimento local,
// enquanto o Nexus conserva um unico .env na raiz. No Railway as variaveis ja
// chegam pelo ambiente e este carregamento nao altera valores existentes.
export function loadRootEnv() {
  const cwd = process.cwd();
  const root = path.basename(cwd).toLowerCase() === "hub" ? path.dirname(cwd) : cwd;
  loadDotenv({ path: path.join(root, ".env"), override: false, quiet: true });
}

