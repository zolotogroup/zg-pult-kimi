// Пульт ЗОЛОТОГРУПП · почтовый шлюз для еженедельной рассылки.
// Развёртывание: https://script.google.com → новый проект → вставить этот файл →
// Deploy → New deployment → Web app → Execute as: Me → Access: Anyone → скопировать URL в GAS_URL,
// токен из TOKEN ниже — в GAS_TOKEN (GitHub Secrets).
//
// Приём: doPost({token, items:[{to, subject, html, pdfB64?, pdfName?}]}) → рассылает через Gmail.

const TOKEN = 'СМЕНИТЕ_НА_ДЛИННУЮ_СЛУЧАЙНУЮ_СТРОКУ';

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (!body || body.token !== TOKEN) return out({ ok: false, error: 'auth' });

  const sent = [], failed = [];
  for (const it of body.items || []) {
    try {
      const opts = { htmlBody: it.html, name: 'ЗОЛОТОГРУПП Пульт' };
      if (it.pdfB64) {
        opts.attachments = [Utilities.newBlob(Utilities.base64Decode(it.pdfB64), 'application/pdf', it.pdfName || 'weekly.pdf')];
      }
      GmailApp.sendEmail(it.to, it.subject, '', opts);
      sent.push({ to: it.to, subject: it.subject });
    } catch (err) {
      failed.push({ to: it.to, error: String(err).slice(0, 300) });
    }
  }
  log_(body, sent, failed);
  return out({ ok: failed.length === 0, sent: sent.length, failed });
}

// Запись в журнал: таблица «ZG Pult Mail Log» в корне Drive (создастся сама).
function log_(body, sent, failed) {
  try {
    const name = 'ZG Pult Mail Log';
    const files = DriveApp.getFilesByName(name);
    const ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(name);
    const sheet = ss.getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(['время', 'кому', 'тема', 'статус', 'ошибка']);
    for (const s of sent) sheet.appendRow([new Date(), s.to, s.subject, 'ok', '']);
    for (const f of failed) sheet.appendRow([new Date(), f.to, '', 'failed', f.error]);
  } catch (err) { /* журнал не критичен */ }
}

function doGet() {
  return out({ ok: true, service: 'zg-pult mailer', now: new Date().toISOString() });
}
