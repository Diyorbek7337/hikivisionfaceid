# 📷 Hikvision Face ID davomat tizimi

Hikvision **DS-K1T342EX** yuz tanish terminallari uchun davomat serveri va admin panel.

- Terminal xodimning yuzini taniydi va eventni internet orqali serverga yuboradi.
- Server keldi/ketdi vaqtini yozadi, kechikish, erta ketish, ishlagan soat va kunlik summani hisoblaydi.
- Admin panelda: bugungi holat, xodimlar, terminallar, oylik hisobot (Excel/CSV), eventlar jurnali.
- Telegram (ixtiyoriy): xodimga "keldingiz/ketdingiz" xabari, kechikkanda adminga xabar.

Hech qanday tashqi baza (Firebase va h.k.) kerak emas — ma'lumotlar serverdagi bitta SQLite faylida saqlanadi.

```
 ┌──────────────────┐                          ┌────────────────────────────┐
 │ Terminal 1       │──┐                       │  Server (VPS)              │
 │ "Kirish"         │  │   HTTP event          │  ┌──────────────────────┐  │
 └──────────────────┘  ├──────────────────────▶│  │ Davomat server       │  │
 ┌──────────────────┐  │   (internet orqali)   │  │ + SQLite baza        │  │──▶ Telegram
 │ Terminal 2       │──┘                       │  │ + Admin panel        │  │
 │ "Chiqish"        │                          │  └──────────────────────┘  │
 └──────────────────┘                          └────────────────────────────┘
```

Ikki terminal bo'lgani uchun eng qulay variant: **biri "Kirish", biri "Chiqish"**.
Kirish terminalidagi skan = "keldi", chiqish terminalidagi skan = "ketdi".
(Agar ikkala terminal ham bir xil vazifada bo'lsa, ularni "Avtomatik" rejimga qo'ying:
kunning birinchi skani "keldi", keyingilari "ketdi".)

---

## 🖥 Boshlash: o'z kompyuteringizni server qilish (Windows)

Sinov va boshlang'ich ishlatish uchun eng oson yo'l. Kompyuter va ikkala terminal **bitta ofis
tarmog'ida** (bitta routerga ulangan) bo'lishi kerak. Internet, domen, VPS kerak emas.

1. **Node.js o'rnating:** https://nodejs.org → **LTS** versiya (22 yoki yangiroq) → o'rnating.
2. **Loyihani yuklab oling:** GitHub'da **Code → Download ZIP** → masalan `C:\davomat` papkasiga oching
   (yoki `git clone`).
3. **Firewall'ni oching:** `firewall-ochish.bat` ustida sichqonchaning o'ng tugmasi →
   **Run as administrator**. (Bir marta qilinadi.)
4. **Serverni ishga tushiring:** `start-windows.bat` ni ikki marta bosing.
   - Birinchi marta Bloknot ochiladi → `ADMIN_PASSWORD=` qatoriga parol yozing → saqlang → yoping.
   - Qora oynada `Tarmoqdagi manzil: http://192.168.1.10:3000/admin` kabi qator chiqadi.
   - **Bu oynani yopmang** — yopilsa server to'xtaydi.
5. Brauzerda `http://localhost:3000/admin` ni oching → login `admin` va o'zingiz yozgan parol.
6. Keyin pastdagi **2-, 3-, 4-qadamlarni** bajaring. Terminallar sahifasi terminalga nima yozishni
   avtomatik ko'rsatadi: Destination IP = kompyuteringiz IP si, Port = `3000`.

Muhim:

- **Kompyuterga doimiy IP bering.** Routerda (DHCP reservation) yoki Windows tarmoq sozlamalarida.
  Aks holda IP o'zgarib qolsa, terminallar serverni topa olmaydi.
- **Uyqu rejimini o'chiring:** *Settings → System → Power → Sleep → Never*. Kompyuter uxlasa yoki
  o'chsa, terminallar eventlarni o'z xotirasida saqlab turadi va kompyuter yoqilganda yuboradi
  (keldi/ketdi vaqtlari to'g'ri yoziladi).
- **Avtomatik ishga tushish:** `Win + R` → `shell:startup` → ochilgan papkaga `start-windows.bat`
  uchun yorliq (shortcut) qo'ying.
- Ma'lumotlar `data\davomat.db` faylida — vaqti-vaqti bilan nusxasini olib qo'ying.
- Admin panelni ofisdagi boshqa kompyuter yoki telefondan ham ochish mumkin:
  `http://<kompyuter IP si>:3000/admin`.

Keyinroq VPS'ga ko'chmoqchi bo'lsangiz, pastdagi 1-qadamni bajaring va `data\davomat.db` faylini
serverga ko'chiring — barcha ma'lumotlar saqlanib qoladi.

---

## 1-qadam. Server tayyorlash (internetdagi VPS)

Kerak bo'ladi:

- **VPS** — Ubuntu 22.04/24.04, 1 GB RAM yetarli (masalan: Hetzner, DigitalOcean, yoki mahalliy hosting).
- **Domen** (masalan `hik.sizningkompaniya.uz`) — DNS'da `A` yozuvi VPS IP manziliga qaratilgan bo'lsin.
  Domen orqali admin panel avtomatik HTTPS (shifrlangan) bo'ladi. Arzon `.uz` domen yoki bepul
  subdomen (masalan duckdns.org) ham yetadi.

VPS'ga kirib:

```bash
# Docker o'rnatish
curl -fsSL https://get.docker.com | sh

# Loyihani yuklab olish
git clone https://github.com/Diyorbek7337/hikivisionfaceid.git
cd hikivisionfaceid

# Sozlamalar
cp .env.example .env
nano .env
```

`.env` da albatta to'ldiring:

| O'zgaruvchi | Nima yoziladi |
|---|---|
| `DOMAIN` | `hik.sizningkompaniya.uz` |
| `PUBLIC_URL` | `http://hik.sizningkompaniya.uz` (o'z kompyuteringizda bo'sh qoldiring) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin panelga kirish uchun login va **kuchli** parol |
| `SESSION_SECRET` | `openssl rand -hex 32` buyrug'i chiqargan satr |
| `LATE_GRACE_MINUTES` | Necha daqiqagacha kechikish hisoblanmaydi (standart 5) |
| `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS` | Telegram uchun (ixtiyoriy, pastda 5-qadam) |

Ishga tushirish:

```bash
docker compose up -d --build
```

Endi brauzerda `https://hik.sizningkompaniya.uz` ni oching → admin panelga kiring.

> Firewall: VPS'da faqat 22, 80 va 443 portlar ochiq bo'lsin.

---

## 2-qadam. Admin panelda terminallarni qo'shish

1. **Terminallar → + Terminal qo'shish**
2. Birinchisi: Nomi `Kirish eshigi`, Yo'nalish **Kirish**
3. Ikkinchisi: Nomi `Chiqish eshigi`, Yo'nalish **Chiqish**

Har bir terminal uchun panel **alohida maxfiy URL** ko'rsatadi, masalan:

| Parametr | Qiymat |
|---|---|
| Destination IP / Domain | `hik.sizningkompaniya.uz` |
| URL | `/hik/76e0eb20c56034807ea4f2a3/event` |
| Port | `80` |
| Protocol | `HTTP` |

Shu qiymatlarni keyingi qadamda terminalga kiritasiz. URL ichidagi kod — parol vazifasini bajaradi,
uni boshqalarga bermang. Kerak bo'lsa "Yangi URL yaratish" tugmasi bilan almashtirasiz.

---

## 3-qadam. Terminallarni sozlash (har ikkalasi uchun)

### 3.1. Aktivlashtirish va tarmoq

1. Terminalni LAN kabel bilan ofis routeriga ulang.
2. Kompyuterga Hikvision **SADP Tool** ni o'rnating — u terminalni tarmoqdan topadi.
3. SADP'da: terminalni **aktivlashtiring** (admin parol qo'ying) va IP bering, masalan
   `192.168.1.50` (ikkinchisi `192.168.1.51`). **Gateway** — routeringiz IP si,
   **DNS** — `8.8.8.8`. DNS to'g'ri bo'lmasa terminal domenni topa olmaydi!
4. Brauzerda `http://192.168.1.50` ni oching va admin bilan kiring.

### 3.2. Vaqt

**Configuration → System → Time Settings**:
- Time Zone: **(GMT+05:00) Tashkent**
- NTP: yoqing, server `pool.ntp.org`

Vaqt noto'g'ri bo'lsa, kechikishlar noto'g'ri hisoblanadi. Admin panel terminal soati farq
qilsa ogohlantiradi.

### 3.3. Serverga event yuborish (HTTP Listening)

**Configuration → Network → Advanced Settings → HTTP Listening**
(ba'zi proshivkalarda: *Network → Advanced → Alarm Host* / *HTTP Host*):

- Destination IP or Domain: admin paneldagi qiymat
- URL: admin paneldagi qiymat (**har terminal uchun o'zinikini** kiriting)
- Port: `80`, Protocol: `HTTP`
- **Save**

Tekshirish: admin panel → **Terminallar** sahifasida "Oxirgi aloqa" yashil vaqtni ko'rsatadi
(terminal har bir necha daqiqada aloqa yuboradi yoki birinchi skandan keyin).

### 3.4. Xodimlarni terminalga kiritish

**User Management → Add** (yoki iVMS-4200 → *Person*):

- **Employee No**: `001`, `002`, ... — har xodim uchun unikal raqam
- **Name**: ism familiya
- **Face**: terminal kamerasida rasmga oling yoki fayl yuklang

⚠️ Har bir xodimni **ikkala terminalga ham** bir xil `Employee No` bilan kiriting.
iVMS-4200 dasturida xodimni bir marta kiritib, ikkala terminalga birdaniga yuborish mumkin
(*Access Control → Person → Apply to device*).

---

## 4-qadam. Xodimlarni admin panelga kiritish

**Xodimlar → + Xodim qo'shish**:

- **Ism familiya**
- **Terminal ID** — terminaldagi `Employee No` bilan **aynan bir xil** (`001` ≠ `1`)
- **Ish boshlanishi / tugashi** — masalan `09:00` / `18:00`
- **Soatbay stavka** — hisobotda summa chiqishi uchun (ixtiyoriy)
- **Telegram chat ID** — xodimga xabar borishi uchun (ixtiyoriy)

Qulay usul: avval xodimni faqat terminalga kiriting va yuzini skan qildiring.
**Eventlar** sahifasida "Xodim topilmadi · Qo'shish" chiqadi — "Qo'shish" bosilsa forma
Terminal ID bilan to'ldirilgan holda ochiladi.

---

## 5-qadam. Telegram (ixtiyoriy)

1. Telegram'da **@BotFather** → `/newbot` → token oling → `.env` dagi `BOT_TOKEN` ga yozing.
2. O'zingiz botga `/start` yozing — bot sizning **chat ID** ingizni aytadi.
   Uni `.env` dagi `ADMIN_TELEGRAM_IDS` ga yozing (bir nechta bo'lsa vergul bilan).
3. `docker compose up -d` bilan qayta ishga tushiring.
4. Har bir xodim botga `/start` yozadi → chat ID sini sizga yuboradi → siz uni xodim kartasiga kiritasiz.

Xabarlar namunasi:

```
✅ Kelganingiz qayd etildi!

👤 Aziz Karimov
🕐 Vaqt: 09:15
📷 Yuz orqali tasdiqlangan

⚠️ Kechikish: 15 daq
```

```
👋 Ketganingiz qayd etildi!

👤 Aziz Karimov
🕐 Vaqt: 18:05
⏱ Ishlagan: 8 soat 50 daq
📷 Yuz orqali tasdiqlangan
💰 Bugun: 220,833 so'm
```

---

## Hisob-kitob qoidalari

- **Keldi** — kirish terminalidagi kunning birinchi skani. Tushlikdan qaytish keldi vaqtini o'zgartirmaydi.
- **Ketdi** — chiqish terminalidagi kunning oxirgi skani.
- **Kechikish** — ish boshlanishidan keyin `LATE_GRACE_MINUTES` dan ko'p kechiksa, ish boshlanishidan hisoblanadi.
- **Erta ketish** — ish tugashidan oldin ketsa.
- **Ishlagan vaqt** = ketdi − keldi. **Summa** = ishlagan soat × soatbay stavka.
- Bir xodimning `DEBOUNCE_SECONDS` (standart 60 s) ichidagi takroriy skanlari hisobga olinmaydi.
- Terminal internet uzilganda eventlarni xotirada saqlab, keyin yuboradi — ular to'g'ri vaqt bilan
  yoziladi (eski eventlar uchun Telegram xabari yuborilmaydi).
- Noto'g'ri yozuvni **Hisobot** sahifasida ✕ tugmasi bilan o'chirish mumkin.

---

## Muammolarni hal qilish

| Belgi | Sabab va yechim |
|---|---|
| Terminallar sahifasida "Hali ulanmagan" | Terminalda HTTP Listening sozlamasi, DNS va Gateway ni tekshiring. Terminal internetga chiqa olishiga ishonch hosil qiling. |
| Eventlar sahifasida "Xodim topilmadi" | Admin paneldagi Terminal ID terminaldagi Employee No bilan bir xil emas. |
| "Tanilmadi / boshqa event" | Yuz tanilmagan yoki eshik eventi — bu normal holat. |
| Kechikish noto'g'ri | Terminal vaqt zonasi va NTP sozlamasini tekshiring. |
| Telegram xabar kelmayapti | `BOT_TOKEN` ni, xodim botga `/start` yozganini va chat ID to'g'ri kiritilganini tekshiring. |

Server loglari: `docker compose logs -f app`

Serverni qo'lda sinash (terminalsiz):

```bash
curl -X POST https://hik.sizningkompaniya.uz/hik/<TERMINAL_URL_KODI>/event \
  -H "Content-Type: application/json" \
  -d '{"eventType":"AccessControllerEvent","dateTime":"2026-01-15T09:05:00+05:00",
       "AccessControllerEvent":{"majorEventType":5,"subEventType":75,"employeeNoString":"001","name":"Test","serialNo":1}}'
```

---

## Zaxira nusxa (backup)

Barcha ma'lumotlar server ichidagi `davomat.db` faylida (Docker `app_data` volume). Muntazam nusxa oling:

```bash
docker compose exec app node -e "new (require('node:sqlite').DatabaseSync)('/app/data/davomat.db').exec(\"VACUUM INTO '/app/data/backup.db'\")"
docker compose cp app:/app/data/backup.db ~/davomat-$(date +%F).db
docker compose exec app rm /app/data/backup.db
```

Yangilash: `git pull && docker compose up -d --build`

---

## Dasturchilar uchun

```bash
npm install
cp .env.example .env   # ADMIN_PASSWORD ni kiriting
npm start              # http://localhost:3000/admin
npm test
```

Node.js 22.13+ kerak (o'rnatilgan `node:sqlite` ishlatiladi).

| Fayl | Vazifasi |
|---|---|
| `src/server.js` | Ishga tushirish, `.env` o'qish |
| `src/app.js` | HTTP marshrutlar, terminal eventlarini qabul qilish (`POST /hik/:token/event`) |
| `src/hikvision.js` | Hikvision event formatini o'qish (multipart / JSON / XML) |
| `src/attendance.js` | Keldi/ketdi, kechikish, ishlagan vaqt, Telegram matnlari |
| `src/db.js` | SQLite jadvallar va so'rovlar |
| `src/telegram.js` | Telegram bot (xabar yuborish, `/start` → chat ID) |
| `src/admin/` | Admin panel sahifalari |
