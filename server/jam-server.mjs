import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const id = () => randomBytes(18).toString('hex');
const MAX_FILE = 100 * 1024 * 1024;
const shuffle = list => {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export function createJamServer() {
  const rooms = new Map();
  const limits = new Map();
  let uploadingBytes = 0;
  function snapshot(r) {
    return { code: r.code, host: r.host, members: [...r.members.values()].map(m => ({ id: m.id, name: m.name })),
      queue: r.queue, current: r.current, shared: r.shared, playing: r.playing,
      position: r.position + (r.playing ? (Date.now() - r.at) / 1000 : 0),
      shuffle: r.shuffle, repeat: r.repeat, hostOnly: r.hostOnly, revision: r.revision, generation: r.generation, waiting: r.waiting };
  }
  function buffer(r) { r.waiting = !!r.current; r.ready = new Set(); r.playing = false; }
  function readyToPlay(r) {
    if (r.waiting && [...r.members.values()].every(m => r.ready.has(m.id))) { r.waiting = false; r.playing = true; r.at = Date.now(); r.revision++; }
  }
  function advance(r, ended = false) {
    if (ended && r.repeat === 'one' && r.current) { r.position = 0; r.at = Date.now(); r.generation++; buffer(r); return; }
    if (r.repeat === 'all' && r.current) r.queue.push(r.current);
    r.current = r.queue.shift() || null;
    r.position = 0; r.at = Date.now(); r.playing = !!r.current; r.generation++;
    buffer(r);
  }
  const timer = setInterval(() => {
    for (const [code, r] of rooms) {
      for (const [token, m] of r.members) if (Date.now() - m.seen > 45000) r.members.delete(token);
      if (!r.members.size) { rooms.delete(code); continue; }
      if (![...r.members.values()].some(m => m.id === r.host)) r.host = r.members.values().next().value.id;
      readyToPlay(r);
    }
    for (const [ip, l] of limits) if (Date.now() - l.at > 60000) limits.delete(ip);
  }, 10000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && parts.join('/') === 'health') return send(200, { ok: true });
      let r, member;
      if (parts[0] === 'rooms' && parts[1] && parts[2] !== 'join') {
        r = rooms.get(parts[1]); member = r?.members.get(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!member) return send(401, { error: 'Jam expired or access denied. Join again.' });
        member.seen = Date.now();
      }
      if (r && parts[2] === 'files') {
        if (req.method === 'POST') {
          if (r.bytes >= 500 * 1024 * 1024) return send(413, { error: 'Room storage is full.' });
          const ext = String(req.headers['x-audio-extension'] || '').toLowerCase();
          if (!/^(mp3|flac|wav|ogg|opus|m4a|aac|wma|aiff)$/.test(ext)) throw Error('Unsupported audio file.');
          const chunks = []; let size = 0;
          try {
            for await (const chunk of req) {
              const stored = [...rooms.values()].reduce((sum, room) => sum + room.bytes, 0);
              if (stored + uploadingBytes + chunk.length > 1024 * 1024 * 1024) throw Error('Server storage is full. Try again later.');
              size += chunk.length; uploadingBytes += chunk.length;
              if (size > MAX_FILE) throw Error('Files must be under 100 MB.');
              chunks.push(chunk);
            }
            if (!rooms.has(r.code) || ![...r.members.values()].includes(member)) throw Error('Jam expired during upload.');
            if (r.bytes + size > 500 * 1024 * 1024) throw Error('Room storage is full.');
            const key = id();
            r.files.set(key, { bytes: Buffer.concat(chunks), ext, owner: member.id }); r.bytes += size;
            return send(200, { key, ext });
          } finally { uploadingBytes -= size; }
        }
        if (req.method === 'GET') {
          const file = r.files.get(parts[3]); if (!file) return send(404, { error: 'File unavailable.' });
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.bytes.length }); return res.end(file.bytes);
        }
      }
      if (r && req.method === 'GET' && parts.length === 2) return send(200, snapshot(r));
      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('Request too large.'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (parts[0] === 'rooms' && (parts.length === 1 || parts[2] === 'join')) {
        const ip = req.socket.remoteAddress;
        const limit = limits.get(ip) || { at: Date.now(), count: 0 }; limits.set(ip, limit);
        if (++limit.count > 30) return send(429, { error: 'Too many attempts. Try again in a minute.' });
        if (parts.length === 1) {
          if (rooms.size >= 100) throw Error('Server is full.');
          let code; do { code = randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(code));
          r = { code, members: new Map(), files: new Map(), bytes: 0, queue: [], original: [], shared: [], current: null,
            position: 0, at: Date.now(), playing: false, shuffle: false, repeat: 'off', hostOnly: false, revision: 0, generation: 0, waiting: false, ready: new Set() };
          rooms.set(code, r);
        } else r = rooms.get(parts[1]);
        if (!r) throw Error('Jam not found. Check the invite code.');
        if (r.members.size >= 2) throw Error('This Jam already has two people.');
        const token = id(); member = { id: id(), name: String(body.name || 'Listener').slice(0, 40), seen: Date.now() };
        r.members.set(token, member); r.host ||= member.id;
        return send(200, { token, memberId: member.id, room: snapshot(r) });
      }
      if (!r) return send(404, { error: 'Not found' });
      if (parts[2] === 'leave') {
        r.members.delete(req.headers.authorization.replace(/^Bearer /, ''));
        if (!r.members.size) rooms.delete(r.code);
        else { if (r.host === member.id) r.host = r.members.values().next().value.id; readyToPlay(r); }
        return send(200, {});
      }
      if (parts[2] !== 'command') return send(404, { error: 'Not found' });
      const action = body.action;
      if (action === 'nickname') {
        const name = String(body.name || '').trim();
        if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('Choose a nickname with 1–40 characters.');
        member.name = name;
        for (const song of [...r.shared, ...r.queue, ...(r.current ? [r.current] : [])]) if (song.owner === member.id) song.sharedBy = name;
        r.revision++; return send(200,snapshot(r));
      }
      if (action === 'ready') { if (body.generation === r.generation) { r.ready.add(member.id); readyToPlay(r); } return send(200, snapshot(r)); }
      if (action === 'permissions' && member.id !== r.host) throw Error('Only the host can change permissions.');
      if (r.hostOnly && member.id !== r.host && !['add', 'next'].includes(action)) throw Error('Only the host can control playback.');
      const tracks = () => {
        if (!Array.isArray(body.tracks) || body.tracks.length > 500) throw Error('Choose up to 500 songs.');
        const additions = [];
        const list = body.tracks.map(t => {
          const existing = r.shared.find(s => s.jamId === t.jamId);
          if (existing) return existing;
          if (t.fileKey) { if (r.files.get(t.fileKey)?.owner !== member.id) throw Error('File was not shared by you.'); }
          else { const u = new URL(t.url); if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'music.youtube.com', 'youtu.be'].includes(u.hostname)) throw Error('Only YouTube tracks or shared audio files are supported.'); }
          const duplicate = [...r.shared, ...additions].find(s => s.owner === member.id && (t.fileKey ? s.fileKey === t.fileKey : s.url === t.url));
          if (duplicate) return duplicate;
          const item = { id: 0, jamId: id(), title: String(t.title || 'Untitled').slice(0, 250), artist: String(t.artist || '').slice(0, 250), duration: String(t.duration || '0:00').slice(0, 20), cover: '',
            url: t.fileKey ? '' : t.url, fileKey: t.fileKey, ext: t.fileKey ? r.files.get(t.fileKey).ext : undefined, owner: member.id, sharedBy: member.name };
          additions.push(item); return item;
        });
        if (r.shared.length + additions.length > 2000 || (action === 'play' ? 0 : r.queue.length) + list.length > 1000) throw Error('Jam song limit reached. Clear the queue or start a new room.');
        r.shared.push(...additions); return list;
      };
      if (action === 'play') {
        const list = tracks(); const index = Math.max(0, Math.min(Number(body.index) || 0, list.length - 1));
        r.current = list[index] || null; r.original = list; r.queue = list.slice(index + 1);
        if (r.shuffle) r.queue = shuffle(list.filter((_, i) => i !== index));
        r.position = 0; r.at = Date.now(); r.playing = !!r.current; r.generation++;
        buffer(r);
      } else if (action === 'add' || action === 'next') {
        const list = tracks(); r.original = [...new Set([...r.original, ...list])]; r.queue = action === 'next' ? [...list, ...r.queue] : [...r.queue, ...list];
      } else if (action === 'toggle') { r.waiting = false; r.position = snapshot(r).position; r.at = Date.now(); r.playing = !!r.current && !r.playing; }
      else if (action === 'seek') { if (!Number.isFinite(body.position) || body.position < 0) throw Error('Invalid position.'); r.position = body.position; r.at = Date.now(); }
      else if (action === 'skip') advance(r);
      else if (action === 'ended') { if (member.id === r.host && r.playing && body.generation === r.generation) advance(r, true); }
      else if (action === 'back') { r.position = 0; r.at = Date.now(); r.generation++; }
      else if (action === 'shuffle') {
        r.shuffle = !r.shuffle;
        r.queue = r.shuffle ? shuffle(r.queue) : [...r.queue].sort((a, b) => r.original.indexOf(a) - r.original.indexOf(b));
      } else if (action === 'repeat') r.repeat = r.repeat === 'off' ? 'all' : r.repeat === 'all' ? 'one' : 'off';
      else if (action === 'permissions') r.hostOnly = !!body.hostOnly;
      else if (action === 'clear') r.queue = [];
      else if (action === 'remove') r.queue = r.queue.filter((_, i) => i !== body.index);
      else if (action === 'reorder') {
        if (!Number.isInteger(body.from) || !Number.isInteger(body.to) || body.from < 0 || body.to < 0 || body.from >= r.queue.length || body.to >= r.queue.length) throw Error('Invalid queue position.');
        const [item] = r.queue.splice(body.from, 1); r.queue.splice(body.to, 0, item);
      } else throw Error('Unknown command.');
      r.revision++; return send(200, snapshot(r));
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  server.on('close', () => clearInterval(timer));
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  createJamServer().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Jam service listening on port ${port}`));
}
