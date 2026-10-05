// Обновляет вкладку «Просрочки» пульта из сохранений отчётов ПланФикса и перепечатывает pult.bin.
// Локально:  node scripts/refresh-pult.mjs
// В Actions: запускается по расписанию вс/чт 23:30 МСК, затем workflow коммитит pult.bin и hub.html.
import fs from "node:fs";
import path from "node:path";
import { ROOT, secret } from "./lib/config.mjs";
import { unwrapPortalKey, encryptBin, decryptBin, putJson } from "./lib/portal-crypto.mjs";
import { makePlanfixClient, loadReport, buildOvmp, buildOvdoc, buildOvemp, buildEmpm, moscowStamp } from "./lib/planfix.mjs";

const REPORT_IDS = (process.env.REPORT_IDS || "426582,426580,426586,426590").split(",").map((s) => s.trim());
const hubPath = path.join(ROOT, "hub.html");
const binPath = path.join(ROOT, "data", "pult.bin");

const pf = makePlanfixClient(secret("planfix.token", "PLANFIX_TOKEN")).pf;
const pass = secret("portal.pass", "PORTAL_PASS");

const reports = {};
for (const id of REPORT_IDS) reports[id] = await loadReport(pf, id);

const ovmp = buildOvmp(reports[REPORT_IDS[0]]);
const ovdoc = buildOvdoc(reports[REPORT_IDS[1]]);
const ovemp = buildOvemp(reports[REPORT_IDS[2]]);
const empm = buildEmpm(reports[REPORT_IDS[3]]);

const hub = fs.readFileSync(hubPath, "utf8");
const { key } = await unwrapPortalKey(hub, pass);
const ivMatch = hub.match(/"pult":\{"iv":"([^"]+)","u":"([^"]+)"\}/);
if (!ivMatch) throw new Error("pult iv missing");
let html = decryptBin(key, fs.readFileSync(binPath), ivMatch[1]);

const fresh = JSON.parse((html.match(/<script type="application\/json" id="FRESH">([\s\S]*?)<\/script>/) || [])[1] || "{}");
for (const id of Object.keys(reports)) {
  if (reports[id].save) fresh[id] = moscowStamp(reports[id].save.dateTime).fresh;
}
html = putJson(html, "FRESH", fresh);
html = putJson(html, "OVMP", ovmp);
html = putJson(html, "OVDOC", ovdoc);
html = putJson(html, "OVEMP", ovemp);
html = putJson(html, "EMPM", empm);
for (const id of ["OVMP", "OVDOC", "OVEMP", "EMPM", "FRESH"]) {
  JSON.parse(html.match(new RegExp(`id="${id}">([\\s\\S]*?)</script>`))[1]);
}

const sealed = encryptBin(key, html);
const back = decryptBin(key, sealed.ct, sealed.iv);
if (!back.includes(ovmp.built)) throw new Error("roundtrip failed");
fs.writeFileSync(binPath, sealed.ct);

const v = ((ivMatch[2].match(/v=(\d+)/) || [])[1] || "4");
const next = String(Number(v) + 1);
let hubOut = hub.replace(ivMatch[0], `"pult":{"iv":"${sealed.iv}","u":"${ivMatch[2].replace(/v=\d+/, "v=" + next)}"}`);
const when = reports[REPORT_IDS[0]].save ? moscowStamp(reports[REPORT_IDS[0]].save.dateTime) : null;
if (when) hubOut = hubOut.replace(/pult:'Пульт ПланФикса · обновлён [^']+'/, `pult:'Пульт ПланФикса · обновлён ${when.built.slice(0, 5)}, ${when.fresh.slice(-5)}'`);
fs.writeFileSync(hubPath, hubOut);

const summary = {
  ovmp: ovmp.kpi,
  ovdoc: ovdoc.kpi,
  ovemp: { n: ovemp.kpi.n, med: ovemp.kpi.med, max: ovemp.kpi.max },
  empm: empm.months.map((m) => ({ m: m.m, n: m.n, late: m.late, ok: m.ok })),
  fresh,
  bin: next,
};
console.log(JSON.stringify(summary, null, 2));
