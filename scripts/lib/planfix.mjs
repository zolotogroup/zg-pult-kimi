// Клиент ПланФикса + загрузка сохранений отчётов + парсеры строк отчётов.
// Отчёты (см. HANDOFF): 426408 контракты, 426450 счета и суды, 426440 BD, 426432 часы,
// 426586 просрочки, 426592 правки, 426596 документы мастер-проектов, 426406 монтаж,
// 426582 просроченные этапы и мастер-проекты, 426590 (этапы по месяцам — EMPM).
export function makePlanfixClient(token) {
  async function pf(method, p, body) {
    const res = await fetch("https://zlt.planfix.ru/rest/" + p, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(method + " " + p + " " + res.status + " " + text.slice(0, 180));
    return JSON.parse(text);
  }
  return { pf };
}

export function unescape(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
export function iso(s) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(s || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
export function num(s) {
  const n = parseFloat(String(s ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2);
}
export function cleanDept(s) {
  return unescape(s).replace(/^\[|\]$/g, "").trim();
}
export function taskId(link) {
  return ((link || "").match(/\/task\/(\d+)/) || [])[1] || "";
}

// Берёт сохранение отчёта: самое свежее, либо самое свежее не позже beforeIso (YYYY-MM-DD HH:mm по Москве).
export async function loadReport(pf, id, { before = null } = {}) {
  const list = await pf("POST", `report/${id}/save/list`, {
    fields: "id,dateTime,chunksCount",
    offset: 0,
    pageSize: 20,
  });
  let saves = list.saves || [];
  if (before) {
    const cut = before.replace("T", " ");
    saves = saves.filter((s) => String(s.dateTime).slice(0, 16) <= cut);
  }
  const save = saves[0];
  if (!save) return { id, save: null, rows: [] };
  const chunks = Math.max(1, save.chunksCount || 1);
  const rows = [];
  for (let c = 0; c < chunks; c++) {
    const data = await pf("POST", `report/${id}/save/${save.id}/data`, { chunk: c });
    const part = data.data?.rows || [];
    if (c > 0 && data.data?.chunk !== c) break;
    for (const row of part) if (row.type === "Normal") rows.push(row.items.map((it) => ({ t: unescape(it.text), link: it.link || "" })));
  }
  return { id, save, rows };
}

// --- Парсеры конкретных отчётов (столбцы проверены на боевых данных) ---

export function buildOvmp(rep) {
  const items = [];
  for (const c of rep.rows) {
    const d = num(c[8]?.t);
    if (d == null) continue;
    items.push({
      no: taskId(c[2]?.link) || c[0]?.t || "",
      n: c[2]?.t || "",
      mp: c[3]?.t || "",
      rp: c[4]?.t || "—",
      st: c[5]?.t || "",
      due: iso(c[7]?.t),
      d: Math.round(d),
    });
  }
  const who = groupBy(items, "rp", "d").map(({ n, c, md }) => ({ n, c, md }));
  const top = who[0] || { n: "—", c: 0 };
  return {
    built: rep.save ? moscowStamp(rep.save.dateTime).built : "",
    items,
    who,
    kpi: {
      n: items.length,
      med: median(items.map((i) => i.d)),
      max: items.reduce((m, i) => Math.max(m, i.d), 0),
      year: items.filter((i) => i.d > 365).length,
      rp: who.filter((w) => w.n !== "—").length,
      topRp: top.n,
      topRpC: top.c,
    },
  };
}

export function buildOvdoc(rep) {
  const items = [];
  for (const c of rep.rows) {
    const d = num(c[9]?.t);
    if (d == null) continue;
    items.push({
      n: c[0]?.t || "",
      mp: c[2]?.t || "",
      e: c[3]?.t || "",
      who: c[4]?.t || "—",
      st: c[5]?.t || "",
      due: iso(c[7]?.t),
      d: Math.round(d),
      by: c[8]?.t || "",
    });
  }
  const who = groupBy(items, "who", "d");
  const ent = groupBy(items, "e", "d");
  return {
    built: rep.save ? moscowStamp(rep.save.dateTime).built : "",
    items,
    who,
    ent,
    kpi: {
      n: items.length,
      med: median(items.map((i) => i.d)),
      max: items.reduce((m, i) => Math.max(m, i.d), 0),
      m30: items.filter((i) => i.d > 30).length,
      who: who.filter((w) => w.n !== "—").length,
    },
  };
}

export function buildOvemp(rep) {
  const items = [];
  for (const c of rep.rows) {
    const d = num(c[9]?.t);
    if (d == null) continue;
    items.push({
      n: c[0]?.t || "",
      mp: c[2]?.t || "",
      who: c[3]?.t || "—",
      dept: cleanDept(c[4]?.t) || "—",
      st: c[5]?.t || "",
      due: iso(c[7]?.t),
      d: Math.round(d),
      by: c[8]?.t || "",
    });
  }
  const who = groupBy(items, "who", "d");
  const dept = groupBy(items, "dept", "d").filter((d) => d.n !== "—");
  return {
    built: rep.save ? moscowStamp(rep.save.dateTime).built : "",
    items,
    who,
    dept,
    kpi: {
      n: items.length,
      med: median(items.map((i) => i.d)),
      max: items.reduce((m, i) => Math.max(m, i.d), 0),
      m30: items.filter((i) => i.d > 30).length,
      who: who.filter((w) => w.n !== "—").length,
      dept: dept.length,
    },
  };
}

export function buildEmpm(rep) {
  const byMonth = new Map();
  for (const c of rep.rows) {
    const due = iso(c[16]?.t);
    if (!due) continue;
    const m = due.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push({
      who: c[10]?.t || "—",
      dept: cleanDept(c[11]?.t) || "—",
      late: (num(c[7]?.t) || 0) >= 1 ? 1 : 0,
      ok: (num(c[6]?.t) || 0) >= 1 ? 1 : 0,
      act: (num(c[3]?.t) || 0) >= 1 ? 1 : 0,
      due,
    });
  }
  const now = moscowParts(new Date());
  const cur = `${now.year}-${now.month}`;
  const months = [...byMonth.keys()].sort().map((m) => {
    const rows = byMonth.get(m);
    const people = new Map();
    const depts = new Map();
    for (const r of rows) {
      for (const [bag, key] of [[people, r.who], [depts, r.dept]]) {
        if (key === "—" && bag === depts) continue;
        if (!bag.has(key)) bag.set(key, { n: key, c: 0, late: 0, ok: 0, act: 0 });
        const g = bag.get(key);
        g.c++;
        g.late += r.late;
        g.ok += r.ok;
        g.act += r.act;
      }
    }
    const pack = (map) =>
      [...map.values()]
        .map((g) => ({ ...g, lp: g.c ? Math.round((g.late / g.c) * 1000) / 10 : 0 }))
        .sort((a, b) => b.late - a.late || b.c - a.c || a.n.localeCompare(b.n, "ru"));
    const late = rows.reduce((s, r) => s + r.late, 0);
    const ok = rows.reduce((s, r) => s + r.ok, 0);
    const days = rows.map((r) => +r.due.slice(8));
    return {
      m,
      full: m < cur && Math.min(...days) <= 3,
      from: rows.map((r) => r.due).sort()[0],
      n: rows.length,
      late,
      ok,
      lp: rows.length ? Math.round((late / rows.length) * 1000) / 10 : 0,
      who: pack(people),
      dept: pack(depts),
    };
  });
  return { built: rep.save ? moscowStamp(rep.save.dateTime).built : "", months, since: months[0]?.from || "", tasks: months.reduce((s, m) => s + m.n, 0) };
}

export function groupBy(items, key, dayKey) {
  const map = new Map();
  for (const it of items) {
    const n = it[key] || "—";
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(it[dayKey]);
  }
  return [...map.entries()]
    .map(([n, ds]) => ({ n, c: ds.length, md: median(ds), mx: Math.max(...ds) }))
    .sort((a, b) => b.c - b.c || a.n.localeCompare(b.n, "ru"));
}

export function moscowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return parts;
}

export function moscowStamp(dateTime) {
  const d = new Date(String(dateTime).endsWith("Z") ? dateTime : dateTime + "Z");
  const p = moscowParts(d);
  return { fresh: `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`, built: `${p.day}.${p.month}.${p.year}`, iso: `${p.year}-${p.month}-${p.day}` };
}
