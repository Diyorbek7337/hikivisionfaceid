'use strict';
/**
 * Firestore access for the bridge. Keeps live in-memory copies of employees, devices and settings
 * (onSnapshot), so recognising a face does not cost a database read.
 *
 * Collections (see firebase/firestore.rules and web/src/lib):
 *   employees/{id}        employeeNo, name, workStart, workEnd, hourlyRate, active, deleted, hasFace,
 *                         version, deviceSync.{deviceId} = { version, status, message, at }
 *   employeeFaces/{id}    image (base64 JPEG)
 *   devices/{id}          name, ip, port, username, password, direction, online, model, ...
 *   attendance/{employeeId}_{date}
 *   events/{key}
 *   settings/general      lateGraceMinutes, debounceSeconds, autoTimeSync
 *   system/bridge         ips, port, heartbeatAt
 *   admins/{uid}          users allowed to use the web app
 */
const { EventEmitter } = require('node:events');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { DEFAULT_SETTINGS } = require('./config');

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  return new Date(v);
}

class FirestoreStore extends EventEmitter {
  constructor(db, auth) {
    super();
    this.db = db;
    this.auth = auth;
    this.FieldValue = FieldValue;
    this.employees = new Map();
    this.devices = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.unsubs = [];
    let resolveReady;
    this.ready = new Promise((r) => { resolveReady = r; });
    this.resolveReady = resolveReady;
  }

  start() {
    const loaded = { employees: false, devices: false, settings: false };
    const markLoaded = (k) => {
      loaded[k] = true;
      if (Object.values(loaded).every(Boolean)) this.resolveReady();
    };
    const onError = (what) => (err) => console.error(`❌ Firestore (${what}) tinglashda xato:`, err.message);

    this.unsubs.push(this.db.collection('employees').onSnapshot((snap) => {
      this.employees = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      markLoaded('employees');
      this.emit('employees');
    }, onError('employees')));

    this.unsubs.push(this.db.collection('devices').onSnapshot((snap) => {
      this.devices = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      markLoaded('devices');
      this.emit('devices');
    }, onError('devices')));

    this.unsubs.push(this.db.collection('settings').doc('general').onSnapshot((doc) => {
      this.settings = { ...DEFAULT_SETTINGS, ...(doc.exists ? doc.data() : {}) };
      markLoaded('settings');
      this.emit('settings');
    }, onError('settings')));
  }

  stop() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  // ---------- lookups used by attendance ----------
  async findEmployeeByNo(no) {
    await this.ready;
    for (const e of this.employees.values()) {
      if (!e.deleted && String(e.employeeNo) === String(no)) return e;
    }
    return null;
  }

  async getAttendance(employeeId, date) {
    const doc = await this.db.collection('attendance').doc(`${employeeId}_${date}`).get();
    if (!doc.exists) return null;
    const d = doc.data();
    return { ...d, checkIn: toDate(d.checkIn), checkOut: toDate(d.checkOut) };
  }

  async saveAttendance(rec) {
    const data = { ...rec, updatedAt: this.FieldValue.serverTimestamp() };
    for (const k of Object.keys(data)) if (data[k] === undefined) data[k] = null;
    await this.db.collection('attendance').doc(`${rec.employeeId}_${rec.date}`).set(data, { merge: true });
  }

  // ---------- events ----------
  async eventExists(key) {
    return (await this.db.collection('events').doc(key).get()).exists;
  }

  async saveEvent(key, data) {
    await this.db.collection('events').doc(key).set({ ...data, receivedAt: this.FieldValue.serverTimestamp() });
  }

  async pruneEvents(days = 60) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    for (;;) {
      const snap = await this.db.collection('events').where('receivedAt', '<', cutoff).limit(300).get();
      if (snap.empty) return;
      const batch = this.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  // ---------- sync helpers ----------
  async getFace(employeeId) {
    const doc = await this.db.collection('employeeFaces').doc(employeeId).get();
    if (!doc.exists || !doc.data().image) return null;
    const b64 = String(doc.data().image).replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(b64, 'base64');
  }

  async setEmployeeSync(employeeId, deviceId, data) {
    await this.db.collection('employees').doc(employeeId)
      .update(new FieldPath('deviceSync', deviceId), data)
      .catch((err) => { if (err.code !== 5) throw err; }); // 5 = NOT_FOUND (employee removed meanwhile)
  }

  async updateDevice(deviceId, data) {
    await this.db.collection('devices').doc(deviceId).set(data, { merge: true });
  }

  async setBridgeStatus(data) {
    await this.db.collection('system').doc('bridge').set({
      ...data, heartbeatAt: this.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  /** Gives web-app access to the users listed in ADMIN_EMAILS. */
  async ensureAdmins(emails) {
    for (const email of emails) {
      try {
        const user = await this.auth.getUserByEmail(email);
        await this.db.collection('admins').doc(user.uid).set({ email, addedBy: 'bridge' }, { merge: true });
        console.log(`👤 Admin: ${email}`);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          console.warn(`⚠️  ${email} Firebase Authentication'da topilmadi — avval Firebase Console → Authentication → Add user orqali yarating.`);
        } else {
          console.warn(`⚠️  Admin ${email}:`, err.message);
        }
      }
    }
  }
}

module.exports = { FirestoreStore, toDate };
