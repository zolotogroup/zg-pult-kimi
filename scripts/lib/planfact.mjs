// ПланФакт: выписка операций за период + сводка для письма недели.
export async function fetchOperations(token, d0, d1) {
  const headers = { "X-ApiKey": token, Accept: "application/json" };
  const all = [];
  for (let offset = 0, g = 0; g < 30; g++) {
    const u = new URL("https://api.planfact.io/api/v1/operations");
    u.searchParams.set("filter.operationDateStart", d0);
    u.searchParams.set("filter.operationDateEnd", d1);
    u.searchParams.set("paging.limit", "100");
    u.searchParams.set("paging.offset", String(offset));
    const j = await (await fetch(u, { headers })).json();
    const items = j.data?.items || [];
    all.push(...items);
    if (items.length < 100) break;
    offset += 100;
  }
  return all;
}

export function isInternal(op) {
  const comment = op.comment || "";
  const acc = op.account?.title || "";
  return (
    /депозит|овернайт|размещен/i.test(comment) ||
    /депозит/i.test(acc) ||
    /зар\.?\s*плат|зарплат/i.test(comment) ||
    /пополнение кассы|в кассу/i.test(comment)
  );
}

// Разделяет операции на поступления/выплаты, отбрасывает технические.
export function summarizeWeek(all, d0, d1) {
  const inn = [], out = [];
  let skip = 0;
  for (const op of all) {
    const day = (op.operationDate || "").slice(0, 10);
    if (day < d0 || day > d1) continue;
    if (isInternal(op)) { skip++; continue; }
    const row = {
      v: Math.abs(Number(op.value) || 0),
      d: day,
      comment: String(op.comment || "").replace(/\s+/g, " ").trim().slice(0, 140),
    };
    if (op.operationType === "Income") inn.push(row);
    else if (op.operationType === "Outcome") out.push(row);
  }
  inn.sort((a, b) => b.v - a.v);
  out.sort((a, b) => b.v - a.v);
  const sum = (xs) => xs.reduce((s, r) => s + r.v, 0);
  return { inn, out, skip, IN: sum(inn), OUT: sum(out), all: all.length };
}

export function rub(n) {
  const a = Math.abs(Math.round(n));
  if (a >= 1_000_000) return (Math.round((a / 1_000_000) * 10) / 10).toLocaleString("ru-RU") + " млн";
  if (a >= 1000) return Math.round(a / 1000).toLocaleString("ru-RU") + " тыс.";
  return a.toLocaleString("ru-RU") + " ₽";
}
