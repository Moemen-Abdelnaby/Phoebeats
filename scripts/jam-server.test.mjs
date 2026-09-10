import test from 'node:test';
import assert from 'node:assert/strict';
import { createJamServer } from '../server/jam-server.mjs';

async function fixture(t) {
  const server = createJamServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, token) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const a = (await call('/rooms', { name: 'Alice' })).data;
  const path = `/rooms/${a.room.code}`;
  const b = (await call(path + '/join', { name: 'Bob' })).data;
  const command = async (body, token = a.token) => (await call(path + '/command', body, token));
  return { base, call, a, b, path, command };
}
const song = n => ({ title: `Song ${n}`, artist: 'Artist', duration: '3:00', url: `https://www.youtube.com/watch?v=track${n}` });

test('each person can change only their own nickname, including with host-only controls', async t => {
  const { command, a, b } = await fixture(t);
  await command({action:'add',tracks:[song(1)]},b.token);
  await command({action:'permissions',hostOnly:true});
  const r = (await command({action:'nickname',name:'  Moon  ',memberId:a.memberId},b.token)).data;
  assert.equal(r.members.find(m=>m.id===a.memberId).name,'Alice');
  assert.equal(r.members.find(m=>m.id===b.memberId).name,'Moon');
  assert.equal(r.shared[0].sharedBy,'Moon');
  assert.equal(r.queue[0].sharedBy,'Moon');
  for (const name of ['', '  ', 'a\nb', 'x'.repeat(41)]) assert.equal((await command({action:'nickname',name},b.token)).status,400);
});

test('private two-person rooms and authenticated access', async t => {
  const { call, path, a } = await fixture(t);
  assert.equal((await call(path)).status, 401);
  assert.equal((await call(path, undefined, 'wrong')).status, 401);
  assert.equal((await call(path + '/join', { name: 'Third' })).status, 400);
  assert.equal((await call(path, undefined, a.token)).data.members.length, 2);
});
test('playlist shuffle uses one order, restores order and waits for both players', async t => {
  const { command, a, b, call, path } = await fixture(t);
  let r = (await command({ action: 'play', tracks: [1, 2, 3, 4, 5].map(song), index: 0 })).data;
  assert.equal(r.current.title, 'Song 1'); assert.equal(r.playing, false); assert.equal(r.waiting, true);
  r = (await command({ action: 'ready', generation: r.generation })).data;
  assert.equal(r.playing, false);
  r = (await command({ action: 'ready', generation: r.generation }, b.token)).data;
  assert.equal(r.playing, true);
  r = (await command({ action: 'shuffle' }, b.token)).data;
  assert.equal(r.shuffle, true);
  assert.deepEqual(r.queue, (await call(path, undefined, a.token)).data.queue);
  assert.deepEqual(r.queue, (await call(path, undefined, b.token)).data.queue);
  assert.deepEqual(r.queue.map(t => t.title).sort(), [2, 3, 4, 5].map(n => `Song ${n}`));
  r = (await command({ action: 'shuffle' })).data;
  assert.deepEqual(r.queue.map(t => t.title), [2, 3, 4, 5].map(n => `Song ${n}`));
  assert.equal(r.current.title, 'Song 1');
});
test('both participants contribute; host-only controls and end events are enforced', async t => {
  const { command, b } = await fixture(t);
  let r = (await command({ action: 'play', tracks: [song(1), song(2)] })).data;
  await command({ action: 'ready', generation: r.generation });
  await command({ action: 'ready', generation: r.generation }, b.token);
  await command({ action: 'permissions', hostOnly: true });
  assert.equal((await command({ action: 'skip' }, b.token)).status, 400);
  assert.equal((await command({ action: 'add', tracks: [song(3)] }, b.token)).status, 200);
  assert.equal((await command({ action: 'permissions', hostOnly: false }, b.token)).status, 400);
  const generation = r.generation;
  r = (await command({ action: 'ended', generation })).data;
  assert.equal(r.current.title, 'Song 2');
  r = (await command({ action: 'ended', generation })).data;
  assert.equal(r.current.title, 'Song 2');
  assert.equal(r.shared[2].sharedBy, 'Bob');
});
test('shared local audio transfers both ways and rejects arbitrary paths and URLs', async t => {
  const { base, path, a, b, command } = await fixture(t);
  for (const participant of [a, b]) {
    const bytes = Buffer.from('test audio bytes');
    const upload = await fetch(base + path + '/files', { method: 'POST', headers: { Authorization: `Bearer ${participant.token}`, 'x-audio-extension': 'mp3' }, body: bytes });
    assert.equal(upload.status, 200);
    const file = await upload.json();
    const other = participant === a ? b : a;
    assert.equal((await command({ action: 'add', tracks: [{ ...song(1), fileKey: file.key }] }, other.token)).status, 400);
    const r = (await command({ action: 'add', tracks: [{ ...song(1), fileKey: file.key }] }, participant.token)).data;
    assert.equal(r.shared.at(-1).url, '');
    const downloaded = await fetch(base + path + '/files/' + file.key, { headers: { Authorization: `Bearer ${other.token}` } });
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal((await fetch(base + path + '/files/' + file.key)).status, 401);
  }
  for (const url of ['local://C:/private.txt', 'file:///etc/passwd', 'https://localhost/audio', 'http://www.youtube.com/a']) {
    assert.equal((await command({ action: 'play', tracks: [{ ...song(1), url }] })).status, 400);
  }
});
test('queue edits, repeat and leaving behave consistently', async t => {
  const { command, call, path, a, b } = await fixture(t);
  let r = (await command({ action: 'play', tracks: [1, 2, 3].map(song) })).data;
  r = (await command({ action: 'reorder', from: 0, to: 1 }, b.token)).data;
  assert.deepEqual(r.queue.map(t => t.title), ['Song 3', 'Song 2']);
  assert.equal((await command({ action: 'reorder', from: -1, to: 0 })).status, 400);
  r = (await command({ action: 'remove', index: 0 })).data;
  assert.equal(r.queue.length, 1);
  r = (await command({ action: 'repeat' })).data; assert.equal(r.repeat, 'all');
  r = (await command({ action: 'skip' })).data; assert.equal(r.current.title, 'Song 2');
  assert.equal(r.queue.at(-1).title, 'Song 1');
  r = (await command({ action: 'repeat' })).data; assert.equal(r.repeat, 'one');
  await command({ action: 'ready', generation: r.generation });
  await command({ action: 'ready', generation: r.generation }, b.token);
  r = (await command({ action: 'ended', generation: r.generation })).data; assert.equal(r.current.title, 'Song 2');
  r = (await command({ action: 'skip' })).data; assert.equal(r.current.title, 'Song 1');
  await call(path + '/leave', {}, b.token);
  assert.equal((await call(path, undefined, b.token)).status, 401);
  await call(path + '/leave', {}, a.token);
  assert.equal((await call(path + '/join', { name: 'Bob' })).status, 400);
});
