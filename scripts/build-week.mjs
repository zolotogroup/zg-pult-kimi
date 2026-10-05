// Сборка недели: тянет деньги ПланФакта и срезы ПланФикса за минувшую неделю,
// перепечатывает week.bin с новыми слотами ролей, готовит 10 писем и manifest для рассылки.
//
// Локально:  node scripts/build-week.mjs            (сборка за текущую минувшую неделю)
//            WEEK_FORCE=2026-10-05,2026-10-09 node scripts/build-week.mjs  (явное окно)
//            WITH_PDF=1 — дополнительно собрать PDF во вложения (нужен playwright)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, secret, secretOr, weekRoles } from "./lib/config.mjs";
import { unwrapPortalKey, encryptBin, decryptBin, readConst, sealSlot, ub, b64 } from "./lib/portal-crypto.mjs";
import { makePlanfixClient, loadReport, buildOvmp, buildOvdoc, buildOvemp, buildEmpm, moscowStamp } from "./lib/planfix.mjs";
import { fetchOperations, summarizeWeek, rub } from "./lib/planfact.mjs";
import { weekWindow, fmtRange } from "./lib/weekcalc.mjs";

// --- Роли и получатели ---
const WHO = {
  share: ["Акционеры", "kk@zolotogroup.ru"],
  gd: ["Генеральный директор", "la@zolotogroup.ru"],
  zam: ["Заместитель генерального директора", "as@zolotogroup.ru"],
  pd: ["Директор проектного департамента", "pg@zolotogroup.ru"],
  tech: ["Технический директор", "ib@zolotogroup.ru"],
  art: ["Арт-директор", "md@zolotogroup.ru"],
  an: ["Директор аналитического отдела", "em@zolotogroup.ru"],
  exec: ["Исполнительный директор", "vp@zolotogroup.ru"],
  law: ["Юрист", "msan@zolotogroup.ru"],
  hr: ["Менеджер по корпоративной культуре", "lgr@zolotogroup.ru"],
};
const ORDER = ["share", "gd", "zam", "pd", "tech", "art", "an", "exec", "law", "hr"];
const REPORT_ROLES = { 426592: ["gd", "zam", "art", "an", "pd"] }; // правки — только этим ролям

const rolePw = weekRoles();
const pass = secret("portal.pass", "PORTAL_PASS");
const basePass = secretOr("week-base.pass", "WEEK_BASE_PASS", "881204"); // пароль архива недель
const portalUrl = (secretOr("portal.url", "PORTAL_URL", "https://EXAMPLE.github.io/zg-pult")).replace(/\/$/, "");

// --- Окно недели ---
let W;
if (process.env.WEEK_FORCE) {
  const [w0, w1] = process.env.WEEK_FORCE.split(",");
  const { isoWeekNumber } = await import("./lib/weekcalc.mjs");
  W = { w0, w1, weekN: isoWeekNumber(w0), saturdayIncluded: w1 > isoFriday(w0), cutoff: isoFriday(w0) + "T19:00" };
} else {
  let sat = [];
  try { sat = JSON.parse(secretOr("working-saturdays.json", "WORKING_SATURDAYS_JSON", "[]")); } catch {}
  W = weekWindow(new Date(), { workingSaturdays: sat });
}
function isoFriday(w0) { const d = new Date(w0 + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 4); return d.toISOString().slice(0, 10); }

const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
function humanDate(s) { return `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}`; }
function humanRange(w0, w1) {
  if (w0.slice(5, 7) === w1.slice(5, 7)) return `${+w0.slice(8, 10)} – ${+w1.slice(8, 10)} ${MONTHS[+w1.slice(5, 7) - 1]}`;
  return `${humanDate(w0)} – ${humanDate(w1)}`;
}
const range = fmtRange(W.w0, W.w1);
const rangeHuman = humanRange(W.w0, W.w1);
console.log("Окно недели:", JSON.stringify(W));
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// --- Деньги недели (ПланФакт) ---
const fa = secret("planfact.token", "PLANFACT_TOKEN");
const opsAll = await fetchOperations(fa, W.w0, W.w1);
const wk = summarizeWeek(opsAll, W.w0, W.w1);
const IN = wk.IN, OUT = wk.OUT, diff = IN - OUT;
const top = wk.inn[0];
const note = `ПланФакт, даты операций ${range}. Операций в выписке ${wk.all}, исключено технических ${wk.skip}.` + (W.saturdayIncluded ? "" : " Суббота не включена.");
const weekLine = `За ${range} в ПланФакте ${wk.inn.length} поступлений на ${rub(IN)} и ${wk.out.length} выплат на ${rub(OUT)}. Разница ${diff >= 0 ? "плюс" : "минус"} ${rub(diff)}. Крупнейшее поступление — ${top ? rub(top.v) + " от " + top.d + ": " + top.comment : "нет"}.`;

// --- ПланФикс: срезы на пятницу 19:00 ---
const PULT_IDS = (process.env.REPORT_IDS || "426582,426580,426586,426590").split(",").map((s) => s.trim());
const LETTER_EXTRA = (process.env.LETTER_EXTRA_IDS || "426592:Правки").split(",").map((s) => s.trim()).filter(Boolean);
let pultData = null;
const pfClient = secretOr("planfix.token", "PLANFIX_TOKEN", "");
if (pfClient) {
  const pf = makePlanfixClient(pfClient).pf;
  const load = async (id) => loadReport(pf, id, { before: W.cutoff.replace("T", " ") });
  const reps = {};
  for (const id of [...PULT_IDS, ...LETTER_EXTRA.map((s) => s.split(":")[0])]) reps[id] = await load(id);
  pultData = {
    pf,
    reps,
    ovmp: buildOvmp(reps[PULT_IDS[0]]),
    ovdoc: buildOvdoc(reps[PULT_IDS[1]]),
    ovemp: buildOvemp(reps[PULT_IDS[2]]),
    empm: buildEmpm(reps[PULT_IDS[3]]),
  };
} else {
  console.log("PLANFIX_TOKEN не задан — блоки ПланФикса в письмах будут без среза.");
}

// Строка отчёта для письма: либо данные, либо честное «нет среза».
function repLine(title, b, fmt) {
  if (!b?.built) return { l: title, v: "нет среза", n: `Нет сохранения отчёта до ${W.cutoff.replace("T", " ")} МСК. Цифры не выдумываем.`, s: "" };
  return { l: title, v: fmt(b), n: `Срез ${b.built}`, s: "" };
}

function letter(key) {
  const [who] = WHO[key];
  const blocks = [];
  blocks.push({ t: "Деньги недели", items: [
    { l: "Поступило", v: rub(IN), n: `${wk.inn.length} операций · ${note}`, x: wk.inn.slice(0, 8).map((r) => ({ t: r.comment || "Операция", v: rub(r.v), s: r.d })) },
    { l: "Выплачено", v: rub(OUT), n: `${wk.out.length} операций · ${note}`, x: wk.out.slice(0, 8).map((r) => ({ t: r.comment || "Операция", v: rub(r.v), s: r.d })) },
    { l: "Разница", v: (diff >= 0 ? "+" : "−") + rub(diff), n: "поступления минус выплаты, после исключений", s: diff >= 0 ? "" : "bad" },
  ]});
  if (pultData) {
    const { ovmp, ovdoc, ovemp, empm } = pultData;
    const items = [
      repLine("Просроченные этапы и МП", ovmp, (b) => `${b.kpi.n} позиций, медиана ${b.kpi.med} дн.`),
      repLine("Просроченные документы", ovdoc, (b) => `${b.kpi.n} документов, ${b.kpi.m30} просрочены >30 дн.`),
      repLine("Просроченные сотрудники", ovemp, (b) => `${b.kpi.n} задач у людей, медиана ${b.kpi.med} дн.`),
      repLine("Этапы по месяцам", empm, (b) => `${b.tasks} этапов с ${b.since}, текущий месяц ${b.months.at(-1)?.lp ?? "—"}% опозданий`),
    ];
    for (const spec of LETTER_EXTRA) {
      const [id, title] = spec.split(":");
      const rep = pultData.reps[id];
      const roles = REPORT_ROLES[id];
      if (roles && !roles.includes(key)) continue; // раздел не для этой роли
      if (!rep?.save) { items.push({ l: title || id, v: "нет среза", n: `Нет сохранения до ${W.cutoff.replace("T", " ")} МСК.`, s: "" }); continue; }
      const first = rep.rows.slice(0, 5).map((r) => (r[0]?.t || "").slice(0, 60)).filter(Boolean).join(" · ");
      items.push({ l: title || id, v: `${rep.rows.length} строк`, n: first ? `Топ: ${first}` : `Срез ${rep.save.dateTime}`, s: "" });
    }
    blocks.push({ t: "Отчёты ПланФикса", items });
  }
  return {
    who, ch: "письмо · понедельник 9:00", tab: "Сводка",
    subj: key === "share" ? `ЗОЛОТОГРУПП • ${W.weekN} неделя • ${rangeHuman}` : `${who} • ${W.weekN} неделя • ${range}`,
    lead: key === "share" ? `Деньги закрытой недели, ${range}.` : `Сводка для роли «${who}». Цифры те же, что у акционеров: закрытая неделя ${range}.`,
    fire: [], detail: [],
    ins: { week: weekLine, trend: note },
    blocks,
  };
}
const rolesNew = Object.fromEntries(ORDER.map((k) => [k, letter(k)]));

// --- Перепечатка week.bin ---
const hubPath = path.join(ROOT, "hub.html");
const weekBinPath = path.join(ROOT, "data", "week.bin");
const hub = fs.readFileSync(hubPath, "utf8");
const { key: fileKey, ENC } = await unwrapPortalKey(hub, pass);

const ivMatch = hub.match(/"week":\{"iv":"([^"]+)","u":"([^"]+)"\}/);
if (!ivMatch) throw new Error("week iv missing");
let html = decryptBin(fileKey, fs.readFileSync(weekBinPath), ivMatch[1]);
const dm = html.match(/<script type="application\/json" id="DG">([\s\S]*?)<\/script>/);
if (!dm) throw new Error("DG not found");
const raw = JSON.parse(dm[1]);

// Расшифровка текущих ролей (становятся архивом prev).
// Слот «всех ключей» может быть запечатан под паролем архива, GD или мастер-паролем — пробуем все известные.
const web = crypto.webcrypto;
const dec = new TextDecoder();
const { kekOf } = await import("./lib/portal-crypto.mjs");
const candidates = [basePass, ...Object.values(rolePw), pass];
let curKeys = null, adminPw = null;
for (const pw of candidates) {
  const kek = await kekOf(pw, raw.salt, raw.it);
  for (const sl of raw.slots || []) {
    try {
      const p = JSON.parse(dec.decode(await web.subtle.decrypt({ name: "AES-GCM", iv: ub(sl.iv) }, kek, ub(sl.ct))));
      if (p.keys && Object.keys(p.keys).length > 1) { curKeys = p.keys; adminPw = pw; break; }
    } catch {}
  }
  if (curKeys) break;
}
if (!curKeys) throw new Error("Ключи ролей не расшифровались ни одним известным паролем");
console.log("Архив недели расшифрован, админ-слот под паролем роли:", adminPw);

const prevPlain = {};
for (const [k, kb] of Object.entries(curKeys)) {
  if (!raw.roles?.[k]) continue;
  const rk = await web.subtle.importKey("raw", ub(kb), "AES-GCM", false, ["decrypt"]);
  prevPlain[k] = JSON.parse(dec.decode(await web.subtle.decrypt({ name: "AES-GCM", iv: ub(raw.roles[k].iv) }, rk, ub(raw.roles[k].ct))));
}

const keys = {};
for (const k of ORDER) keys[k] = web.getRandomValues(new Uint8Array(32));
async function sealBag(obj) {
  const out = {};
  for (const [k, data] of Object.entries(obj)) {
    const rk = await web.subtle.importKey("raw", keys[k], "AES-GCM", false, ["encrypt"]);
    const iv = web.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await web.subtle.encrypt({ name: "AES-GCM", iv }, rk, new TextEncoder().encode(JSON.stringify(data))));
    out[k] = { iv: b64(iv), ct: b64(ct) };
  }
  return out;
}

raw.roles = await sealBag(rolesNew);
raw.prev = { week: raw.week, sub: raw.sub, roles: await sealBag(prevPlain) };
raw.week = [W.w0, W.w1];
raw.sub = `${W.weekN} неделя, ${range}. Деньги ПланФакт за закрытую неделю. Страница открывается только паролем этой роли.`;

// Слоты: базовый (все ключи) + по слоту на роль
raw.slots = [];
raw.slots.push(await sealSlot(basePass, raw.salt, raw.it, { keys: Object.fromEntries(ORDER.map((k) => [k, b64(keys[k])])), m: false }));
for (const k of ORDER) {
  raw.slots.push(await sealSlot(rolePw[k], raw.salt, raw.it, { keys: { [k]: b64(keys[k]) }, m: false }));
}
html = html.replace(dm[0], `<script type="application/json" id="DG">${JSON.stringify(raw)}</script>`);

// Видимые даты в week.html
const satNote = W.saturdayIncluded ? "Суббота рабочая, вошла в окно." : "Суббота не входит.";
html = html.replace(/Собрано в субботу [^.]*\./, `Собрано в субботу после закрытия недели. Окно данных: понедельник–${W.saturdayIncluded ? "суббота" : "пятница"} ${range}. ${satNote}`);
html = html.replace(/"cur":\s*"[^"]+"/, `"cur": "${W.w0}"`);
html = html.replace(/\{"w0":\s*"[^"]+",\s*"w1":\s*"[^"]+",\s*"n":\s*\d+\}/, `{"w0": "${W.w0}", "w1": "${W.w1}", "n": ${W.weekN}}`);

const sealed = encryptBin(fileKey, html);
const back = decryptBin(fileKey, sealed.ct, sealed.iv);
if (!back.includes(String(W.weekN))) throw new Error("roundtrip failed");
fs.writeFileSync(weekBinPath, sealed.ct);

const v = String(Number((ivMatch[2].match(/v=(\d+)/) || [])[1] || "5") + 1);
fs.writeFileSync(hubPath, hub.replace(ivMatch[0], `"week":{"iv":"${sealed.iv}","u":"${ivMatch[2].replace(/v=\d+/, "v=" + v)}"}`));

// ENC.w: недельный уровень для ролей, у которых нет полного доступа (share=Polina1303, gd=Zxcv1357 уже есть)
let hubOut = fs.readFileSync(hubPath, "utf8");
const encLoc2 = readConst(hubOut, "ENC");
const ENCH = encLoc2.obj; // свежий, с уже поднятой версией week
const knownPw = [pass, ...Object.values(rolePw)];
const opens = new Set();
for (const pw of knownPw) {
  const kek = await kekOf(pw, ENCH.s, ENCH.n);
  for (const sl of ENCH.w) {
    try { JSON.parse(dec.decode(await web.subtle.decrypt({ name: "AES-GCM", iv: ub(sl.iv) }, kek, ub(sl.ct)))); opens.add(pw); break; } catch {}
  }
}
for (const k of ORDER.filter((k) => !["share", "gd"].includes(k))) {
  if (opens.has(rolePw[k])) continue;
  ENCH.w.push(await sealSlot(rolePw[k], ENCH.s, ENCH.n, { k: b64(fileKey), l: "week" }));
}
hubOut = hubOut.slice(0, encLoc2.start) + JSON.stringify(ENCH) + hubOut.slice(encLoc2.end);
fs.writeFileSync(hubPath, hubOut);

// --- Письма ---
const lettersDir = path.join(ROOT, "artifacts", "letters");
fs.mkdirSync(lettersDir, { recursive: true });
const fontsRel = path.relative(lettersDir, path.join(ROOT, "fonts")).split(path.sep).join("/");

function mailHtml(key) {
  const r = rolesNew[key];
  const url = `${portalUrl}/hub.html#week/${key}`;
  const row = (l, v, n) => `<tr><td style="padding:11px 12px 0 0;font-family:'Stratos','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.3;color:#1d1d1b">${esc(l)}</td><td align="right" style="padding:9px 0 0;white-space:nowrap;font-family:'Zoloto Display','Arial Black',Helvetica,Arial,sans-serif;font-size:19px;line-height:1.1;color:#1d1d1b">${esc(v)}</td><td align="right" width="18" style="padding:11px 0 0 6px"><a href="${url}" style="color:#6f6f6a;text-decoration:none;font-family:'Aeroport Mono',Menlo,Consolas,monospace;font-size:14px">&rsaquo;</a></td></tr><tr><td colspan="3" style="padding:3px 0 11px;border-bottom:1px solid #d9d9d4;font-family:'Stratos',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.45;color:#6f6f6a">${esc(n)}</td></tr>`;
  const sections = r.blocks.map((b) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr><td width="6" bgcolor="#b7cd00">&nbsp;</td><td bgcolor="#1d1d1b" style="background:#1d1d1b;padding:10px 14px;font-family:'Zoloto Display','Arial Black',Helvetica,Arial,sans-serif;font-size:15px;letter-spacing:.03em;text-transform:uppercase;color:#fff">${esc(b.t)}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${b.items.map((it) => row(it.l, it.v, it.n)).join("")}</table>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(r.subj)}</title>
<style>
@font-face{font-family:"Zoloto Display";src:url("${fontsRel}/ZolotoDisplay.woff2") format("woff2");font-weight:400}
@font-face{font-family:Stratos;src:url("${fontsRel}/Stratos-Regular.woff2") format("woff2");font-weight:400}
@font-face{font-family:"Aeroport Mono";src:url("${fontsRel}/Aeroport-Mono.woff2") format("woff2");font-weight:400}
</style></head>
<body style="margin:0;padding:0" bgcolor="#f3f3f1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f3f1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#fff;border:1px solid #1d1d1b">
<tr><td style="padding:22px 26px 18px;border-bottom:1px solid #1d1d1b">
<div style="font-family:'Aeroport Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#1d1d1b;border-bottom:3px solid #b7cd00;display:inline-block;padding-bottom:7px">ЗОЛОТОГРУПП · Еженедельная рассылка</div>
<div style="font-family:'Zoloto Display','Arial Black',Helvetica,Arial,sans-serif;font-size:22px;line-height:1.25;color:#1d1d1b;margin-top:14px">ЗОЛОТОГРУПП • ${W.weekN} неделя • ${rangeHuman}</div>
<div style="margin-top:8px"><span style="font-family:'Aeroport Mono',Menlo,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6f6f6a">Кому</span>&nbsp;&nbsp;<span style="font-family:Stratos,Helvetica,Arial,sans-serif;font-size:14px;color:#1d1d1b">${esc(r.who)}</span></div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px"><tr><td bgcolor="#b7cd00" style="background:#b7cd00;border:1px solid #1d1d1b"><a href="${url}" style="display:inline-block;padding:12px 18px;font-family:Stratos,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#1d1d1b;text-decoration:none">Открыть свою страницу &rarr;</a></td></tr></table>
<div style="font-family:Stratos,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.45;color:#6f6f6a;margin-top:8px">Ссылка открывает только вашу страницу. Чужой пароль её не откроет.</div>
</td></tr>
<tr><td style="padding:20px 26px 26px">
<div style="font-family:Stratos,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1b">${esc(r.lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px"><tr><td width="4" bgcolor="#b7cd00">&nbsp;</td><td bgcolor="#ecefd6" style="background:#ecefd6;padding:16px 18px">
<div style="font-family:'Zoloto Display','Arial Black',Helvetica,Arial,sans-serif;font-size:16px;letter-spacing:.03em;text-transform:uppercase;color:#1d1d1b;margin-bottom:8px">Вывод</div>
<span style="font-family:'Aeroport Mono',Menlo,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6f6f6a">Эта неделя</span>
<div style="font-family:Stratos,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1d1d1b;margin:2px 0 10px">${esc(weekLine)}</div>
<span style="font-family:'Aeroport Mono',Menlo,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6f6f6a">Как читать</span>
<div style="font-family:Stratos,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1d1d1b;margin-top:2px">${esc(note)}</div>
</td></tr></table>
${sections}
<div style="margin-top:14px;padding:10px 12px;background:#ecefd6;font-family:Stratos,Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.45;color:#6f6f6a"><b style="color:#1d1d1b">Откуда данные:</b> ${esc(note)}</div>
</td></tr></table></td></tr></table></body></html>`;
}

for (const k of ORDER) fs.writeFileSync(path.join(lettersDir, `mail_${k}.html`), mailHtml(k));

let pdfs = {};
if (process.env.WITH_PDF === "1") {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });
    for (const k of ORDER) {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(lettersDir, `mail_${k}.html`), { waitUntil: "load" });
      await page.pdf({ path: path.join(lettersDir, `ZG_DSN_CORP_MGMT_weekly-digest-${k}.pdf`), format: "A4", printBackground: true });
      await page.close();
    }
    await browser.close();
    pdfs = Object.fromEntries(ORDER.map((k) => [k, `ZG_DSN_CORP_MGMT_weekly-digest-${k}.pdf`]));
  } catch (e) {
    console.log("PDF не собраны (playwright недоступен?), письма уйдут без вложений:", e.message);
  }
}

const manifest = {
  week: `${W.weekN} неделя · ${rangeHuman}`,
  w0: W.w0, w1: W.w1,
  close: "пятница 19:00 Europe/Moscow" + (W.saturdayIncluded ? "; суббота рабочая, вошла" : "; суббота не входит"),
  saturday_included: W.saturdayIncluded,
  mode: process.env.SEND_MODE || "draft",
  items: ORDER.map((k) => ({
    role: k,
    subject: rolesNew[k].subj,
    to: [WHO[k][1]],
    html: `mail_${k}.html`,
    pdf: pdfs[k] || null,
    page: `${portalUrl}/hub.html#week/${k}`,
  })),
};
fs.writeFileSync(path.join(lettersDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("Собрано:", manifest.week, "| писем:", ORDER.length, "| PDF:", Object.keys(pdfs).length, "| bin v" + v);
