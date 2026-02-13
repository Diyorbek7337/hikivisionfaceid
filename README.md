# 📷 Hikvision DS-K1T342EX Face Recognition Integration

## 📋 Umumiy ma'lumot

Bu qo'llanma Hikvision DS-K1T342EX yuz aniqlash terminalini mavjud davomat tizimiga ulash uchun.

## 🔧 Tizim arxitekturasi

```
┌─────────────────────┐     HTTP Event      ┌─────────────────────┐
│   Hikvision         │ ─────────────────▶  │  Hikvision Bridge   │
│   DS-K1T342EX       │                     │  (Node.js Server)   │
└─────────────────────┘                     └──────────┬──────────┘
                                                       │
                                                       ▼
                                            ┌─────────────────────┐
                                            │     Firebase        │
                                            │    Firestore        │
                                            └──────────┬──────────┘
                                                       │
                              ┌─────────────────────────┼─────────────────────────┐
                              ▼                         ▼                         ▼
                    ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
                    │   Admin Panel   │      │  Telegram Bot   │      │    Xodimlar     │
                    └─────────────────┘      └─────────────────┘      │  (Notification) │
                                                                      └─────────────────┘
```

## 📦 O'rnatish

### 1-qadam: Bridge serverni o'rnatish

```bash
cd hikvision-bridge
npm install
cp .env.example .env
# .env faylini tahrirlang
```

### 2-qadam: .env sozlash

```env
PORT=3000
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
BOT_TOKEN=your_telegram_bot_token
ADMIN_TELEGRAM_IDS=123456789
HIKVISION_USERNAME=admin
HIKVISION_PASSWORD=your_password
```

### 3-qadam: Serverni ishga tushirish

```bash
npm start
```

Server `http://your-server-ip:3000` da ishga tushadi.

---

## 🔌 Hikvision Terminal Sozlash

### IVMS-4200 orqali sozlash

1. **IVMS-4200** dasturini oching
2. **Device Management** → Terminalingizni tanlang
3. **Remote Configuration** → **Network** → **Advanced**

### HTTP Event Push sozlash

1. **Event** → **HTTP Listening** bo'limiga kiring
2. Quyidagilarni kiriting:

| Parametr | Qiymat |
|----------|--------|
| **Listening Host Address** | `http://YOUR_SERVER_IP:3000` |
| **URL** | `/ISAPI/Event/notification/alertStream` |
| **Protocol** | HTTP |

3. **Authentication** (ixtiyoriy):
   - Username: `admin`
   - Password: `admin123`

### Terminal web interfeysi orqali

1. Brauzerda terminal IP manzilini oching: `http://TERMINAL_IP`
2. Login: admin / parol
3. **Configuration** → **Network** → **Advanced Settings** → **HTTP Listening**
4. Yuqoridagi parametrlarni kiriting

---

## 👤 Xodimlarni ro'yxatdan o'tkazish

### Hikvision terminalida

1. **IVMS-4200** → **Person Management**
2. **Add Person** bosing
3. Ma'lumotlarni kiriting:
   - **Employee No**: Unikal raqam (masalan: 001, 002)
   - **Name**: Xodim ismi
   - **Card No**: Karta raqami (ixtiyoriy)
4. **Face** bo'limida yuz rasmini qo'shing
5. **OK** bosing

### Admin panelda (Firebase)

1. **Xodimlar** sahifasini oching
2. Xodimni tahrirlang yoki yangi qo'shing
3. **Hikvision Face ID** bo'limida:
   - **Xodim ID**: Terminalda kiritilgan `Employee No`
   - **Karta raqami**: Agar karta ishlatilsa

⚠️ **Muhim**: Hikvision terminaldagi `Employee No` va Admin paneldagi `Xodim ID` **bir xil** bo'lishi shart!

---

## 🔄 Ishlash jarayoni

### Xodim kelganda:

```
1. Xodim terminalga yuzini ko'rsatadi
2. Terminal yuzni taniydi → Event yuboradi
3. Bridge server eventni qabul qiladi
4. Firebase'dan xodimni topadi
5. Davomatni qayd etadi (Check-in)
6. Xodimga Telegram xabar yuboradi
7. Agar kechikgan bo'lsa - adminga xabar yuboradi
```

### Xodim ketayotganda:

```
1. Xodim yana terminalga yuzini ko'rsatadi
2. Terminal → Bridge → Firebase
3. Check-out qayd etiladi
4. Ishlagan soat hisoblanadi
5. Telegram orqali xabar yuboriladi
```

---

## 📊 Davomat yozuvi (Firebase)

```javascript
{
  date: "2024-01-15",
  employeeId: "abc123",
  employeeName: "Aziz Karimov",
  
  // Check-in
  checkIn: Timestamp,
  checkInMethod: "face_recognition",
  checkInDevice: "Hikvision Terminal",
  checkInPhoto: "https://...", // Agar terminal rasm yuborsa
  
  // Kechikish
  isLate: false,
  lateMinutes: 0,
  
  // Check-out
  checkOut: Timestamp,
  checkOutMethod: "face_recognition",
  checkOutDevice: "Hikvision Terminal",
  
  // Ishlagan vaqt
  workedHours: 8.5,
  
  // Erta ketish
  isEarlyLeave: false,
  earlyMinutes: 0
}
```

---

## 🔐 Xavfsizlik

### API autentifikatsiyasi

Bridge server Basic Auth qo'llab-quvvatlaydi:

```
Authorization: Basic base64(username:password)
```

### Firewall sozlash

Faqat Hikvision terminal IP dan kelgan so'rovlarga ruxsat bering:

```bash
# iptables misol
iptables -A INPUT -p tcp -s TERMINAL_IP --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp --dport 3000 -j DROP
```

---

## 🧪 Test qilish

### 1. Bridge server tekshirish

```bash
curl http://localhost:3000/
# Javob: {"status":"OK","service":"Hikvision Face Recognition Bridge",...}
```

### 2. Test event yuborish

```bash
curl -X POST http://localhost:3000/ISAPI/Event/notification/alertStream \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "AccessControllerEvent",
    "AccessControllerEvent": {
      "employeeNoString": "001",
      "name": "Test User"
    }
  }'
```

### 3. Terminal eventini kuzatish

```bash
# Server loglarida:
📥 ISAPI Event keldi
👤 Yuz aniqlandi: Aziz Karimov
✅ Aziz Karimov: checkin
```

---

## 🚨 Muammolarni hal qilish

### Terminal ulanmayapti

1. Tarmoq ulanishini tekshiring: `ping SERVER_IP`
2. Port ochiqligini tekshiring: `telnet SERVER_IP 3000`
3. Terminal sozlamalarini qayta tekshiring

### Xodim topilmayapti

1. Admin panelda `Xodim ID` to'g'ri kiritilganini tekshiring
2. Hikvision terminaldagi `Employee No` bilan solishturing
3. Bridge server loglarini tekshiring

### Event kelmayapti

1. Terminal web interfeysi → **Event** → **HTTP Listening** yoqilganini tekshiring
2. Server IP to'g'ri kiritilganini tekshiring
3. Firewall sozlamalarini tekshiring

---

## 📱 Telegram xabarlari

### Check-in (o'z vaqtida):
```
✅ Kelganingiz qayd etildi!

👤 Aziz Karimov
🕐 Vaqt: 08:55
📷 Yuz orqali tasdiqlangan

✅ O'z vaqtida!
```

### Check-in (kechikish):
```
✅ Kelganingiz qayd etildi!

👤 Aziz Karimov
🕐 Vaqt: 09:15
📷 Yuz orqali tasdiqlangan

⚠️ Kechikish: 10 daqiqa
```

### Check-out:
```
✅ Ketganingiz qayd etildi!

👤 Aziz Karimov
🕐 Vaqt: 18:05
⏱ Ishlagan: 9.17 soat
📷 Yuz orqali tasdiqlangan
💰 Bugun: 229,250 so'm
```

---

## 🌐 Production deployment

### Railway/Render da deploy

1. GitHub ga push qiling
2. Railway/Render da yangi servis yarating
3. Environment variables qo'shing
4. Deploy

### Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name hikvision.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 📞 Qo'shimcha yordam

- Hikvision ISAPI dokumentatsiyasi: [https://www.hikvision.com/en/support/download/sdk/](https://www.hikvision.com/en/support/download/sdk/)
- IVMS-4200 qo'llanmasi: Terminal bilan birga keladi
#   h i k i v i s i o n f a c e i d  
 