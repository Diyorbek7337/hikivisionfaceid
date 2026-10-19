# 📷 Face ID davomat tizimi

Maktab, korxona va tashkilotlar uchun Hikvision yuz tanish terminallari (DS-K1T331W, DS-K1T342 va shu turdagilar)
bilan ishlaydigan davomat tizimi. **Hamma narsa tashkilotning o'z kompyuterida ishlaydi** — internet yoki chet el
serverlari kerak emas, ma'lumotlar tashkilot ichida qoladi.

**Imkoniyatlar**

- 📄 Xodimlarni **Excel'dan import** qilish (F.I.Sh., lavozim, telefon).
- 📷 **Yuzlarni kiritish**: ro'yxatdan tanlab, kompyuter yoki telefon kamerasi bilan rasmga olish.
  Xodim va yuzi **terminallarga avtomatik yoziladi** — terminalga qo'lda kirish shart emas.
- 🕐 **Ish jadvallari**: smenalar, hafta kunlari bo'yicha har xil vaqt, dam olish kunlari; xodimning
  **shaxsiy jadvali** (faqat o'z kunlari keladiganlar uchun) va **erkin jadval** (kechikish/kelmaganlik yo'q).
- ✅ Terminalda yuz ko'rsatilsa — **keldi/ketdi**, kechikish, erta ketish, ishlagan soat hisoblanadi.
  Bir kunda **bir necha marta kelib-ketish** alohida hisoblanadi (08:00–10:00 + 14:00–16:00 = 4 soat).
- 💰 To'lov: **soatbay**, **kunbay** yoki **har bir kelish uchun (darsbay)**.
- 👦 **O'quvchilar**: sinflar bo'yicha davomat, **sinf rahbari** o'z sinfining yuzlarini o'zi kiritadi,
  **ota-onalarga Telegram**'da "farzandingiz maktabga keldi / chiqdi" xabari.
- 🚪 **Elektron eshik**: yuz tanilganda terminal eshikni o'zi ochadi; web ilovadan **"Eshikni ochish"** tugmasi;
  xodimlarga **vaqt bo'yicha kirish ruxsati** (masalan, faqat Du–Sh 07:00–19:00).
- 📊 **Bugun** sahifasi (jonli), **hisobot** (kelgan/kelmagan kunlar, kechikishlar), Excel'ga yuklab olish,
  unutilgan skanni qo'lda tuzatish.
- 🤖 **Telegram**: direktorga har kuni ertalab "kim keldi / kechikdi / kelmadi" hisoboti (ixtiyoriy).
- 💾 Har kuni **avtomatik zaxira nusxa**.

```
 Maktab tarmog'i (router)
 ┌──────────────┐        ┌───────────────────────────────┐
 │ Terminal 1   │◀──────▶│  Server kompyuter             │◀── brauzer: http://localhost:3000
 └──────────────┘        │  (doim yoqiq)                 │◀── boshqa kompyuter / telefon:
 ┌──────────────┐        │  • baza (data\davomat.db)     │     http://192.168.x.x:3000
 │ Terminal 2   │◀──────▶│  • web sahifalar              │
 └──────────────┘        │  • terminallar bilan aloqa    │──▶ Telegram (ixtiyoriy)
                         └───────────────────────────────┘
```

---

## 1. Server kompyuterni tayyorlash

Talablar: Windows 10/11, 4 GB RAM, doim yoqiq turadi, terminallar bilan **bitta tarmoqda** (bitta routerga ulangan).

1. **Node.js** o'rnating: https://nodejs.org → **LTS** versiya (22 yoki yangiroq).
2. Loyiha papkasini kompyuterga ko'chiring, masalan `C:\davomat`.
3. `firewall-ochish.bat` → o'ng tugma → **Run as administrator** (bir marta). Bu terminallar va boshqa kompyuterlarga tizimga ulanishga ruxsat beradi.
4. `start-windows.bat` ni ikki marta bosing.
   - Birinchi marta paketlar o'rnatiladi va web sahifalar yig'iladi (internet kerak, 2–5 daqiqa).
   - Brauzer ochiladi → **Birinchi sozlash**: tashkilot nomi, administrator login va paroli.
   - **Qora oynani yopmang** — u tizimning o'zi.
   - Port: birinchi ishga tushganda `3000` (band bo'lsa keyingi bo'sh port) tanlanadi va **doimiy** bo'lib qoladi —
     terminallar shu portga sozlanadi. Tizim allaqachon ochiq bo'lsa, ikkinchi oyna yangi nusxa ochmaydi.
     Portni aniq belgilash uchun: `server\.env.example` ni `server\.env` nomi bilan nusxalab, `PORT=3001` kabi yozing.

Muhim sozlamalar:

- **Doimiy IP**: routerda server kompyuterga doimiy IP bering (DHCP reservation). Terminallar shu IP ga ulanadi.
- **Uyqu rejimi**: Settings → System → Power → Sleep → **Never**.
- **Avtomatik ishga tushish**: `Win + R` → `shell:startup` → ochilgan papkaga `start-windows.bat` yorlig'ini (shortcut) qo'ying.
- **UPS** (uzluksiz quvvat manbai) tavsiya etiladi.

Boshqa kompyuter yoki telefondan kirish: brauzerda `http://<server IP>:3000` (qora oynada ko'rsatiladi).

---

## 2. Terminallarni ulash

### 2.1. Terminal IP manzilini bilish

Hikvision **SADP Tool** dasturi terminallarni tarmoqdan topadi va IP ini ko'rsatadi. Terminal "Inactive" bo'lsa —
o'sha yerda admin parol qo'yib aktivlashtiring.

### 2.2. Tizimga terminal qo'shish

**Terminallar → + Terminal qo'shish**:

| Maydon | Qiymat |
|---|---|
| Nomi | `Asosiy kirish` |
| IP manzil | terminal IP si, masalan `192.168.1.64` |
| Login / Parol | terminal web sahifasining `admin` login/paroli |
| Yo'nalish | Kirish/chiqish uchun alohida terminallar bo'lsa — **Kirish** va **Chiqish**; bitta terminal bo'lsa — **Avtomatik** |

Bir necha soniyada **✓ ulangan** chiqadi. Tizim terminal soatini ham avtomatik to'g'rilaydi.

### 2.3. Terminalda HTTP Listening (eventlarni yuborish)

Terminal web sahifasi (`http://<terminal IP>`) → **Configuration → Network → Advanced → HTTP Listening**.
Tizimdagi **Terminallar** sahifasida "Terminalda sozlash" ni oching va bo'sh qatorga yozing:

| Maydon | Qiymat |
|---|---|
| Destination IP or Host Name | server kompyuter IP si |
| URL | `/hik/…/event` (tizim ko'rsatadi) |
| Port | tizim porti (odatda `3000`, Terminallar sahifasida ko'rsatilgan) |
| Protocol | `HTTP` |

→ **Save**. Agar keyinchalik tizim porti o'zgarsa (qora oynada ogohlantirish chiqadi), terminaldagi Port ni ham yangilang.

---

## 3. Xodimlar

### 3.1. Ish jadvallari

**Jadvallar** sahifasi: standart "Asosiy jadval" (Du–Sh 08:00–17:00) bor. Kerak bo'lsa qo'shing:
"1-smena", "2-smena", "Ma'muriyat" va h.k. Har kun uchun alohida vaqt yoki dam olish belgilanadi.

Faqat ma'lum kunlari yoki soatlarda keladigan xodimlar (o'qituvchilar, repetitorlar) uchun har biriga
alohida jadval yaratish shart emas — **Xodimlar → Tahrirlash → Ish jadvali**:

| Tanlov | Qachon | Nima hisoblanadi |
|---|---|---|
| **Umumiy jadval** | ko'pchilik xodimlar | Jadvallar sahifasidagi jadval bo'yicha |
| **Shaxsiy kunlar va soatlar** | masalan, faqat Du 08:00–12:00 va Pa 14:00–16:00 | Faqat shu kunlar ish kuni; boshqa kunlari kelmasa — "kelmagan" emas |
| **Erkin** | kerak bo'lganda keladi | Kechikish, erta ketish, "kelmagan" yo'q — faqat kelgan kunlari, soatlari va summasi |

"Erkin" turini umumiy jadvalga ham berish mumkin (Jadvallar → jadval → **Erkin**).

**Bir kunda bir necha marta kelib-ketish.** Har bir "keldi → ketdi" juftligi alohida hisoblanadi:
08:00–10:00 va 14:00–16:00 bo'lsa, ishlagan vaqt 4 soat (oradagi vaqt qo'shilmaydi). Kechikish birinchi
kelishdan, erta ketish oxirgi ketishdan hisoblanadi. Chiqishda (yoki kirishda) skan qilinmagan kelib-ketish
hisobotda **sariq** bilan belgilanadi va ishlagan vaqtga qo'shilmaydi — **Tahrirlash** orqali to'g'rilanadi.
Bitta terminal "Avto" rejimida bo'lsa, skanlar navbat bilan "keldi", "ketdi", "keldi"... deb olinadi.

**To'lov.** Xodim kartasida: **Soatbay** (ishlagan vaqtiga), **Kunbay** (har kelgan kuni uchun bir marta) yoki
**Har bir kelish uchun** (darsbay: kuniga 2 marta kelsa — 2 baravar). Stavka o'zgarsa, oldingi kunlar eski
stavka bilan qoladi — yangisi keyingi kundan (aniqrog'i, xodimning keyingi birinchi skanidan) qo'llanadi.

### 3.2. Excel'dan import

**Xodimlar → Excel'dan import** → `.xlsx` faylni tanlang. Ustunlar avtomatik aniqlanadi:
**F.I.Sh.** (yoki alohida **Familiya**, **Ism**, **Otasining ismi**), **Lavozim**, **Telefon**.
Tekshirib, jadvalni tanlab, **Import qilish**. Har bir xodimga ID avtomatik beriladi.

### 3.3. Yuzlarni kiritish

**Yuzlar** sahifasi: chapda rasmi yo'q xodimlar. Xodimni tanlang → **Rasmga olish** → **Saqlash** — keyingisi
avtomatik tanlanadi. 150 kishi uchun ~1–1.5 soat.

- Server kompyuterda kamera bo'lsa — to'g'ridan-to'g'ri ishlaydi.
- **Telefondan**: telefonni maktab Wi-Fi siga ulang → `http://<server IP>:3000` → Yuzlar → "Rasm yuklash / telefon kamerasi".
- Rasm talablari: yuz to'g'ridan, yorug' joyda, ko'zoynak/niqobsiz, orqa fon oddiy, rasmda bitta odam.

Xodimlar ro'yxatida har terminal ustunida: **✓** — terminalga yozildi, **⏳** — yuborilmoqda,
**✗** — xato (masalan "Rasmda yuz aniq ko'rinmayapti" — boshqa rasm oling).

Xodim ishdan ketsa: **Tahrirlash → "Faol" belgisini olib tashlang** — u terminallardan o'chiriladi, tarixi saqlanadi.

---

## 3.4. O'quvchilar (maktab)

O'quvchilar xodimlar bilan bir xil terminallardan o'tadi; tizimda ular alohida bo'limda, sinflar bo'yicha.

1. **Xodimlar → 👦 O'quvchilar → Excel'dan import.** Faylda **F.I.Sh.** (yoki Familiya, Ism) va **Sinf** ustuni
   (9-A, 9 a, 9-а — hammasi "9-A" bo'ladi). Har bir sinf alohida faylda bo'lsa — sinfni importda yozasiz.
   O'quvchilar uchun ish jadvali (smena) importda tanlanadi.
2. **Sinf rahbarlari:** Sozlamalar → Foydalanuvchilar → huquq **"Sinf rahbari"**, sinflari (masalan `9-A, 9-B`).
   Sinf rahbari telefonda maktab Wi-Fi'siga ulanib `http://<server IP>:3001` ni ochadi, o'z login-paroli bilan kiradi va
   faqat o'z sinfini ko'radi: **Yuzlar** (📷 Rasmga olish → Saqlash → keyingi bola), **Bugun**, **Hisobot**, **Ota-onalar**.
   Xodimlar, terminallar, sozlamalar va davomatni o'zgartirish unga yopiq.
3. **Ota-onalar rozilik** bermagan bolaning yuzini kiritmang (yozma rozilik maktabda saqlanadi).

**Bugun** sahifasida O'quvchilar bo'limi: sinflar jadvali (keldi / kechikdi / kelmadi) — sinfni bossangiz, o'sha sinf ro'yxati.
Kunlik Telegram hisobotda o'quvchilar faqat son bilan; o'quvchi kechiksa direktorga alohida xabar ketmaydi.

### Ota-onalarga Telegram xabar

Har bir o'quvchining maxfiy **kodi** bor. **Ota-onalar** sahifasida sinfni tanlab, **🖨 Chop etish** — har bir bolaga
QR kodli varaqa (A4 ga 12 ta). Varaqani qirqib, bola orqali uyiga yuborasiz.

Ota-ona QR kodni telefon kamerasi bilan ochadi → Telegram bot → **START** (yoki botga kodni yozib yuboradi). Shundan keyin:
`✅ Farzandingiz Aliyev Jasur (9-A) maktabga keldi — 07:52` · `👋 … maktabdan chiqdi — 13:15`.
Bir nechta farzand bo'lsa — har birining kodini yuboradi. Botda: `/farzandlarim` (hozir maktabdami), `/uzish`.

- Kim hali ulanmaganini Ota-onalar sahifasida ("Faqat hali ulanmaganlar") va o'quvchilar ro'yxatida ko'rasiz.
- Kod begonaning qo'liga tushsa: o'quvchi kartasi → **Ota-onalarni uzish** → **Yangi kod** → yangi varaqa.
- Xabarlarni o'chirish: Sozlamalar → "Ota-onalarga … xabar yuborish".

---

## 4. Kundalik ish

- **Bugun** — kim keldi, kechikdi, kelmadi (kartochkani bossangiz — shu ro'yxat filtrlanadi).
- **Hisobot** — sana oralig'i bo'yicha: ish kunlari, kelgan/kelmagan kunlar, kechikishlar, ishlagan soat.
  **Excel (CSV)** tugmasi bilan yuklab olinadi. Xodim skan qilishni unutsa — **Tahrirlash** (kunning barcha
  kelib-ketishlari, har biri alohida qatorda) yoki **+ Qo'lda qo'shish** (faqat yetishmagan vaqtni kiriting).
- **Eventlar** — terminallardan kelgan har bir skan (sozlashda tekshirish uchun).

---

## 4.1. Elektron eshik (ixtiyoriy)

Terminalning **Lock** chiqishiga elektron qulf ulansa (magnit qulf yoki zashyolka, alohida 12V blok pitaniya,
ichkaridan **Exit** tugmasi), yuz tanilganda terminal eshikni o'zi ochadi — kompyuter o'chiq bo'lsa ham.
Eshik necha soniya ochiq turishi terminal web sahifasida: **Access Control → Door Parameters**.
Xavfsizlik uchun ichkariga **Secure Door Control Unit** (masalan DS-K2M061) qo'yish tavsiya etiladi; magnit qulf
tok o'chganda ochiladigan turda bo'lsin.

- **Eshikni web ilovadan ochish** — **Terminallar** sahifasida (va **Bugun** sahifasidagi terminallar ro'yxatida):
  **🔓 Eshikni ochish** (bir marta), **Doimiy ochiq** (masalan, tadbir paytida), **Odatiy holat** (doimiy ochiqni bekor qilish).
  Kim qachon ochgani **Eventlar** sahifasida yoziladi.
- **Vaqt bo'yicha kirish ruxsati** — **Jadvallar → 🚪 Eshikdan kirish ruxsati** → masalan "Ish vaqtida: Du–Sh 07:00–19:00".
  Keyin **Xodimlar → Tahrirlash → Eshikdan kirish** da tanlanadi. Tanlanmagan xodim istalgan vaqtda kiradi.
  Cheklov faqat **Kirish** va **Avtomatik** terminallarga yoziladi; **Chiqish** terminali hammani istalgan vaqtda chiqaradi.
  Bu faqat eshikka ta'sir qiladi — davomat hisobi ish jadvali bo'yicha qoladi.
  Agar terminal ruxsat jadvallarini qabul qilmasa (eski proshivka), Terminallar sahifasida ogohlantirish chiqadi
  va u terminalda hamma istalgan vaqtda kira oladi.

---

## 5. Telegram (ixtiyoriy)

1. Telegram'da **@BotFather** → `/newbot` → token oling.
2. `server\.env.example` ni `server\.env` nomi bilan nusxalang, `BOT_TOKEN=` ga tokenni yozing.
3. Botga `/start` yozing — bot chat ID ingizni aytadi. Uni `ADMIN_TELEGRAM_IDS=` ga yozing (bir nechta bo'lsa vergul bilan).
4. Tizimni qayta ishga tushiring. **Sozlamalar** sahifasida kunlik hisobot vaqtini tanlang (standart 09:30).
5. Xodimlarga ham xabar borsin desangiz: xodim botga `/start` yozadi → chat ID sini xodim kartasiga kiritasiz.

Rahbar/HR uchun bot buyruqlari: `/bugun`, `/kelmaganlar`, `/kechikkanlar`.

## 5.1. Telefondan ko'rish (Telegram mini ilova)

Rahbar yoki HR istalgan joydan, Telegram ichida davomatni ko'radi: **Kunlik** (kim keldi / kechikdi /
kelmadi / ichkarida, istalgan kun) va **Hisobot** (shu hafta, shu oy, o'tgan oy: kim necha kun kelmagan va
necha marta kechikkan — xodimni bossangiz sanalari chiqadi). Telefonda kartochkalar, kompyuterdagi Telegram'da
jadval ko'rinishida. **Faqat ko'rish** — hech narsani o'zgartirib bo'lmaydi.

Ma'lumotlar maktab kompyuterida qoladi. Telegram ilovani ochishi uchun kompyuterga internetdan **HTTPS manzil**
kerak — buni bepul **Tailscale Funnel** beradi. Bu manzil orqali **faqat mini ilova** ochiladi: admin panel,
terminallar va boshqa hamma narsa faqat maktab tarmog'ida qoladi.

1. Server kompyuterga **Tailscale** o'rnating: https://tailscale.com/download → Windows → o'rnatib, akkaunt bilan kiring.
2. **Administrator sifatida** cmd oching va yozing:
   ```
   tailscale funnel --bg 3001
   ```
   (3001 — tizim porti.) Birinchi marta brauzerda HTTPS va Funnel'ni yoqish so'raladi — tasdiqlang.
   Oxirida manzil chiqadi, masalan `https://maktab-pc.tail1234.ts.net`.
3. `server\.env` ga yozing (BOT_TOKEN va ADMIN_TELEGRAM_IDS 5-bo'limdagidek):
   ```
   PUBLIC_URL=https://maktab-pc.tail1234.ts.net
   ```
   va tizimni qayta ishga tushiring. Qora oynada `📱 Telegram mini ilova: …/tg/` chiqadi.
4. Rahbar/HR botga `/start` yozadi → bot ID raqamini aytadi → siz uni **Sozlamalar → 📱 Telefondan ko'ruvchilar** ga qo'shasiz.
5. U yana `/start` yozadi → **"📊 Davomatni ochish"** tugmasi chiqadi (chap pastdagi "Davomat" menyusi ham).

Kimnidir ro'yxatdan olib tashlasangiz, ruxsati darhol yopiladi.

**Sizga (administratorga) masofadan to'liq kirish:** telefoningiz yoki noutbukingizga ham Tailscale o'rnatib,
xuddi shu akkaunt bilan kiring. Keyin `http://<server kompyuterning 100.x.x.x manzili>:3001` ochiladi — maktabdagidek
to'liq admin panel (bu manzil faqat sizning qurilmalaringizga ko'rinadi). Server manzilini Tailscale ilovasida ko'rasiz.

---

## 6. Zaxira nusxa va yangilash

- Baza: `server\data\davomat.db`. Har kuni nusxasi `server\data\backups` ga olinadi (30 kun saqlanadi).
  `zaxira-nusxa.bat` shu papkani ochadi — vaqti-vaqti bilan fleshkaga ko'chirib qo'ying.
  **Sozlamalar → Hozirgi bazani yuklab olish** ham mumkin.
- Tiklash: tizimni to'xtating, nusxani `server\data\davomat.db` nomi bilan qo'ying, qayta ishga tushiring.
- Yangi versiya: yangi fayllarni ko'chiring (`server\data` papkasiga tegmang) → `yangilash.bat` → `start-windows.bat`.

---

## Muammolarni hal qilish

| Belgi | Yechim |
|---|---|
| Brauzerda sahifa ochilmayapti | Qora oyna (start-windows.bat) ishlayaptimi? |
| Terminal "✗ ulanmagan" | Serverdan `ping <terminal IP>`; login/parol to'g'rimi? `terminal-tekshirish.bat` ni ishga tushirib, natijasini ko'ring. Parol xato bo'lsa terminal kompyuterni ~30 daqiqaga bloklashi mumkin — to'g'ri parolni kiritib, kuting. |
| Skan qilinsa ham "Bugun"da chiqmayapti | Terminalda HTTP Listening; `firewall-ochish.bat`; **Eventlar** sahifasi. |
| Eventlarda "Xodim topilmadi" | Terminalda tizimda yo'q odam bor — Terminallar → 🔄 Qayta yuborish. |
| Xodim yonida "✗ …" | Xato matnini o'qing (ko'pincha rasm sifati) — yangi rasm oling. |
| Telefondan kamera ochilmayapti | "Rasm yuklash / telefon kamerasi" tugmasi telefon kamerasini ochadi. |
| Parol esdan chiqdi | Boshqa administrator Sozlamalar → Foydalanuvchilar'da yangilaydi. |

---

## Dasturchilar uchun

```bash
cd server && npm install && npm test     # testlar (soxta terminal bilan)
cd web && npm install && npm run build   # web sahifalar -> web/out
cd server && npm start                    # http://localhost:3000
# web ustida ishlash: server ishlab turganda `cd web && npm run dev` (http://localhost:3001, /api serverga proksi qilinadi)
```

| Fayl | Vazifasi |
|---|---|
| `server/src/index.js` | Ishga tushirish |
| `server/src/db.js`, `store.js` | SQLite baza (Node.js `node:sqlite`) |
| `server/src/api.js`, `auth.js` | Web sahifalar uchun API, login |
| `server/src/server.js` | Terminal eventlarini qabul qilish (`POST /hik/:deviceId/event`) |
| `server/src/hikvision.js` | Event formatini o'qish (multipart / JSON / XML) |
| `server/src/attendance.js`, `summary.js` | Keldi/ketdi, kechikish, kelmagan kunlar |
| `server/src/isapi.js` | Terminal ISAPI (digest auth): xodim, yuz, soat |
| `server/src/sync.js`, `monitor.js` | Xodimlarni terminallarga yozish, terminal holati |
| `server/src/report.js`, `telegram.js` | Telegram kunlik hisobot va xabarlar |
| `server/src/backup.js` | Kunlik zaxira nusxa |
| `web/src/app/*` | Web sahifalar (Next.js, statik eksport) |
