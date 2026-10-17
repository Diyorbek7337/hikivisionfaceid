# 📷 Face ID davomat tizimi (Hikvision + Firebase)

Hikvision yuz tanish terminallari (DS-K1T331W, DS-K1T342 va shu turdagilar) uchun davomat web app'i.

- **Web app'da** xodim qo'shasiz va uning **rasmini yuklaysiz** (yoki kameradan olasiz). Xodim va uning yuzi
  **terminallarga avtomatik yoziladi**, terminalga qo'lda kirish shart emas.
- Xodim terminalga yuzini ko'rsatsa, **keldi/ketdi** yoziladi. Kechikish, erta ketish, ishlagan soat va summa hisoblanadi.
- **Bugun** sahifasi jonli yangilanadi. **Hisobot**ni Excel'ga (CSV) yuklab olish, qo'lda tuzatish mumkin.
- Telegram (ixtiyoriy): xodimga "keldingiz/ketdingiz", kechikkanda adminga xabar.

```
                         Ofis tarmog'i                                   Internet
 ┌──────────────┐                     ┌──────────────────────┐        ┌──────────────────┐
 │ Terminal 1   │◀── xodim + yuz ─────│                      │        │                  │
 │ (Kirish)     │──── keldi/ketdi ───▶│   Ko'prik (bridge)   │◀──────▶│ Firebase         │
 └──────────────┘                     │   ofis kompyuterida  │        │ (baza + login)   │
 ┌──────────────┐                     │                      │        │                  │
 │ Terminal 2   │◀───────────────────▶│   + web app          │        └──────────────────┘
 │ (Chiqish)    │                     └──────────────────────┘                 ▲
 └──────────────┘                                ▲                             │
                                                 └── brauzer: http://localhost:3000
```

- **`bridge/`** — ofis kompyuterida ishlaydigan dastur. Terminallar bilan gaplashadi (ular faqat ofis
  tarmog'ida ko'rinadi) va Firebase bilan ma'lumot almashadi. Web app'ni ham shu ko'rsatadi.
- **`web/`** — Next.js web app (admin panel). Ma'lumotlar Firebase Firestore'da.
- **`firebase/`** — Firestore xavfsizlik qoidalari.

Firebase'ning bepul (Spark) tarifi yetadi.

---

## 1-qadam. Firebase loyihasini yaratish (bir marta, ~10 daqiqa)

1. https://console.firebase.google.com → **Create a project** (Add project) → nomi masalan `davomat`
   → Google Analytics shart emas → **Create**.

2. **Firestore Database** (chap menyu → Build → Firestore Database) → **Create database**
   → joylashuv: `eur3 (europe)` yoki yaqinroq → **Start in production mode** → Create.

3. Firestore → **Rules** tabi → ichidagini o'chirib, `firebase/firestore.rules` faylining matnini
   to'liq joylang → **Publish**.

4. **Authentication** (Build → Authentication) → **Get started** → **Email/Password** → yoqing → Save.
   Keyin **Users** tabi → **Add user** → o'z emailingiz va parolingiz. (Shu bilan web app'ga kirasiz.)

5. **Web app konfiguratsiyasi**: ⚙️ (Project settings) → **General** → pastda "Your apps" → **`</>`** (Web)
   → nomi `davomat-web` → **Register app**. Ekranda shunday kod chiqadi:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "davomat-xxxx.firebaseapp.com",
     projectId: "davomat-xxxx",
     ...
   };
   ```

   Shu `const firebaseConfig = { ... };` qismini nusxalang va Bloknotda **`bridge\firebase-web-config.json`**
   nomli faylga saqlang (qanday bo'lsa shunday — ko'prik o'zi tushunadi).

6. **Ko'prik kaliti**: ⚙️ Project settings → **Service accounts** → **Generate new private key** → Generate.
   Yuklab olingan `.json` faylni **`bridge\serviceAccountKey.json`** nomi bilan `bridge` papkasiga qo'ying.

   ⚠️ Bu fayl — Firebase'ingizning to'liq kaliti. Hech kimga bermang, internetga yuklamang.

---

## 2-qadam. Ofis kompyuterini tayyorlash (Windows)

Kompyuter va terminallar **bitta tarmoqda** (bitta routerga ulangan) bo'lishi kerak.

1. **Node.js** o'rnating: https://nodejs.org → **LTS** (22 yoki yangiroq).
2. Loyihani yuklab oling: GitHub → branch tanlang → **Code → Download ZIP** → masalan `C:\davomat` ga oching.
3. 1-qadamdagi ikki faylni `C:\davomat\bridge\` ga qo'ying:
   `serviceAccountKey.json` va `firebase-web-config.json`.
4. `firewall-ochish.bat` → o'ng tugma → **Run as administrator** (bir marta).
5. `start-windows.bat` ni ikki marta bosing:
   - Birinchi marta Bloknot ochiladi → `ADMIN_EMAILS=` qatoriga 1-qadamda yaratgan emailingizni yozing → saqlang → yoping.
   - Birinchi marta web app yig'iladi (2–5 daqiqa).
   - Brauzerda `http://localhost:3000` ochiladi → email va parol bilan kiring.
   - **Qora oynani yopmang** — u ko'prik. Yopilsa terminallar bilan aloqa uziladi.

Muhim:

- **Kompyuterga doimiy IP bering** (routerda DHCP reservation). Terminallar shu IP ga event yuboradi.
- **Uyqu rejimini o'chiring**: Settings → System → Power → Sleep → **Never**.
- **Avtomatik ishga tushish**: `Win + R` → `shell:startup` → `start-windows.bat` ga yorliq (shortcut) qo'ying.
- Kompyuter o'chib qolsa — terminallar eventlarni xotirasida saqlaydi va keyin yuboradi.

---

## 3-qadam. Terminalni ulash

### 3.1. Web app'da terminal qo'shish

**Terminallar → + Terminal qo'shish**:

| Maydon | Qiymat |
|---|---|
| Nomi | `Kirish eshigi` |
| IP manzil | terminal IP si (SADP da ko'rinadi, masalan `192.168.31.68`) |
| Port | `80` |
| Login / Parol | terminalning web sahifasiga kiradigan `admin` va uning paroli |
| Yo'nalish | **Kirish** (ikkinchi terminal uchun **Chiqish**) |

Bir necha soniyadan keyin terminal yonida **✓ ulangan** chiqadi va modeli ko'rinadi.
Ko'prik terminal soatini ham avtomatik Toshkent vaqtiga to'g'rilaydi.

### 3.2. Terminalda HTTP Listening

Terminal web sahifasi (`http://192.168.31.68`) → **Configuration → Network → Advanced → HTTP Listening**.
Web app'dagi **Terminallar** sahifasida "Terminalda sozlash" ni oching — u yerda aniq qiymatlar bor:

| Maydon | Qiymat |
|---|---|
| Destination IP or Host Name | ko'prik kompyuterining IP si (masalan `192.168.31.10`) |
| URL | `/hik/…/event` (web app ko'rsatadi) |
| Port | `3000` |
| Protocol | `HTTP` |

Bo'sh qatorga yozing → **Save**. Boshqa qatorda eski, keraksiz manzil bo'lsa (masalan EHome), uni
`0.0.0.0` / port `0` qilib o'chiring — aks holda ma'lumotlar begona serverga ham ketadi.

---

## 4-qadam. Xodim qo'shish

**Xodimlar → + Xodim qo'shish** → rasm yuklang yoki **Kameradan olish** → ism, ish vaqti, soatbay stavka → **Saqlash**.

- Xodimga **ID avtomatik** beriladi (1, 2, 3…).
- Ko'prik xodimni va yuzini barcha terminallarga yozadi. Xodimlar ro'yxatida har terminal ustunida:
  **✓** — yozildi, **⏳** — yuborilmoqda, **✗** — xato (sichqonchani ustiga olib boring).
- Rasm talablari: yuz to'g'ridan, yorug' joyda, ko'zoynak/niqobsiz, rasmda bitta odam.
  Terminal rasmni qabul qilmasa — "Rasmda yuz aniq ko'rinmayapti" xatosi chiqadi, boshqa rasm yuklang.
- **Faol** belgisini olib tashlasangiz — xodim terminallardan o'chiriladi (tarixi saqlanadi).
- Terminal tozalab yuborilgan bo'lsa: Terminallar → **🔄 Qayta yuborish**.

Sinov: terminalga yuzingizni ko'rsating → **Bugun** sahifasida darhol "Keldi" chiqadi.
**Eventlar** sahifasida terminaldan kelgan har bir skan ko'rinadi.

---

## 5-qadam. Telegram (ixtiyoriy)

1. Telegram'da **@BotFather** → `/newbot` → token → `bridge\.env` dagi `BOT_TOKEN=` ga yozing.
2. Botga `/start` yozing — bot chat ID ingizni aytadi → `ADMIN_TELEGRAM_IDS=` ga yozing.
3. Ko'prikni qayta ishga tushiring.
4. Har bir xodim botga `/start` yozadi → chat ID sini sizga beradi → xodim kartasidagi "Telegram chat ID" ga kiritasiz.

---

## Hisob-kitob qoidalari

- **Keldi** — kirish terminalidagi kunning birinchi skani. **Ketdi** — chiqish terminalidagi oxirgi skani.
  (Terminal "Avtomatik" rejimda bo'lsa: kunning 1-skani keldi, keyingilari ketdi.)
- **Kechikish** — Sozlamalardagi daqiqadan ko'p kechiksa, ish boshlanishidan hisoblanadi.
- **Ishlagan vaqt** = ketdi − keldi. **Summa** = ishlagan soat × soatbay stavka.
- Bir xodimning ketma-ket skanlari (standart 60 soniya ichida) bitta hisoblanadi.
- Xodim skan qilishni unutsa: **Hisobot → Tahrirlash** yoki **+ Qo'lda qo'shish**.

---

## Keyinroq: web app'ni internetga chiqarish

Web app'ni telefondan, uydan ochish uchun uni internetga joylash mumkin (masalan **Firebase Hosting**
yoki **Vercel**, bepul). Ko'prik esa **ofis kompyuterida qoladi** — u terminallar bilan ofis tarmog'i
orqali gaplashadi, web app esa ma'lumotni Firebase'dan oladi.

Firebase Hosting misoli:

```bash
cd web
# web/public/firebase-config.json — bridge/firebase-web-config.json dagi qiymatlar, JSON ko'rinishida
npm run build
npx firebase-tools login
npx firebase-tools init hosting        # public papka: out
npx firebase-tools deploy --only hosting
```

---

## Muammolarni hal qilish

| Belgi | Yechim |
|---|---|
| Yuqorida "Ko'prik o'chiq" | Ofis kompyuterida `start-windows.bat` ishlayaptimi? |
| Terminal "✗ ulanmagan" | IP to'g'rimi? Kompyuterdan `ping 192.168.31.68`. Login/parol to'g'rimi? |
| Xodim yonida "✗ …" | Xato matnini o'qing (ko'pincha rasm sifati). Boshqa rasm yuklang. |
| Skan qilinsa ham "Bugun"da chiqmayapti | Terminalda HTTP Listening ni tekshiring; Windows Firewall (`firewall-ochish.bat`). **Eventlar** sahifasini ko'ring. |
| Eventlarda "Xodim topilmadi" | Terminalda web app'da yo'q odam bor — terminaldan o'chiring yoki web app'ga qo'shing. |
| "Ruxsat yo'q" | `bridge\.env` dagi `ADMIN_EMAILS` ga emailingizni yozib, ko'prikni qayta ishga tushiring. |
| "Firebase sozlanmagan" | `bridge\firebase-web-config.json` faylini tekshiring (1-qadam, 5-band). |

Kod yangilangandan keyin: `web-yangilash.bat` ni ishga tushiring, so'ng `start-windows.bat`.

---

## Dasturchilar uchun

```bash
# Ko'prik testlari (soxta terminal bilan)
cd bridge && npm install && npm test

# Firebase emulyatorlari bilan to'liq lokal ishga tushirish
cd firebase && npx firebase-tools emulators:start --only auth,firestore --project demo-davomat
# bridge/firebase-web-config.json: {"apiKey":"x","projectId":"demo-davomat","useEmulators":true}
cd bridge && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  GCLOUD_PROJECT=demo-davomat ADMIN_EMAILS=admin@test.uz node src/index.js
cd web && npm install && npm run build      # yoki: npm run dev (port 3001, web/public/firebase-config.json kerak)
```

| Fayl | Vazifasi |
|---|---|
| `bridge/src/index.js` | Ishga tushirish |
| `bridge/src/server.js` | Terminal eventlarini qabul qilish (`POST /hik/:deviceId/event`), web app'ni ko'rsatish |
| `bridge/src/hikvision.js` | Event formatini o'qish (multipart / JSON / XML) |
| `bridge/src/attendance.js` | Keldi/ketdi, kechikish, ishlagan vaqt, Telegram matnlari |
| `bridge/src/isapi.js` | Terminal ISAPI (digest auth): xodim, yuz, soat, qurilma ma'lumoti |
| `bridge/src/sync.js` | Firestore'dagi xodimlarni terminallarga sinxronlash |
| `bridge/src/monitor.js` | Terminallar holati va soatini tekshirish |
| `bridge/src/store.js` | Firestore bilan ishlash |
| `web/src/app/*` | Web app sahifalari |
| `firebase/firestore.rules` | Xavfsizlik qoidalari (faqat `admins/{uid}` dagi foydalanuvchilar) |

Firestore tuzilmasi: `employees`, `employeeFaces`, `devices`, `attendance` (`{employeeId}_{sana}`),
`events`, `settings/general`, `system/bridge`, `admins`, `counters/employees`.
