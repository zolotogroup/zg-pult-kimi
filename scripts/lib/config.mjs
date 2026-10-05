// Конфигурация и секреты.
// Локально секреты читаются из .secrets/ (не коммитить!), в GitHub Actions — из env (secrets).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SECRETS_DIR = path.join(ROOT, ".secrets");

export function secret(name, envName) {
  const env = envName || name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (process.env[env]) return process.env[env].trim();
  const file = path.join(SECRETS_DIR, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  throw new Error(`Секрет не найден: ${name} (env ${env} или .secrets/${name})`);
}

export function secretOr(name, envName, dflt = "") {
  try { return secret(name, envName); } catch { return dflt; }
}

export function weekRoles() {
  if (process.env.WEEK_ROLES_JSON) return JSON.parse(process.env.WEEK_ROLES_JSON);
  return JSON.parse(secret("week-roles.json"));
}

// Пароль хаба с полным доступом (мастер-пароль сборки).
export const portalPass = () => secret("portal.pass", "PORTAL_PASS");
