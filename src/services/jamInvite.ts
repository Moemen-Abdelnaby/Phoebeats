export type JamMode = 'local' | 'internet';
export function makeJamInvite(server: string, code: string) {
  return `${server.replace(/\/$/, '')}/#jam=${code}`;
}
export function parseJamInvite(value: string, mode: JamMode) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw Error('Paste the full invite your friend copied from their Jam.'); }
  const code = new URLSearchParams(url.hash.slice(1)).get('jam') || '';
  if (!/^[a-f0-9]{10}$/i.test(code) || url.pathname !== '/' || url.search || url.username || url.password) throw Error('That invite is incomplete or invalid. Ask your friend to copy it again.');
  if (mode === 'internet' && url.protocol !== 'https:') throw Error('This is a Local invite. Choose Local to join it.');
  if (mode === 'local' && url.protocol !== 'http:') throw Error('This is an Internet invite. Choose Internet to join it.');
  return { server: url.origin, code: code.toUpperCase() };
}
