# Пульт ЗОЛОТОГРУПП · автономная версия

Управленческий портал на GitHub Pages с клиентским шифрованием (PBKDF2 + AES-GCM),
самообновлением данных из ПланФикса и ПланФакта и еженедельной рассылкой через Google Apps Script.

Пересобран из архива передачи `zg-pult-передача.tar.gz` (бывший zg-pult.grok.me).
Серверной части нет: `hub.html` скачивает зашифрованные `data/*.bin` и расшифровывает
их в браузере паролем. Данные обновляет GitHub Actions.

## Как это работает

```
ПланФикс / ПланФакт (API, токены в GitHub Secrets)
  → GitHub Actions (cron): scripts/refresh-pult.mjs, scripts/build-week.mjs
  → data/*.bin (AES-256-GCM поверх gzip) + hub.html (метаданные, версии ?v=)
  → git push → GitHub Pages сам обновляет сайт
  → понедельник: Actions отправляет письма ролям через Google Apps Script (Gmail)
```

## Расписание (время Москвы)

| Когда | Что | Workflow |
|---|---|---|
| Вс и Чт 23:21 | Обновление «Просрочек» пульта из сохранений ПланФикса | `refresh-pult.yml` |
| Сб 23:09 | Сборка минувшей недели: деньги ПланФакт + срезы ПланФикс, перепечатка week.bin, 10 писем | `weekly.yml` (build) |
| Пн 09:17 | Отправка 10 писем ролям через Apps Script | `weekly.yml` (send) |

Окно данных недели: пн 00:00 — пт 19:00 МСК. Суббота входит, только если она рабочая
(секрет `WORKING_SATURDAYS_JSON`: `["2026-12-26"]`). Воскресенье не входит никогда.
Ручной запуск: Actions → нужный workflow → Run workflow.

## Уровни доступа

| Пароль | Уровень |
|---|---|
| Мастер-пароль (`PORTAL_PASS`) | все 12 вкладок |
| `881204` | первые 6 вкладок |
| Пароль роли недели (10 шт., см. `week-roles.json`) | только своя страница недели |
| `Zxcv1357` (генеральный директор) | все письма недели |

Управление: `node scripts/set-password.mjs list|add|remove|rotate-role|master` (см. `--help` скрипта).
После смены паролей — закоммитить `hub.html` (и `data/week.bin` для ролей) и дождитесь публикации.

## Развёртывание

1. **Создать репозиторий** и запушить эту папку. Публичный или приватный — данные зашифрованы,
   но исходники `hub.html` видны; паролей в репозитории нет.
2. **GitHub Pages**: Settings → Pages → Source: Deploy from branch → ваша ветка → root.
   Сайт будет на `https://<user>.github.io/<repo>/hub.html`.
3. **Secrets** (Settings → Secrets and variables → Actions):

   | Secret | Что |
   |---|---|
   | `PORTAL_PASS` | мастер-пароль портала |
   | `PLANFIX_TOKEN` | Bearer ПланФикс (`zlt.planfix.ru/rest`) |
   | `PLANFACT_TOKEN` | токен ПланФакт (`api.planfact.io`) |
   | `WEEK_ROLES_JSON` | `{"share":"…","gd":"…",…}` — пароли 10 ролей |
   | `WEEK_BASE_PASS` | пароль архива недель (по умолчанию `881204`) |
   | `WORKING_SATURDAYS_JSON` | `["YYYY-MM-DD",…]` рабочие субботы, по умолчанию `[]` |
   | `GAS_URL` | URL Web App Apps Script |
   | `GAS_TOKEN` | общий токен (см. `gas/mailer.gs`) |

   **Variables** (не секреты): `PORTAL_URL` = `https://<user>.github.io/<repo>`
   (ссылки в письмах; без неё в письмах будет заглушка).

4. **Apps Script**: https://script.google.com → новый проект → вставить `gas/mailer.gs` →
   заменить `TOKEN` на длинную случайную строку (= `GAS_TOKEN`) → Deploy → New deployment →
   Web app → Execute as: Me → Access: Anyone → скопировать URL (= `GAS_URL`).
   Рассылка идёт с того Google-аккаунта, которым развёрнут скрипт. Журнал отправок —
   таблица «ZG Pult Mail Log» в корне Drive, создаётся сама.

## Локальная работа

```bash
mkdir .secrets   # не коммитить!
# положить: portal.pass, planfix.token, planfact.token, week-roles.json
node scripts/refresh-pult.mjs                 # обновить просрочки
node scripts/build-week.mjs                   # собрать текущую минувшую неделю
WEEK_FORCE=2026-09-28,2026-10-02 node scripts/build-week.mjs   # явное окно
node scripts/send-letters.mjs --dry           # сухой прогон рассылки
node scripts/set-password.mjs list            # состояние слотов
node scripts/shrink-check.mjs                 # вес сайта
```

Секреты читаются из env, если заданы, иначе из `.secrets/`.

## Важные правила (перенесены из регламента сборки)

- Цифры не выдумывать: нет сохранения отчёта на пятницу 19:00 — в письме честное «нет среза».
- Правки (426592) уходят только гендиректору, заму, арту, аналитике, проектам.
- Токены в письма не писать, в репозиторий не коммитить.
- После правки любого `.bin` версия `?v=` в `hub.html` поднимается скриптом сама.

## Структура

```
hub.html, data/*.bin, fonts/, brand/   — сайт (корень Pages)
scripts/lib/                           — крипто, клиенты API, календарь недели
scripts/refresh-pult.mjs               — вс/чт: просрочки из ПланФикс
scripts/build-week.mjs                 — сб: сборка недели + письма
scripts/send-letters.mjs               — пн: отправка через Apps Script
scripts/set-password.mjs               — пароли и уровни
scripts/shrink-check.mjs               — контроль веса (< 20 МБ)
.github/workflows/                     — cron-расписание
gas/mailer.gs                          — почтовый шлюз (Gmail)
```

Отчёты ПланФикс (ID сохранений): 426408 контракты, 426450 счета и суды, 426440 BD,
426432 часы, 426586 просрочки, 426592 правки, 426596 документы МП, 426406 монтаж,
426582 просроченные этапы и МП. Список для письма — `REPORT_IDS` / `LETTER_EXTRA_IDS`.
