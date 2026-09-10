import { useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Track, RepeatMode } from '../types';
import { loadLS, saveLS } from '../utils';
import { connectJamBridge, JamAction } from '../services/jamBridge';
import { JamMode, makeJamInvite, parseJamInvite } from '../services/jamInvite';
import { saveNickname } from '../services/nickname';

export type SharedSong = Track & { jamId: string; fileKey?: string; ext?: string; owner: string; sharedBy: string };
export type JamRoom = { code: string; host: string; members: { id: string; name: string }[]; queue: SharedSong[]; current: SharedSong | null; shared: SharedSong[]; playing: boolean; position: number; shuffle: boolean; repeat: RepeatMode; hostOnly: boolean; revision: number; generation: number; waiting: boolean };
type Session = { server: string; code: string; token: string; memberId: string; hostId?: string; publicServer?: string; mode?: JamMode };
type Connection = { token: string; memberId: string; room: JamRoom; server?: string; publicServer?: string; hostId?: string; mode?: JamMode };
export type JamHistory = { code: string; date: string; songs: SharedSong[] };
type Player = {
  play: (track: Track) => Promise<void>;
  setPlaying: (playing: boolean) => void;
  setShuffle: (shuffle: boolean) => void;
  setRepeat: (repeat: RepeatMode) => void;
  setQueue: (tracks: Track[]) => void;
  getQueue: () => Track[];
  getPreferences: () => { shuffle: boolean; repeat: RepeatMode };
};

export function useJam(player: Player, toast: (message: string) => void) {
  const [room, setRoom] = useState<JamRoom | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<JamHistory[]>(() => loadLS('pb_jamHistory', []));
  const [saved, setSaved] = useState<Record<string, Track>>(() => loadLS('pb_jamSaved', {}));
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const refs = useRef({ player, toast }); refs.current = { player, toast };
  const active = useRef<Session | null>(null);
  const latest = useRef<JamRoom | null>(null);
  const generation = useRef(-1);
  const lastEnded = useRef(-1);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const uploads = useRef(new Map<string, SharedSong>());
  const saving = useRef(new Map<string, Promise<Track>>());
  const personal = useRef<{ queue: Track[]; shuffle: boolean; repeat: RepeatMode } | null>(null);
  const connecting = useRef(false);

  const request = <T,>(s: Session, path = '', body?: unknown) => invoke<T>('jam_request', { server: s.server, path: `rooms/${s.code}${path}`, token: s.token, body: body ?? null });
  function archive(r: JamRoom) {
    setHistory(prev => {
      const next = [{ code: r.code, date: new Date().toISOString(), songs: r.shared }, ...prev.filter(h => h.code !== r.code)].slice(0, 20);
      saveLS('pb_jamHistory', next); return next;
    });
  }
  function detach() {
    const s = active.current;
    if (s?.hostId) void invoke('jam_host_stop', { hostId: s.hostId }).catch(() => {});
    active.current = null; connectJamBridge(null); setSession(null); setRoom(null); latest.current = null; generation.current = -1;
    void invoke('pause_audio').catch(() => {}); refs.current.player.setPlaying(false);
    if (personal.current) { refs.current.player.setQueue(personal.current.queue); refs.current.player.setShuffle(personal.current.shuffle); refs.current.player.setRepeat(personal.current.repeat); personal.current = null; }
  }
  async function materialize(song: SharedSong, s: Session, save: boolean): Promise<Track> {
    if (!song.fileKey) return song;
    const path = await invoke<string>('jam_download', { ...s, key: song.fileKey, ext: song.ext, save });
    return { ...song, url: `local://${path}` };
  }
  async function apply(r: JamRoom, s: Session) {
    if (active.current !== s) return;
    const old = latest.current;
    latest.current = r; setRoom(r);
    refs.current.player.setShuffle(r.shuffle); refs.current.player.setRepeat(r.repeat);
    refs.current.player.setQueue(r.queue.map(t => ({ ...t, url: t.url || `jam://${t.jamId}` })));
    if (old?.revision !== r.revision) archive(r);
    let started = performance.now();
    let loaded = false;
    if (r.current && generation.current !== r.generation) {
      setStatus(`Loading ${r.current.title}…`);
      const track = await materialize(r.current, s, false);
      if (active.current !== s) return;
      await refs.current.player.play(track);
      if (active.current !== s) { await invoke('pause_audio'); return; }
      // Loading the native player is asynchronous even after loadfile is accepted.
      // Wait for its new duration before telling the room that this player is ready.
      const deadline = performance.now() + 20000;
      while (true) {
        const state = await invoke<{ duration: number; eof_reached: boolean }>('get_playback_state');
        if (active.current !== s) return;
        if (state.duration > 0 && !state.eof_reached) break;
        if (performance.now() >= deadline) throw Error('The song could not load. Skip it or try another track.');
        await new Promise(resolve => window.setTimeout(resolve, 150));
      }
      generation.current = r.generation;
      loaded = true;
    }
    if (r.current && (loaded || r.waiting)) {
      r = await request<JamRoom>(s, '/command', { action: 'ready', generation: r.generation });
      if (active.current !== s) return;
      started = performance.now(); latest.current = r; setRoom(r);
      if (generation.current !== r.generation) return;
    }
    if (active.current !== s) return;
    if (r.current) {
      const state = await invoke<{ position: number; paused: boolean }>('get_playback_state');
      const target = r.position + (r.playing ? (performance.now() - started) / 1000 : 0);
      if (Math.abs(state.position - target) > 1.2 || old?.generation !== r.generation) await invoke('seek_audio', { time: target });
      await invoke(r.playing ? 'resume_audio' : 'pause_audio');
    } else await invoke('pause_audio');
    refs.current.player.setPlaying(r.playing); setStatus(r.waiting ? 'Waiting for everyone to load the song…' : 'Connected');
  }
  function enqueue(work: () => Promise<void>) {
    chain.current = chain.current.catch(() => {}).then(work).catch(error => { setStatus(String(error)); refs.current.toast(String(error)); });
  }
  function command(action: JamAction) {
    const s = active.current; if (!s) return;
    if (action.action === 'leave') { leave(); return; }
    const endedGeneration = generation.current;
    if (action.action === 'ended') {
      if (!latest.current?.playing || latest.current.generation !== endedGeneration || lastEnded.current === endedGeneration || latest.current.host !== s.memberId) return;
      lastEnded.current = endedGeneration;
    }
    enqueue(async () => {
      if (active.current !== s) return;
      if (action.action === 'ended' && latest.current?.host !== s.memberId) return;
      setBusy(true);
      try {
        const tracks: SharedSong[] = [];
        for (const track of action.tracks || []) {
          const shared = latest.current?.shared.find(t => t.jamId === (track as SharedSong).jamId);
          if (shared) { tracks.push(shared); continue; }
          if (!track.url.startsWith('local://')) { tracks.push(track as SharedSong); continue; }
          let uploaded = uploads.current.get(track.url);
          if (!uploaded) {
            setStatus(`Sharing ${track.title}…`);
            const file = await invoke<{ key: string; ext: string }>('jam_upload', { ...s, path: track.url.slice(8) });
            uploaded = { ...track, url: '', fileKey: file.key, ext: file.ext, jamId: '', owner: s.memberId, sharedBy: '' };
            uploads.current.set(track.url, uploaded);
          }
          tracks.push(uploaded);
        }
        if (active.current !== s) return;
        const next = await request<JamRoom>(s, '/command', { ...action, tracks: action.tracks ? tracks : undefined, generation: endedGeneration });
        if (action.action === 'nickname' && action.name) saveNickname(action.name);
        await apply(next, s);
      } catch (error) {
        if (action.action === 'ended') lastEnded.current = -1;
        throw error;
      } finally { setBusy(false); }
    });
    return chain.current;
  }
  async function attach(result: Connection, server: string, name: string, mode?: JamMode) {
      const s: Session = { server, code: result.room.code, token: result.token, memberId: result.memberId, hostId: result.hostId, publicServer: result.publicServer || server, mode: result.mode || mode };
      personal.current = { queue: [...refs.current.player.getQueue()], ...refs.current.player.getPreferences() };
      active.current = s; uploads.current.clear(); generation.current = -1; lastEnded.current = -1; latest.current = null;
      setSession(s); connectJamBridge(command); await apply(result.room, s);
      saveNickname(name);
  }
  async function join(server: string, name: string, code?: string, mode?: JamMode) {
    if (active.current || connecting.current) return;
    connecting.current = true;
    setBusy(true); setStatus('Connecting…');
    try {
      name = saveNickname(name);
      const result = await invoke<Connection>('jam_request', { server, path: code ? `rooms/${code.trim().toUpperCase()}/join` : 'rooms', token: null, body: { name } });
      await attach(result,server,name,mode);
    } catch (error) { setStatus(String(error)); refs.current.toast(String(error)); }
    finally { connecting.current = false; setBusy(false); }
  }
  async function start(mode: JamMode, name: string) {
    if (active.current || connecting.current) return;
    connecting.current = true; setBusy(true);
    setStatus(mode === 'internet' ? 'Preparing Internet Jam...' : 'Starting Local Jam…');
    let result: Connection | undefined;
    try {
      name = saveNickname(name);
      const onProgress = new Channel<string>();
      let receiving = true;
      onProgress.onmessage = message => { if (receiving) setStatus(message); };
      try {
        result = await invoke<Connection>('jam_host_start', { mode, name: name.trim(), onProgress });
      } finally { receiving = false; }
      await attach(result,result.server!,name,mode);
    } catch (error) {
      if (result?.hostId) { detach(); await invoke('jam_host_stop',{hostId:result.hostId}).catch(() => {}); }
      setStatus(String(error)); refs.current.toast(String(error));
    } finally { connecting.current = false; setBusy(false); }
  }
  async function joinInvite(invite: string, name: string, mode: JamMode) {
    try { const {server,code} = parseJamInvite(invite,mode); await join(server,name,code,mode); }
    catch (error) { setStatus(String(error)); refs.current.toast(String(error)); }
  }
  function rename(name: string) {
    const trimmed = name.trim();
    if (!trimmed || [...trimmed].length > 40 || /[\u0000-\u001f\u007f]/.test(trimmed)) { refs.current.toast('Choose a nickname with 1–40 characters.'); return; }
    return command({action:'nickname',name:trimmed});
  }
  function leave() {
    const s = active.current; if (!s) return;
    if (latest.current) archive(latest.current);
    detach(); setStatus('Left Jam');
    void request(s, '/leave', {}).catch(() => {});
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false; let pending = false; let failures = 0;
    const poll = () => {
      if (stopped || pending) return;
      pending = true;
      enqueue(async () => {
        try {
          if (active.current !== session) return;
          if (session.hostId && !await invoke<boolean>('jam_host_status',{hostId:session.hostId})) throw Error('Your hosted connection stopped. End this Jam and start it again.');
          const next = await request<JamRoom>(session); await apply(next, session); failures = 0;
        } catch (error) {
          if (active.current !== session) return;
          failures++; setStatus(`Retrying Jam: ${String(error)}`);
          await invoke('pause_audio').catch(() => {}); refs.current.player.setPlaying(false);
          if (failures >= 5 || String(error).includes('expired')) { detach(); setStatus('Disconnected. Join again to resume.'); }
        } finally { pending = false; }
      });
    };
    const timer = window.setInterval(poll, 750);
    // Keep membership alive even while the ordered playback work awaits a large file.
    const heartbeat = window.setInterval(() => { if (active.current === session) void request(session).catch(() => {}); }, 10000);
    return () => { stopped = true; window.clearInterval(timer); window.clearInterval(heartbeat); };
  }, [session]);
  useEffect(() => () => { const s = active.current; if (s?.hostId) void invoke('jam_host_stop',{hostId:s.hostId}).catch(() => {}); active.current = null; connectJamBridge(null); }, []);
  function saveSong(song: SharedSong): Promise<Track> {
    if (saved[song.jamId]) return Promise.resolve(saved[song.jamId]);
    const pending = saving.current.get(song.jamId); if (pending) return pending;
    const work = (async () => {
      setDownloads(d => ({ ...d, [song.jamId]: 'Downloading…' }));
      try {
        const s = active.current;
        if (song.fileKey && (!s || !latest.current?.shared.some(t => t.jamId === song.jamId))) throw Error('Unavailable — ask your friend to share this song in a new Jam.');
        const track = song.fileKey ? await materialize(song, s!, true) : song;
        setSaved(prev => { const next = { ...prev, [song.jamId]: track }; saveLS('pb_jamSaved', next); return next; });
        setDownloads(d => ({ ...d, [song.jamId]: 'Saved' })); return track;
      } catch (error) { setDownloads(d => ({ ...d, [song.jamId]: String(error) })); throw error; }
      finally { saving.current.delete(song.jamId); }
    })();
    saving.current.set(song.jamId, work); return work;
  }
  return { room, memberId: session?.memberId, hosting: !!session?.hostId, mode: session?.mode, invite: session ? makeJamInvite(session.publicServer || session.server,session.code) : '', busy, status, history, saved, downloads, join, start, joinInvite, rename, leave, command, saveSong };
}
