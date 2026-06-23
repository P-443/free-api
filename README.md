<div align="center">

# 🔓 Free Captcha API v3

**حلّال موحد لـ Cloudflare Turnstile و hCaptcha — يدعم أي موقع وأي مفتاح**

[![Node](https://img.shields.io/badge/Node-18%2B-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)]()
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)]()

</div>

---

## 📖 الفهرس

- [كيف يعمل](#-كيف-يعمل)
- [المتطلبات](#-المتطلبات)
- [التثبيت](#-التثبيت)
- [الاستخدام](#-الاستخدام)
  - [تشغيل الخدمة](#تشغيل-الخدمة)
  - [API Documentation](#api-documentation)
  - [أمثلة من curl](#أمثلة-من-curl)
  - [أمثلة من Python](#أمثلة-من-python)
  - [أمثلة من JavaScript](#أمثلة-من-javascript)
- [Token Pool (Redis)](#token-pool-redis)
- [المتغيرات البيئية](#-المتغيرات-البيئية)
- [Docker](#-docker)
- [هيكل المشروع](#-هيكل-المشروع)

---

## 🧠 كيف يعمل

الخدمة تشغّل **متصفح Chrome حقيقي** (عبر Playwright) وتتفاعل مع تحدي الكابتشا كما يفعل الإنسان تماماً:

| النوع | الطريقة |
|-------|---------|
| **Cloudflare Turnstile** | يحقن ويدجت Turnstile في صفحة الموقع الحقيقية، ينتظر الحل التلقائي (invisible) أو ينقر checkbox بحركات ماوس بشرية |
| **hCaptcha** | يحقن صفحة hCaptcha وهمية، ينقر checkbox، ينتظر التحدي ويستخرج التوكن |

**لماذا يصعب اكتشافه؟**
- متصفح Chrome حقيقي — وليس محاكاة
- خصائص `navigator.webdriver` و `navigator.plugins` مزورة
- `window.chrome` موجود (كما في المتصفح الطبيعي)
- المتصفح يبقى مفتوحاً بين الجلسات (persistent profile)

---

## 📦 المتطلبات

- **Node.js 18+**
- **Google Chrome** أو Chromium مثبت على النظام
- (اختياري) **Redis** — لتجمع التوكنات المُعبأ مسبقاً

---

## 🔧 التثبيت

```bash
git clone https://github.com/P-443/free-api.git
cd free-api
npm install
npx playwright install chromium  # تثبيت متصفح Playwright
```

---

## 🚀 الاستخدام

### تشغيل الخدمة

```bash
# تشغيل بسيط — API فقط بدون token pool
npm start

# مع متغيرات بيئية
PORT=8080 npm start

# مع Redis token pool
REDIS_URL=redis://user:pass@host:port POOL_WORKERS=1 npm start
```

الخدمة تستمع على `http://0.0.0.0:9000` (أو المنفذ المحدد في `PORT`).

---

## 📚 API Documentation

### `GET /` — التوثيق والمعلومات

يعرض كل الـ endpoints والـ usage examples.

```bash
curl http://localhost:9000/
```

<details>
<summary>مثال للرد</summary>

```json
{
  "name": "Free Captcha API v3",
  "description": "Unified solver for Cloudflare Turnstile & hCaptcha — any site, any key",
  "endpoints": {
    "/": "GET — This documentation",
    "/health": "GET — Service health & pool status",
    "/solve/turnstile": "POST — Solve Cloudflare Turnstile (direct)",
    "/solve/hcaptcha": "POST — Solve hCaptcha (direct, with optional proxy)",
    "/get-hcaptcha-token": "GET — Get pre-solved hCaptcha token from pool",
    "/get-turnstile-token": "GET — Get pre-solved Turnstile token from pool"
  }
}
```
</details>

---

### `GET /health` — فحص الصحة

```bash
curl http://localhost:9000/health
```

```json
{ "status": "ok", "redis": true, "hcaptcha_pool_size": 47 }
```

---

### `POST /solve/turnstile` — حل Cloudflare Turnstile

يحل تحدي Turnstile على **أي موقع** — يعيد التوكن مباشرة.

| حقل | نوع | مطلوب | افتراضي | شرح |
|------|------|-------|----------|------|
| `sitekey` | string | نعم | — | مفتاح Turnstile من الصفحة المستهدفة |
| `siteurl` | string | نعم | — | رابط الصفحة الكامل الذي يحتوي على Turnstile |
| `timeout` | integer | لا | `45` | أقصى وقت انتظار بالثواني |
| `proxy` | object | لا | — | بروكسي اختياري `{"server":"http://ip:port","username":"user","password":"pass"}` |

```bash
curl -s -X POST http://localhost:9000/solve/turnstile \
  -H "Content-Type: application/json" \
  -d '{"sitekey":"0x4AAAAAAActoBfh_En8yr3T","siteurl":"https://example.com/"}'
```

**✅ نجاح 200:**
```json
{ "status": "success", "token": "0.abc123...longtoken...xyz", "elapsed": 4.23 }
```

**❌ فشل 500:**
```json
{ "status": "error", "detail": "Turnstile token not obtained within 45s", "elapsed": 45.0 }
```

---

### `POST /solve/hcaptcha` — حل hCaptcha

يحل تحدي hCaptcha على **أي موقع** — يعيد التوكن مباشرة.

| حقل | نوع | مطلوب | افتراضي | شرح |
|------|------|-------|----------|------|
| `sitekey` | string | نعم | — | مفتاح hCaptcha من الصفحة المستهدفة |
| `siteurl` | string | نعم | — | رابط الصفحة الكامل |
| `proxy` | object | لا | — | بروكسي اختياري |

```bash
curl -s -X POST http://localhost:9000/solve/hcaptcha \
  -H "Content-Type: application/json" \
  -d '{"sitekey":"463b917e-e264-403f-ad34-34af0ee10294","siteurl":"https://example.com/"}'
```

**✅ نجاح 200:**
```json
{ "status": "success", "token": "P0_abc123...longtoken...xyz", "elapsed": 5.67 }
```

**مع بروكسي:**
```bash
curl -s -X POST http://localhost:9000/solve/hcaptcha \
  -H "Content-Type: application/json" \
  -d '{
    "sitekey":"10000000-ffff-ffff-ffff-000000000001",
    "siteurl":"https://example.com/",
    "proxy":{"server":"http://66.33.22.238:29967","username":"user","password":"pass"}
  }'
```

---

### `GET /get-hcaptcha-token` — توكن hCaptcha فوري من التجمع

يحتاج Redis + عامل token pool شغّال. يرجع توكن جاهز فوراً (إذا كان التجمع فيه توكنات).

```bash
curl http://localhost:9000/get-hcaptcha-token
```

```json
{ "status": "success", "token": "P0_abc123..." }
```

---

### `GET /get-turnstile-token` — توكن Turnstile فوري من التجمع

```bash
curl http://localhost:9000/get-turnstile-token
```

```json
{ "status": "success", "token": "0.abc123..." }
```

---

## 📝 أمثلة من curl

### حل Turnstile (تحدي مباشر)

```bash
# حل Cloudflare Turnstile على أي موقع
curl -X POST http://localhost:9000/solve/turnstile \
  -H "Content-Type: application/json" \
  -d '{
    "sitekey": "0x4AAAAAAActoBfh_En8yr3T",
    "siteurl": "https://example.com/login",
    "timeout": 30
  }'
```

### حل hCaptcha (تحدي مباشر)

```bash
curl -X POST http://localhost:9000/solve/hcaptcha \
  -H "Content-Type: application/json" \
  -d '{
    "sitekey": "463b917e-e264-403f-ad34-34af0ee10294",
    "siteurl": "https://travel.bcengi.com/"
  }'
```

### سحب توكن جاهز من التجمع

```bash
# hCaptcha token فوري
curl http://localhost:9000/get-hcaptcha-token

# Turnstile token فوري
curl http://localhost:9000/get-turnstile-token
```

---

## 🐍 أمثلة من Python

```python
import requests

API = "http://localhost:9000"

# ── حل Turnstile ─────────────────────────
resp = requests.post(f"{API}/solve/turnstile", json={
    "sitekey": "0x4AAAAAAActoBfh_En8yr3T",
    "siteurl": "https://example.com/",
    "timeout": 45
})
data = resp.json()
if data["status"] == "success":
    print(f"Token: {data['token']} ({data['elapsed']}s)")

# ── حل hCaptcha ─────────────────────────
resp = requests.post(f"{API}/solve/hcaptcha", json={
    "sitekey": "463b917e-e264-403f-ad34-34af0ee10294",
    "siteurl": "https://example.com/",
    "proxy": {
        "server": "http://66.33.22.238:29967",
        "username": "user",
        "password": "pass"
    }
})
data = resp.json()
if data["status"] == "success":
    print(f"Token: {data['token']} ({data['elapsed']}s)")

# ── توكن فوري من التجمع ────────────────
resp = requests.get(f"{API}/get-hcaptcha-token")
data = resp.json()
if data["status"] == "success":
    print(f"Pool token: {data['token']}")
```

---

## 📜 أمثلة من JavaScript

```javascript
const API = 'http://localhost:9000';

// ── حل Turnstile ─────────────────────────
const tsResp = await fetch(`${API}/solve/turnstile`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sitekey: '0x4AAAAAAActoBfh_En8yr3T',
    siteurl: 'https://example.com/',
    timeout: 45,
  }),
});
const ts = await tsResp.json();
console.log(`Turnstile: ${ts.token} (${ts.elapsed}s)`);

// ── حل hCaptcha ─────────────────────────
const hcResp = await fetch(`${API}/solve/hcaptcha`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sitekey: '463b917e-e264-403f-ad34-34af0ee10294',
    siteurl: 'https://example.com/',
  }),
});
const hc = await hcResp.json();
console.log(`hCaptcha: ${hc.token} (${hc.elapsed}s)`);

// ── توكن فوري من التجمع ────────────────
const poolResp = await fetch(`${API}/get-hcaptcha-token`);
const pool = await poolResp.json();
console.log(`Pool: ${pool.token}`);
```

---

## 🏊 Token Pool (Redis)

للاستخدام عالي التوفر (High Availability)، يمكنك تشغيل **Token Pool** — عامل في الخلفية يحل الكابتشا مسبقاً ويخزن التوكنات في Redis. عندما تطلب `/get-hcaptcha-token`، تحصل على توكن جاهز **فوراً** بدون انتظار.

### الإعداد

```bash
# تعيين متغيرات البيئة
export REDIS_URL=redis://user:pass@your-redis-host:port
export POOL_WORKERS=1

# hCaptcha pool — الموقع الذي تريد حل كابتشا له
export HCAPTCHA_SITEKEY=463b917e-e264-403f-ad34-34af0ee10294
export HCAPTCHA_SITEURL=https://travel.bcengi.com/

# Turnstile pool — (اختياري)
export TURNSTILE_SITEKEY=0x4AAAAAAActoBfh_En8yr3T
export TURNSTILE_SITEURL=https://example.com/

# تشغيل
npm start
```

### كيف يعمل

```
المستخدم → GET /get-hcaptcha-token → Redis BLPOP → توكن فوري ⚡
                                                ↑
                  [Worker] ← يحل دفعات بالتوازي ← يدفع لـ Redis
```

- العامل يستهدف **50 توكن** في التجمع
- إذا قل عن **10** → حالة طوارئ، يحل بأسرع ما يمكن
- التوكنات تنتهي صلاحيتها بعد **110 ثانية** (hCaptcha) أو **300 ثانية** (Turnstile)

---

## ⚙️ المتغيرات البيئية

| متغير | افتراضي | شرح |
|--------|---------|------|
| `PORT` | `9000` | منفذ الخدمة |
| `CHROME_PATH` | تلقائي | مسار Chrome executable |
| `REDIS_URL` | — | رابط Redis (للتجمع) |
| `POOL_WORKERS` | `0` | عدد عمال token pool |
| `HCAPTCHA_SITEKEY` | — | مفتاح hCaptcha للتجمع |
| `HCAPTCHA_SITEURL` | — | رابط موقع hCaptcha للتجمع |
| `TURNSTILE_SITEKEY` | — | مفتاح Turnstile للتجمع |
| `TURNSTILE_SITEURL` | — | رابط موقع Turnstile للتجمع |
| `TARGET_POOL` | `50` | حجم التجمع المستهدف |
| `LOW_POOL` | `10` | حد الطوارئ |
| `BATCH_SIZE` | `20` | حجم دفعة الحل |

---

## 🐳 Docker

```bash
docker build -t free-captcha-api .
docker run -p 9000:9000 free-captcha-api
```

مع Redis:
```bash
docker run -p 9000:9000 \
  -e REDIS_URL=redis://user:pass@host:port \
  -e HCAPTCHA_SITEKEY=your-key \
  -e HCAPTCHA_SITEURL=https://yoursite.com/ \
  -e POOL_WORKERS=1 \
  free-captcha-api
```

---

## 📁 هيكل المشروع

```
free-api/
├── main.js                 # نقطة الدخول — تشغيل الخادم + العمال
├── api/
│   └── server.js           # خادم Fastify — كل الـ endpoints
├── solver/
│   ├── turnstile.js        # حلّال Cloudflare Turnstile (Playwright)
│   └── hcaptcha.js         # حلّال hCaptcha عام (أي موقع)
├── worker/
│   ├── token-pool.js       # عامل تعبئة تجمع التوكنات
│   └── proxies.txt         # قائمة البروكسيات
├── package.json
├── Dockerfile
└── README.md
```

---

## 🔄 سير العمل (Workflow)

```
                 ┌─────────────────────────┐
                 │     Free Captcha API    │
                 └───────────┬─────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
  POST /solve/turnstile  POST /solve/hcaptcha  GET /get-*-token
         │                   │                   │
         ▼                   ▼                   ▼
   solver/turnstile.js  solver/hcaptcha.js    Redis BLPOP
         │                   │                   │
         ▼                   ▼                   ▼
    Chrome (Playwright)  Chrome (Playwright)  Token Pool (Worker)
         │                   │                   │
         ▼                   ▼                   ▼
    Real browser           Fake hCaptcha      Pre-solved batch
    injects widget         page injected       (parallel contexts)
    clicks checkbox        clicks checkbox
         │                   │
         ▼                   ▼
      TOKEN ✅             TOKEN ✅
```

---

<div align="center">

**Made by Ismoiloff** — [GitHub](https://github.com/P-443)

</div>
