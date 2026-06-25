# Cargo Tracker — AI-агент для трекінгу AWB та морських контейнерів

Реалізація згідно з ТЗ v1.0 (07.06.2026). Агент приймає список номерів
(авіа-вантажні накладні AWB та морські контейнери ISO 6346), визначає тип
кожного номера, маршрутизує запит до джерел трекінгу, нормалізує статуси й
повертає структурований JSON за схемою з §8 ТЗ.

Стек: **NestJS (бекенд) + React/Vite (фронтенд)**. Розгортання розраховане на
**Vercel Hobby** (serverless-функції, без headless-браузера).

---

## 1. Швидкий старт (локально)

Потрібен Node.js ≥ 18.18.

```bash
npm install
npm run dev
```

- бекенд (NestJS) підніметься на `http://localhost:3001` (префікс `/api`);
- фронтенд (Vite) — на `http://localhost:5173` з проксі `/api` → `3001`.

Відкрийте `http://localhost:5173`, вставте номери або завантажте файл
(`.json` / `.csv` / `.xlsx`), натисніть **Перевірити**.

За замовчуванням увімкнено **DEMO MODE** — детермінований синтетичний
конектор, який показує всі три сценарії з ТЗ (валідний + дані знайдено,
валідний + не знайдено, невалідний формат) без доступу до зовнішніх сайтів.

### Перевірка через curl

```bash
curl -X POST http://localhost:3001/api/track \
  -H 'Content-Type: application/json' \
  -d @examples/input.json
```

### Локальна відладка через Docker

Якщо не хочете ставити Node локально — є образ для відладки (NestJS у watch-режимі
+ Vite з HMR). Потрібен лише Docker.

```bash
docker compose up --build
```

- web UI — `http://localhost:5173`
- API — `http://localhost:3001/api`

Вихідний код прокинуто у контейнер через bind-mount, тож **зміни підхоплюються
на льоту** (hot reload) — і бекенд, і фронтенд. `DEMO_MODE=true` увімкнено в
контейнері за замовчуванням, тож працює офлайн.

Без compose (разовий запуск):

```bash
docker build -t cargo-tracker .
docker run --rm -p 5173:5173 -p 3001:3001 cargo-tracker
```

> Реальні ключі/джерела: скопіюйте `.env.example` → `.env` і додайте у
> `docker-compose.yml` під сервісом `app` рядок `env_file: .env`.
> Після зміни `package.json` перезберіть образ: `docker compose up --build`.

Інші ендпойнти:

| Метод | Шлях              | Призначення                                   |
|-------|-------------------|-----------------------------------------------|
| GET   | `/api/health`     | health-check                                  |
| POST  | `/api/track`      | трекінг за JSON (`{ shipments: [...] }`)       |
| POST  | `/api/track/csv`  | трекінг за CSV (text/plain тіло)              |
| GET   | `/api/schema`     | JSON Schema відповіді (§8)                     |

Тіло `POST /api/track`:

```json
{
  "shipments": [{ "id": "1", "number": "080-38652331" }],
  "demo": true,
  "debug": false
}
```

- `demo` (необов'язково) — примусово demo/live для конкретного запиту;
- `debug` — додає покроковий лог обробки кожного номера (§12).

---

## 2. Розгортання на Vercel (Hobby)

1. Залийте репозиторій у Git і імпортуйте проєкт у Vercel (**Framework Preset: Other**).
2. Build Command і Output вже задані у `vercel.json` — нічого міняти не треба:
   - `buildCommand`: `npm run build`
   - `outputDirectory`: `dist`
3. (Необов'язково) додайте змінні середовища — див. розділ 3.
4. Deploy.

### Як це працює на Vercel

- `npm run build` робить три кроки: `nest build` (бекенд → `dist-server/`),
  `vite build` (фронтенд → `dist/`), `copy:schema` (копіює JSON Schema у
  білд-артефакти).
- Статика SPA віддається з `dist/`, усі `/(не api)` маршрути переписуються на
  `/index.html` (`rewrites` у `vercel.json`).
- Бекенд працює як одна serverless-функція `api/[...slug].js`. Вона —
  **чистий JS**, який підключає вже скомпільований NestJS з `dist-server/`.
  Це навмисно: Vercel/esbuild не емітить `emitDecoratorMetadata`, через що
  ламається DI у NestJS. Попередня компіляція через `nest build` (tsc) з
  `emitDecoratorMetadata: true` вирішує проблему.
- Express-інстанс кешується між «теплими» викликами, `maxDuration` = 30 с
  (безпечно для Hobby).

---

## 3. Змінні середовища

Скопіюйте `.env.example` → `.env` (локально) або задайте у Vercel:

| Змінна                 | За замовч.            | Опис                                            |
|------------------------|-----------------------|-------------------------------------------------|
| `DEMO_MODE`            | `true`                | синтетичні дані замість реальних джерел         |
| `TIMEOUT_MS`           | `8000`                | таймаут на джерело                              |
| `CONCURRENCY`          | `4`                   | скільки номерів обробляється паралельно за запит |
| `RETRIES`              | `1`                   | кількість повторів на джерело                   |
| `RATE_LIMIT_DELAY_MS`  | `600`                 | пауза між запитами (rate limiting)              |
| `RAPIDAPI_KEY`         | —                     | ключ CargoAI через RapidAPI; вмикає режим `x-rapidapi-key` (пріоритетний) |
| `RAPIDAPI_HOST`        | (хост CargoAI на RapidAPI) | хост RapidAPI для CargoAI                  |
| `CARGOAI_API_KEY`      | —                     | прямий ключ CargoAI (Bearer); без RapidAPI/прямого ключа конектор віддає `LOGIN_REQUIRED` |
| `CARGOAI_BASE_URL`     | (залежить від режиму)  | необов'язковий override базового URL CargoAI    |
| `XAI_API_KEY`          | —                     | ключ Grok (xAI) для AI-парсингу-фолбеку (опц., §10.1); приймається й `GROK_API_KEY` |
| `XAI_BASE_URL`         | `https://api.x.ai/v1` | базовий URL xAI (OpenAI-сумісний)               |
| `GROK_MODEL`           | `grok-4.3`            | модель Grok                                      |
| `PORT`                 | `3001`                | порт локального бекенду                          |

> Жоден номер не «зашитий» у код (§13.13). DEMO-конектор генерує дані як
> чисту функцію від самого номера, а не з таблиці підстановки.

---

## 4. Архітектура

Конвеєр обробки (§10 ТЗ), кожен номер обробляється незалежно (§13.12):

```
Input Parser → Detector → Source Router → Connector(s) → Parser
            → Normalizer → JSON Builder → Logger
```

| Модуль | Файл | Роль |
|--------|------|------|
| Detector | `server/tracking/detector/` | тип номера (air_awb / sea_container / unknown), нормалізація, ISO 6346 check-digit, визначення перевізника за довідником |
| Source Router | `server/tracking/router/source-router.service.ts` | вибір конекторів за типом і режимом (demo/live) |
| Connectors | `server/tracking/connectors/` | demo, track-trace.com, CargoAI, шаблон сайту перевізника |
| Parsers | `server/tracking/parsers/` | евристичний парсер тексту + опційний AI-парсер на Grok (xAI) як фолбек |
| Normalizer | `server/tracking/normalizer/` | сирий статус → нормалізований словник (§7) |
| Builder | `server/tracking/builder/response.builder.ts` | повний і короткий формати відповіді (§8, §8.1), оцінка quality/confidence |
| Logger | `server/tracking/logger.ts` | покроковий debug-лог (§12) |

Фронтенд (`web/src/`): десктоп-орієнтований простий UI — панель вводу
(вставлення номерів / завантаження JSON·CSV·XLSX, перемикач demo), зведення,
таблиця результатів зі статус-пілами, розкривні деталі з таймлайном подій,
експорт результатів у JSON / CSV / XLSX.

---

## 5. Джерела даних

1. **track-trace.com** — основне джерело (авіа `/aircargo`, море `/container`).
2. **Сайти перевізників** — фолбек (шаблон-конектор для розширення).
3. **CargoAI API** — для авіа, якщо задано `CARGOAI_API_KEY`.

Агент **не обходить** CAPTCHA чи авторизацію — у таких випадках повертається
структурована помилка (`CAPTCHA_REQUIRED`, `LOGIN_REQUIRED`,
`SOURCE_UNAVAILABLE`), а не виняток.

---

## 6. Обмеження

- **Vercel Hobby = без headless-браузера.** Конектори працюють на простому
  HTTP (`fetch` + `cheerio`). track-trace.com рендериться через JS і має
  анти-бот захист, тому в live-режимі на Hobby він зазвичай поверне
  структуровану помилку (`SOURCE_UNAVAILABLE` / `CAPTCHA_REQUIRED` /
  `PARSING_FAILED`) — це відповідає ТЗ. Для реального парсингу потрібен хост
  з Playwright/Puppeteer: точки заміни — методи `download()`/`extractText()`
  у `track-trace.connector.ts`.
- Тому **DEMO_MODE увімкнено за замовчуванням** — щоб розгорнутий застосунок
  одразу демонстрував усі три сценарії.
- **Ліміт тривалості функції на Vercel Hobby — 60 с.** У live-режимі номери
  обробляються паралельно (до `CONCURRENCY`, типово 4), тож пакет із ~10 номерів
  укладається в ліміт навіть коли джерела повільні. Для дуже великих пакетів
  зменшуйте `TIMEOUT_MS`/збільшуйте `CONCURRENCY`, розбивайте запит на частини
  або переходьте на хост без 60-секундного обмеження.
- ISO 6346 контрольна цифра: при розбіжності номер не відхиляється, а
  позначається попередженням (`warnings`), як вимагає ТЗ.
- Grok ніколи не вигадує статуси/дати — лише структурує вже отриманий текст
  (§10.1).

---

## 7. Як додати новий конектор (перевізника)

1. Скопіюйте `server/tracking/connectors/carrier-web.connector.ts` у новий
   файл (напр. `maersk.connector.ts`).
2. Реалізуйте `supports(type)` і `fetch(detection, opts, logger)`, повертаючи
   `TrackResult` (використайте `emptyTrackResult()` як базу).
3. Зареєструйте провайдер у `server/tracking/tracking.module.ts`.
4. Додайте його у відповідний ланцюжок у
   `server/tracking/router/source-router.service.ts`.

Контракт конектора — `server/tracking/connectors/connector.interface.ts`
(є готові `fetchWithTimeout`, `retry`, `sleep`).

---

## 8. Приклади

- `examples/input.json` — вхідні дані (10 відправлень із ТЗ).
- `examples/output_example.json` — приклад повної відповіді за схемою §8.
- `schema/response.schema.json` — JSON Schema (draft-07) відповіді.

---

## 9. Скрипти npm

| Скрипт | Дія |
|--------|-----|
| `npm run dev` | бекенд + фронтенд одночасно (watch) |
| `npm run build` | повний білд для Vercel (server + web + schema) |
| `npm start` | запуск зібраного бекенду локально |
| `npm run typecheck` | перевірка типів без емісії |

---

## Відповідність ТЗ

Реалізовано: визначення типу та перевізника, нормалізований словник статусів
(§7), повний і короткий формати (§8/§8.1), коди помилок (§9), конвеєрна
архітектура (§10), таймаути/ретраї/rate-limit/debug (§11), ISO 8601 дати
(§11.1), debug-лог (§12), критерії приймання (§13) — локальний запуск за цим
README, JSON-ввід, незалежна обробка номерів, відсутність «зашитих» номерів,
розширюваність конекторів. Із §15 додано: веб-UI, експорт у CSV/Excel,
переклад інтерфейсу українською.
