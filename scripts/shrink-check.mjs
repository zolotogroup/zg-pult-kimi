// Проверка веса портала перед публикацией (GitHub Pages любит лёгкие репозитории).
// Отчуждаемые папки сайта: корень (hub.html, *.png, *.jpg, *.ico, *.svg), data, fonts, brand, __grok.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/config.mjs";

const LIMIT = Number(process.env.SIZE_LIMIT_MB || 20);
const roots = ["data", "fonts", "brand", "__grok"];
let total = 0;
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  total += st.size;
};
for (const r of roots) walk(path.join(ROOT, r));
for (const f of fs.readdirSync(ROOT)) {
  if (/\.(html|png|jpg|jpeg|ico|svg|json)$/.test(f) && fs.statSync(path.join(ROOT, f)).isFile()) {
    total += fs.statSync(path.join(ROOT, f)).size;
  }
}
const mb = total / 1024 / 1024;
console.log(`Вес сайта: ${mb.toFixed(1)} МБ (лимит ${LIMIT} МБ)`);
if (mb > LIMIT) { console.error("Перебор: ужмите данные или шрифты."); process.exit(1); }
