'use strict';
const express = require('express');
const views = require('./views');
const { localDate, localTime, parseHHMM } = require('../time');
const { salaryFor } = require('../attendance');
const { lanAddresses } = require('../net');

function createAdminRouter({ repo, cfg, auth }) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '100kb' }));

  r.get('/login', (req, res) => res.send(views.loginPage()));
  r.post('/login', (req, res) => {
    const result = auth.login(req, res, req.body.username || '', req.body.password || '');
    if (result === 'ok') return res.redirect('/admin');
    const msg = result === 'blocked'
      ? 'Juda ko\'p noto\'g\'ri urinish. 15 daqiqadan keyin qayta urinib ko\'ring.'
      : (cfg.adminPassword ? 'Login yoki parol noto\'g\'ri' : 'ADMIN_PASSWORD sozlanmagan (.env)');
    return res.status(401).send(views.loginPage(msg));
  });

  r.use(auth.middleware);

  r.post('/logout', (req, res) => { auth.logout(res); res.redirect('/admin/login'); });

  // ---------- Dashboard ----------
  r.get('/', (req, res) => {
    const date = localDate(new Date(), cfg.timezone);
    const rows = repo.listEmployees().map((emp) => ({ emp, att: repo.getAttendance(emp.id, date) }));
    res.send(views.dashboardPage({ date, rows, tz: cfg.timezone, devices: repo.listDevices() }));
  });

  // ---------- Employees ----------
  r.get('/employees', (req, res) => {
    res.send(views.employeesPage({ employees: repo.listEmployees({ includeInactive: true }) }));
  });
  r.get('/employees/new', (req, res) => {
    res.send(views.employeeFormPage({
      employee: { employee_no: req.query.employee_no || '', name: req.query.name || '', active: 1 },
    }));
  });
  r.get('/employees/:id', (req, res) => {
    const employee = repo.getEmployee(Number(req.params.id));
    if (!employee) return res.redirect('/admin/employees');
    return res.send(views.employeeFormPage({ employee }));
  });
  r.post('/employees/:id', (req, res) => {
    const id = req.params.id === 'new' ? null : Number(req.params.id);
    const b = req.body;
    const employee = {
      id,
      name: String(b.name || '').trim(),
      employee_no: String(b.employee_no || '').trim(),
      position: String(b.position || '').trim(),
      phone: String(b.phone || '').trim(),
      telegram_chat_id: String(b.telegram_chat_id || '').trim(),
      work_start: String(b.work_start || '').trim(),
      work_end: String(b.work_end || '').trim(),
      hourly_rate: Math.max(0, Math.round(Number(b.hourly_rate) || 0)),
      active: b.active ? 1 : 0,
    };
    let error = null;
    if (!employee.name || !employee.employee_no) error = 'Ism va Terminal ID majburiy';
    else if (parseHHMM(employee.work_start) == null || parseHHMM(employee.work_end) == null) error = 'Ish vaqti noto\'g\'ri (HH:MM)';
    else if (employee.telegram_chat_id && !/^-?\d+$/.test(employee.telegram_chat_id)) error = 'Telegram chat ID faqat raqamlardan iborat bo\'lishi kerak';
    else {
      const other = repo.getEmployeeByNo(employee.employee_no);
      if (other && other.id !== id) error = `Terminal ID "${employee.employee_no}" allaqachon ${other.name} ga berilgan`;
    }
    if (error) return res.status(400).send(views.employeeFormPage({ employee, error }));
    repo.saveEmployee(employee);
    return res.redirect('/admin/employees');
  });
  r.post('/employees/:id/delete', (req, res) => {
    repo.deleteEmployee(Number(req.params.id));
    res.redirect('/admin/employees');
  });

  // ---------- Devices ----------
  r.get('/devices', (req, res) => {
    // Without PUBLIC_URL (e.g. running on an office PC) show this computer's local network address.
    const lan = lanAddresses()[0];
    const publicUrl = cfg.publicUrl || (lan ? `http://${lan}:${cfg.port}` : '');
    res.send(views.devicesPage({
      devices: repo.listDevices(), publicUrl, tz: cfg.timezone, isLanFallback: !cfg.publicUrl && !!lan,
    }));
  });
  r.get('/devices/new', (req, res) => res.send(views.deviceFormPage({ device: { direction: 'in' } })));
  r.get('/devices/:id', (req, res) => {
    const device = repo.getDevice(Number(req.params.id));
    if (!device) return res.redirect('/admin/devices');
    return res.send(views.deviceFormPage({ device }));
  });
  r.post('/devices/:id', (req, res) => {
    const name = String(req.body.name || '').trim() || 'Terminal';
    const direction = ['in', 'out', 'auto'].includes(req.body.direction) ? req.body.direction : 'auto';
    repo.saveDevice({ id: req.params.id === 'new' ? null : Number(req.params.id), name, direction });
    res.redirect('/admin/devices');
  });
  r.post('/devices/:id/token', (req, res) => {
    repo.regenerateDeviceToken(Number(req.params.id));
    res.redirect('/admin/devices');
  });
  r.post('/devices/:id/delete', (req, res) => {
    repo.deleteDevice(Number(req.params.id));
    res.redirect('/admin/devices');
  });

  // ---------- Attendance report ----------
  function reportData(query) {
    const today = localDate(new Date(), cfg.timezone);
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isDate(query.from) ? query.from : `${today.slice(0, 8)}01`;
    const to = isDate(query.to) ? query.to : today;
    const employeeId = query.employee ? Number(query.employee) : null;
    const records = repo.listAttendance({ from, to, employeeId });
    const byEmp = new Map();
    for (const rec of records) {
      const s = byEmp.get(rec.employee_id) || { name: rec.employee_name, days: 0, lateCount: 0, lateMinutes: 0, workedMinutes: 0, pay: 0 };
      if (rec.check_in_at) s.days += 1;
      if (rec.late_minutes > 0) { s.lateCount += 1; s.lateMinutes += rec.late_minutes; }
      s.workedMinutes += rec.worked_minutes || 0;
      s.pay += salaryFor(rec, rec);
      byEmp.set(rec.employee_id, s);
    }
    const summary = [...byEmp.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { from, to, employeeId, records, summary };
  }

  r.get('/attendance', (req, res) => {
    const data = reportData(req.query);
    res.send(views.attendancePage({
      ...data, employees: repo.listEmployees({ includeInactive: true }), tz: cfg.timezone,
    }));
  });

  r.get('/attendance.csv', (req, res) => {
    const { from, to, records } = reportData(req.query);
    const t = (iso) => (iso ? localTime(new Date(iso), cfg.timezone) : '');
    const cell = (v) => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['Sana', 'Xodim', 'Terminal ID', 'Keldi', 'Ketdi', 'Kechikish (daq)', 'Erta ketish (daq)', 'Ishlagan (soat)', 'Summa (so\'m)']];
    for (const rec of [...records].reverse()) {
      lines.push([
        rec.date, rec.employee_name, rec.employee_no, t(rec.check_in_at), t(rec.check_out_at),
        rec.late_minutes || 0, rec.early_minutes || 0,
        rec.worked_minutes != null ? (rec.worked_minutes / 60).toFixed(2) : '',
        Math.round(salaryFor(rec, rec)),
      ]);
    }
    const csv = `﻿${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="davomat_${from}_${to}.csv"`);
    res.send(csv);
  });

  r.post('/attendance/:id/delete', (req, res) => {
    repo.deleteAttendance(Number(req.params.id));
    let back = '/admin/attendance';
    try {
      const ref = new URL(req.get('referer') || '', 'http://x');
      if (ref.pathname === '/admin/attendance') back = ref.pathname + ref.search;
    } catch { /* ignore */ }
    res.redirect(back);
  });

  // ---------- Events ----------
  r.get('/events', (req, res) => {
    res.send(views.eventsPage({ events: repo.listEvents(200), tz: cfg.timezone }));
  });

  return r;
}

module.exports = { createAdminRouter };
