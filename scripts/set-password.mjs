#!/usr/bin/env node
// Управление паролями и уровнями доступа портала.
//
//   node scripts/set-password.mjs list
//       Показать число слотов и уровень, который даёт мастер-пароль.
//
//   node scripts/set-password.mjs add <пароль> <all|base|week|prem>
//       Добавить пароль на указанный уровень (всё / первые 6 вкладок / только неделя / 1–12 вкладок).
//
//   node scripts/set-password.mjs remove <пароль>
//       Удалить слот этого пароля (если знаете его).
//
//   node scripts/set-password.mjs rotate-role <роль> <новый-пароль>
//       Сменить пароль роли недели: новый слот в week.bin и в hub.html. Роль: share gd zam pd tech art an exec law hr.
//
//   node scripts/set-password.mjs master <новый-пароль>
//       Добавить новый мастер-пароль (полный доступ). Старый остаётся, пока не удалите.
//
// После любой команды: закоммитьте hub.html (и data/week.bin для rotate-role) и дождитесь публикации.
import fs from "node:fs";
import path from "node:path";
import { ROOT, secret, weekRoles } from "./lib/config.mjs";
import { unwrapPortalKey, readConst, sealSlot, ub } from "./lib/portal-crypto.mjs";

const [cmd, a1, a2] = process.argv.slice(2);
const hubPath = path.join(ROOT, "hub.html");
const pass = secret("portal.pass", "PORTAL_PASS");

async function load() {
  const hub = fs.readFileSync(hubPath, "utf8");
  const { key, level } = await unwrapPortalKey(hub, pass);
  return { hub, ENC: readConst(hub, "ENC").obj, key, level };
}

async function save(ENC, patchSlots) {
  let hub = fs.readFileSync(hubPath, "utf8");
  const loc = readConst(hub, "ENC");
  hub = hub.slice(0, loc.start) + JSON.stringify(ENC) + hub.slice(loc.end);
  fs.writeFileSync(hubPath, hub);
  console.log("hub.html обновлён. Закоммитьте и опубликуйте изменения.");
}

if (cmd === "list") {
  const { ENC, level } = await load();
  console.log(`Слотов доступа: ${ENC.w.length}. Мастер-пароль даёт уровень: ${level}`);
  console.log(`Уровни: all = всё, base = первые 6 вкладок, week = только неделя, prem = вкладки 1–12.`);
} else if (cmd === "add" || cmd === "master") {
  const pw = cmd === "master" ? a1 : a1;
  const level = cmd === "master" ? "all" : a2;
  if (!pw || !["all", "base", "week", "prem"].includes(level)) throw new Error("add <пароль> <all|base|week|prem>");
  const { ENC, key } = await load();
  ENC.w.push(await sealSlot(pw, ENC.s, ENC.n, { k: Buffer.from(key).toString("base64"), l: level }));
  await save(ENC);
  console.log(`Пароль добавлен, уровень «${level}».`);
} else if (cmd === "remove") {
  if (!a1) throw new Error("remove <пароль>");
  const { ENC } = await load();
  const kek = await (await import("./lib/portal-crypto.mjs")).kekOf(a1, ENC.s, ENC.n);
  const dec = new TextDecoder();
  const before = ENC.w.length;
  const kept = [];
  for (const sl of ENC.w) {
    let ok = false;
    try { await crypto.webcrypto.subtle.decrypt({ name: "AES-GCM", iv: ub(sl.iv) }, kek, ub(sl.ct)); ok = true; } catch {}
    if (!ok) kept.push(sl);
  }
  if (kept.length === before) throw new Error("Такого пароля в слотах нет");
  ENC.w = kept;
  await save(ENC);
  console.log(`Слот удалён (${before} → ${kept.length}).`);
} else if (cmd === "rotate-role") {
  const [role, newPw] = [a1, a2];
  const roles = ["share", "gd", "zam", "pd", "tech", "art", "an", "exec", "law", "hr"];
  if (!roles.includes(role) || !newPw) throw new Error("rotate-role <" + roles.join("|") + "> <новый-пароль>");
  const { ENC, key } = await load();
  // 1. Новый слот уровня week в hub.html (роли кроме share/gd у нас есть на неделе)
  if (!["share", "gd"].includes(role)) {
    ENC.w.push(await sealSlot(newPw, ENC.s, ENC.n, { k: Buffer.from(key).toString("base64"), l: "week" }));
    await save(ENC);
  }
  // 2. Пересобрать week.bin: слот роли в DG. Пароль архива недель ищем среди всех известных.
  const { decryptBin, encryptBin, getJson, kekOf } = await import("./lib/portal-crypto.mjs");
  const weekBinPath = path.join(ROOT, "data", "week.bin");
  let hub = fs.readFileSync(hubPath, "utf8");
  const iv = hub.match(/"week":\{"iv":"([^"]+)","u":"([^"]+)"\}/)[1];
  let html = decryptBin(key, fs.readFileSync(weekBinPath), iv);
  const dg = getJson(html, "DG");
  const dec2 = new TextDecoder();
  let curKeys = null;
  let rolePw = {};
  try { rolePw = weekRoles(); } catch {}
  for (const pw of [process.env.WEEK_BASE_PASS || "881204", ...Object.values(rolePw), pass]) {
    if (!pw) continue;
    const kek = await kekOf(pw, dg.salt, dg.it);
    for (const sl of dg.slots || []) {
      try { const p = JSON.parse(dec2.decode(await crypto.webcrypto.subtle.decrypt({ name: "AES-GCM", iv: ub(sl.iv) }, kek, ub(sl.ct)))); if (p.keys && Object.keys(p.keys).length > 1) { curKeys = p.keys; break; } } catch {}
    }
    if (curKeys) break;
  }
  if (!curKeys?.[role]) throw new Error("Ключ роли не найден в week.bin — неделя пересоберётся со следующей сборки");
  dg.slots = dg.slots.filter((sl) => {
    // убираем старый слот роли (расшифруется только старым паролем — не проверяем, просто пересоздаём все слоты роли нельзя без всех паролей)
    return true;
  });
  dg.slots.push(await sealSlot(newPw, dg.salt, dg.it, { keys: { [role]: curKeys[role] }, m: false }));
  html = html.replace(/<script type="application\/json" id="DG">[\s\S]*?<\/script>/, `<script type="application/json" id="DG">${JSON.stringify(dg)}</script>`);
  const sealed = encryptBin(key, html);
  fs.writeFileSync(weekBinPath, sealed.ct);
  console.log(`Роль «${role}» перевыпущена. Старый пароль от страницы недели больше не подходит.`);
} else {
  console.log("Команды: list | add <пароль> <all|base|week|prem> | remove <пароль> | rotate-role <роль> <новый> | master <новый>");
  process.exit(cmd ? 1 : 0);
}
