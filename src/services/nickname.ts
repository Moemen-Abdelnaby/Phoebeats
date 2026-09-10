const key = 'pb_jamName';
const changed = 'phoebeats-nickname-changed';

export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name && Array.from(name).length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : '';
}

export function readNickname(): string {
  try { return normalizeNickname(JSON.parse(window.localStorage.getItem(key) || 'null')); }
  catch { return ''; }
}

export function saveNickname(value: string): string {
  const name = normalizeNickname(value);
  if (!name) throw Error('Choose a nickname with 1–40 characters.');
  try { window.localStorage.setItem(key, JSON.stringify(name)); }
  catch { throw Error('Your nickname could not be saved on this device. Please try again.'); }
  window.dispatchEvent(new Event(changed));
  return name;
}

export function subscribeNickname(onChange: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) onChange(); };
  window.addEventListener(changed, onChange);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, onChange);
    window.removeEventListener('storage', storage);
  };
}
