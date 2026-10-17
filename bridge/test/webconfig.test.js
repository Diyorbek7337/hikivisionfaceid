'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseWebConfig } = require('../src/webconfig');

test('accepts JSON and the Firebase Console snippet', () => {
  assert.deepEqual(parseWebConfig('{"apiKey":"a","projectId":"p"}'), { apiKey: 'a', projectId: 'p' });
  const snippet = `// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSy-abc",
  authDomain: 'davomat.firebaseapp.com',
  projectId: "davomat",
  storageBucket: "davomat.firebasestorage.app",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
};`;
  const c = parseWebConfig(snippet);
  assert.equal(c.apiKey, 'AIzaSy-abc');
  assert.equal(c.authDomain, 'davomat.firebaseapp.com');
  assert.equal(c.appId, '1:123:web:abc');
});
