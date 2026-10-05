// Отправка писем недели через Google Apps Script (см. gas/mailer.gs).
// Читает artifacts/letters (manifest.json + mail_*.html [+ PDF]) и шлёт их POST-ами в GAS.
//   node scripts/send-letters.mjs          — отправить
//   node scripts/send-letters.mjs --dry    — показать, что ушло бы, не отправляя
import fs from "node:fs";
import path from "node:path";
import { ROOT, secretOr } from "./lib/config.mjs";

const dry = process.argv.includes("--dry");
const dir = path.join(ROOT, "artifacts", "letters");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const gasUrl = secretOr("gas.url", "GAS_URL", "");
const gasToken = secretOr("gas.token", "GAS_TOKEN", "");
if (!dry && (!gasUrl || !gasToken)) throw new Error("Задайте GAS_URL и GAS_TOKEN (секреты Apps Script)");

console.log(`Рассылка: ${manifest.week}, писем: ${manifest.items.length}${dry ? " (сухой прогон)" : ""}`);

const results = [];
for (const item of manifest.items) {
  const body = {
    token: gasToken,
    items: [{
      to: item.to[0],
      subject: item.subject,
      html: fs.readFileSync(path.join(dir, item.html), "utf8"),
      ...(item.pdf && fs.existsSync(path.join(dir, item.pdf))
        ? { pdfB64: fs.readFileSync(path.join(dir, item.pdf)).toString("base64"), pdfName: item.pdf }
        : {}),
    }],
  };
  if (dry) {
    results.push({ to: item.to[0], subject: item.subject, dry: true });
    continue;
  }
  const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  results.push({ to: item.to[0], ok: out.ok, ...(out.failed?.length ? { failed: out.failed } : {}) });
  if (!out.ok) console.error("Ошибка отправки:", item.to, JSON.stringify(out).slice(0, 300));
}
fs.writeFileSync(path.join(dir, "send-log.json"), JSON.stringify({ at: new Date().toISOString(), dry, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
if (!dry && results.some((r) => r.ok === false)) process.exit(1);
