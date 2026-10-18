'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractEvent, normalizeEvent } = require('../src/hikvision');

const sample = {
  ipAddress: '192.168.1.50', portNo: 80, protocol: 'HTTP', macAddress: 'aa:bb:cc:dd:ee:ff',
  dateTime: '2026-01-15T08:55:12+05:00', eventType: 'AccessControllerEvent',
  AccessControllerEvent: {
    deviceName: 'Access Controller', majorEventType: 5, subEventType: 75, name: 'Aziz Karimov',
    employeeNoString: '001', serialNo: 1234, currentVerifyMode: 'cardOrFace',
  },
};

function multipart(jsonText, withImage = true) {
  const b = 'MIME_boundary';
  const chunks = [
    `--${b}\r\nContent-Disposition: form-data; name="event_log"\r\nContent-Type: application/json\r\nContent-Length: ${jsonText.length}\r\n\r\n${jsonText}\r\n`,
  ];
  if (withImage) {
    chunks.push(`--${b}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  }
  const parts = [Buffer.from(chunks.join(''))];
  if (withImage) parts.push(Buffer.from([0xff, 0xd8, 0x7b, 0x00, 0xff, 0xd9]), Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}

test('parses multipart event_log with picture', () => {
  const { body, contentType } = multipart(JSON.stringify(sample));
  const ev = normalizeEvent(extractEvent(body, contentType));
  assert.equal(ev.employeeNo, '001');
  assert.equal(ev.name, 'Aziz Karimov');
  assert.equal(ev.minor, 75);
  assert.equal(ev.serialNo, 1234);
  assert.equal(ev.time.toISOString(), '2026-01-15T03:55:12.000Z');
  assert.equal(ev.isAccess, true);
});

test('parses plain JSON body', () => {
  const ev = normalizeEvent(extractEvent(Buffer.from(JSON.stringify(sample)), 'application/json'));
  assert.equal(ev.employeeNo, '001');
});

test('parses XML body and keeps leading zeros', () => {
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<ipAddress>192.168.1.51</ipAddress><dateTime>2026-01-15T18:05:00+05:00</dateTime>
<eventType>AccessControllerEvent</eventType>
<AccessControllerEvent><majorEventType>5</majorEventType><subEventType>75</subEventType>
<name>Ali</name><employeeNoString>007</employeeNoString><serialNo>9</serialNo></AccessControllerEvent>
</EventNotificationAlert>`;
  const ev = normalizeEvent(extractEvent(Buffer.from(xmlBody), 'application/xml'));
  assert.equal(ev.employeeNo, '007');
  assert.equal(ev.major, 5);
  assert.equal(ev.ip, '192.168.1.51');
});

test('heartbeat is recognised', () => {
  const ev = normalizeEvent(extractEvent(Buffer.from('{"eventType":"heartBeat","dateTime":"2026-01-15T08:00:00+05:00"}'), 'application/json'));
  assert.equal(ev.isHeartbeat, true);
});

test('UTF-8 names survive multipart parsing', () => {
  const s = { ...sample, AccessControllerEvent: { ...sample.AccessControllerEvent, name: 'Ғайрат Шукуров' } };
  const { body, contentType } = multipart(JSON.stringify(s), false);
  assert.equal(normalizeEvent(extractEvent(body, contentType)).name, 'Ғайрат Шукуров');
});

test('garbage returns null', () => {
  assert.equal(extractEvent(Buffer.from('hello'), 'text/plain'), null);
});

test('form-encoded and wrapped payloads are understood', () => {
  const json = JSON.stringify({ eventType: 'AccessControllerEvent', AccessControllerEvent: { employeeNoString: '5', majorEventType: 5, subEventType: 75 } });
  const form = `event_log=${encodeURIComponent(json)}`;
  assert.equal(normalizeEvent(extractEvent(Buffer.from(form), 'application/x-www-form-urlencoded')).employeeNo, '5');
  assert.equal(normalizeEvent(extractEvent(Buffer.from(`junk\r\n${json}\r\n`), 'text/plain')).employeeNo, '5');
});
