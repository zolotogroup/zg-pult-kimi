// Крипто-слой портала. Формат совместим с hub.html:
//   пароль → PBKDF2(salt, it) → KEK → слоты AES-GCM {k: fileKey, l: level}
//   .bin = AES-256-GCM(gzip(HTML)), IV в метаданных ENC.f[name].iv
import crypto from "node:crypto";
import zlib from "node:zlib";

const web = crypto.webcrypto;
export const ub = (s) => Buffer.from(s, "base64");
export const b64 = (buf) => Buffer.from(buf).toString("base64");
const te = new TextEncoder();
const td = new TextDecoder();

export async function kekOf(pw, saltB64, iterations) {
  const km = await web.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return web.subtle.deriveKey(
    { name: "PBKDF2", salt: ub(saltB64), iterations, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function readConst(src, name) {
  const key = `const ${name}=`;
  const start = src.indexOf(key);
  if (start < 0) throw new Error(name + " not found");
  let i = start + key.length;
  if (src[i] !== "{") throw new Error(name + " is not an object");
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { obj: JSON.parse(src.slice(i, k + 1)), start: i, end: k + 1, head: start };
    }
  }
  throw new Error(name + " unterminated");
}

// Достаёт ключ файлов из hub.html по любому известному паролю.
// Возвращает { ENC, key(Buffer), level }.
export async function unwrapPortalKey(hubHtml, pw) {
  const loc = readConst(hubHtml, "ENC");
  const ENC = loc.obj;
  const kek = await kekOf(pw, ENC.s, ENC.n);
  for (const sl of ENC.w) {
    try {
      const pay = JSON.parse(td.decode(await web.subtle.decrypt({ name: "AES-GCM", iv: ub(sl.iv) }, kek, ub(sl.ct))));
      if (pay?.k) return { ENC, key: ub(pay.k), level: pay.l, loc };
    } catch {}
  }
  throw new Error("portal key unwrap failed");
}

// Запечатывает payload слотом под паролем. payload = {k, l} или любой JSON.
export async function sealSlot(pw, saltB64, iterations, payload) {
  const kek = await kekOf(pw, saltB64, iterations);
  const iv = web.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await web.subtle.encrypt({ name: "AES-GCM", iv }, kek, te.encode(JSON.stringify(payload))));
  return { iv: b64(iv), ct: b64(ct) };
}

export function encryptBin(keyBuf, html) {
  const iv = crypto.randomBytes(12);
  const gz = zlib.gzipSync(Buffer.from(html), { level: 9 });
  const enc = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const ct = Buffer.concat([enc.update(gz), enc.final(), enc.getAuthTag()]);
  return { iv: iv.toString("base64"), ct };
}

export function decryptBin(keyBuf, buf, ivB64) {
  const iv = ub(ivB64);
  const data = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const dec = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
  dec.setAuthTag(tag);
  const gz = Buffer.concat([dec.update(data), dec.final()]);
  return zlib.gunzipSync(gz).toString("utf8");
}

export function putJson(html, id, obj) {
  const json = JSON.stringify(obj);
  const re = new RegExp(`(<script type="application/json" id="${id}">)[\\s\\S]*?(</script>)`);
  if (!re.test(html)) throw new Error("missing json " + id);
  return html.replace(re, `$1${json}$2`);
}

export function getJson(html, id) {
  const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
}
