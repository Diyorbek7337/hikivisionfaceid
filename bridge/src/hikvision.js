'use strict';
/**
 * Hikvision "HTTP Listening" (alarm host) event parsing.
 *
 * DS-K1T342 series terminals POST events as multipart/form-data: a JSON (or XML on older firmware)
 * part usually named "event_log" plus an optional JPEG snapshot. Some firmwares send the JSON/XML
 * directly as the request body. We accept all of these.
 */
const { XMLParser } = require('fast-xml-parser');

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });

function boundaryOf(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  return m ? (m[1] || m[2]) : null;
}

function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing "--"
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    else if (buf[start] === 0x0a) start += 1;
    const next = buf.indexOf(delim, start);
    let part = buf.subarray(start, next === -1 ? buf.length : next);

    let sep = part.indexOf('\r\n\r\n');
    let sepLen = 4;
    if (sep === -1) { sep = part.indexOf('\n\n'); sepLen = 2; }
    if (sep !== -1) {
      const headers = {};
      for (const line of part.subarray(0, sep).toString('latin1').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      let body = part.subarray(sep + sepLen);
      if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
        body = body.subarray(0, body.length - 2);
      } else if (body.length >= 1 && body[body.length - 1] === 0x0a) {
        body = body.subarray(0, body.length - 1);
      }
      const nameMatch = /name="([^"]*)"/i.exec(headers['content-disposition'] || '');
      parts.push({
        name: nameMatch ? nameMatch[1] : '',
        contentType: headers['content-type'] || '',
        body,
      });
    }
    pos = next;
  }
  return parts;
}

/** Parses a JSON or XML text into an object, or returns null. */
function parseText(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) return null;
  if (t[0] === '{') {
    try {
      return JSON.parse(t);
    } catch {
      const end = t.lastIndexOf('}');
      try { return JSON.parse(t.slice(0, end + 1)); } catch { return null; }
    }
  }
  if (t[0] === '<') {
    try {
      const obj = xml.parse(t);
      // Root is usually <EventNotificationAlert>
      return obj.EventNotificationAlert || obj[Object.keys(obj).find((k) => k !== '?xml')] || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Extracts the raw event object from an HTTP request body. */
function extractEvent(body, contentType) {
  if (!body || !body.length) return null;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const boundary = /multipart\//i.test(contentType || '') ? boundaryOf(contentType) : null;
  if (boundary) {
    for (const p of parseMultipart(buf, boundary)) {
      if (/^image\//i.test(p.contentType)) continue;
      const obj = parseText(p.body.toString('utf8'));
      if (obj && typeof obj === 'object') return obj;
    }
    return null;
  }
  return parseText(buf.toString('utf8'));
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes a raw event to the fields we use.
 * subEventType 75 = face authentication passed, 1 = valid card, 38 = fingerprint passed, etc.
 */
function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const eventType = String(raw.eventType || '');
  const ace = raw.AccessControllerEvent || {};
  const employeeNo = String(ace.employeeNoString ?? ace.employeeNo ?? '').trim();
  const time = raw.dateTime ? new Date(raw.dateTime) : null;
  return {
    eventType,
    isHeartbeat: /heartbeat/i.test(eventType),
    isAccess: /AccessControllerEvent/i.test(eventType) || !!raw.AccessControllerEvent,
    time: time && !Number.isNaN(time.getTime()) ? time : null,
    ip: raw.ipAddress ? String(raw.ipAddress) : null,
    mac: raw.macAddress ? String(raw.macAddress) : null,
    employeeNo: employeeNo || null,
    name: ace.name ? String(ace.name) : null,
    major: num(ace.majorEventType),
    minor: num(ace.subEventType),
    serialNo: num(ace.serialNo),
    verifyMode: ace.currentVerifyMode ? String(ace.currentVerifyMode) : null,
  };
}

module.exports = { extractEvent, normalizeEvent, parseMultipart, boundaryOf };
