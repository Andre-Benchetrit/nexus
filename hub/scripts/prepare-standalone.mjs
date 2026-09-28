import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hubRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = join(hubRoot, ".next", "standalone", "hub");
const staticSource = join(hubRoot, ".next", "static");
const staticTarget = join(standaloneRoot, ".next", "static");
const publicSource = join(hubRoot, "public");
const publicTarget = join(standaloneRoot, "public");

if (!existsSync(standaloneRoot)) {
  throw new Error("Build standalone do Hub nao foi encontrado.");
}

if (!existsSync(staticSource)) {
  throw new Error("Assets estaticos do Hub nao foram encontrados.");
}

mkdirSync(join(standaloneRoot, ".next"), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true, force: true });

if (existsSync(publicSource)) {
  cpSync(publicSource, publicTarget, { recursive: true, force: true });
}

console.log("Assets do Hub copiados para o pacote standalone.");
