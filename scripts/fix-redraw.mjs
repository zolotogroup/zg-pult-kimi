// Патч week.bin: чинит переключение архивных недель.
// Баг: window.__redraw = function(){ roles(); mail(); } объявлен в глобальной области,
// а roles/mail — функции внутри замыкания window.__start. Глобальный roles перекрыт
// элементом id="roles" (named access), mail — элементом id="mail" → «roles is not a function»,
// письмо не перерисовывалось при смене недели.
// Фикс: экспортируем обе функции из замыкания и зовём их через window.__zgFx.
import fs from "node:fs";
import path from "node:path";
import { ROOT, secret } from "./lib/config.mjs";
import { unwrapPortalKey, encryptBin, decryptBin } from "./lib/portal-crypto.mjs";

const hubPath = path.join(ROOT, "hub.html");
const weekBinPath = path.join(ROOT, "data", "week.bin");
const pass = secret("portal.pass", "PORTAL_PASS");

const hub = fs.readFileSync(hubPath, "utf8");
const { key: fileKey } = await unwrapPortalKey(hub, pass);

const ivMatch = hub.match(/"week":\{"iv":"([^"]+)","u":"([^"]+)"\}/);
if (!ivMatch) throw new Error("week iv missing");
let html = decryptBin(fileKey, fs.readFileSync(weekBinPath), ivMatch[1]);

const OLD = "roles(); mail();\n};\nwindow.__redraw = function () { roles(); mail(); };";
const NEW = "roles(); mail();\nwindow.__zgFx = { roles: roles, mail: mail };\n};\nwindow.__redraw = function () { window.__zgFx.roles(); window.__zgFx.mail(); };";
if (!html.includes(OLD)) throw new Error("паттерн не найден — week.bin уже пропатчен или версия страницы другая");
html = html.replace(OLD, NEW);

const sealed = encryptBin(fileKey, html);
const back = decryptBin(fileKey, sealed.ct, sealed.iv);
if (!back.includes("window.__zgFx")) throw new Error("roundtrip failed");
fs.writeFileSync(weekBinPath, sealed.ct);

const v = String(Number((ivMatch[2].match(/v=(\d+)/) || [])[1] || "5") + 1);
fs.writeFileSync(hubPath, hub.replace(ivMatch[0], `"week":{"iv":"${sealed.iv}","u":"${ivMatch[2].replace(/v=\d+/, "v=" + v)}"}`));
console.log("week.bin пропатчен, hub.html → v" + v);
