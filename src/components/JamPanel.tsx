import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Radio, X, Copy, Download, ListPlus } from 'lucide-react';
import { useJam, SharedSong } from '../hooks/useJam';
import { Playlist, Track } from '../types';
import { useNickname } from '../hooks/useNickname';
import { saveNickname } from '../services/nickname';
import { JamMode } from '../services/jamInvite';
import './jam.css';

type Props = { jam: ReturnType<typeof useJam>; playlists: Playlist[]; setPlaylists: (update: (prev: Playlist[]) => Playlist[]) => void; toast: (message: string) => void; downloadOnline: (track: Track) => Promise<void>; onlineProgress: Record<string, number> };
export function JamPanel({ jam, playlists, setPlaylists, toast, downloadOnline, onlineProgress }: Props) {
  const [open, setOpen] = useState(false);
  const nickname = useNickname();
  const [name, setName] = useState(nickname);
  useEffect(() => { setName(nickname); }, [nickname]);
  function saveLocalNickname() {
    try { setName(saveNickname(name)); toast('Nickname saved on this device'); }
    catch (error) { toast(String(error)); }
  }
  const [mode, setMode] = useState<JamMode>('local');
  const [intent, setIntent] = useState<'host' | 'join'>('host');
  const [invite, setInvite] = useState('');
  const [tab, setTab] = useState<'queue' | 'shared' | 'history'>('shared');
  const [playlist, setPlaylist] = useState('p1');
  const [newName, setNewName] = useState('');
  async function save(song: SharedSong, toPlaylist: boolean) {
    try {
      if (toPlaylist && playlist === 'new' && !newName.trim()) throw Error('Enter a name for your new playlist.');
      const track: Track = await jam.saveSong(song);
      if (toPlaylist) {
        const target = playlist === 'new' ? `jam-${crypto.randomUUID()}` : playlist;
        setPlaylists(prev => playlist === 'new'
          ? [...prev, { id: target, name: newName.trim(), description: 'Saved from a Jam', tracks: [track] }]
          : prev.map(p => p.id === target && !p.tracks.some(t => t.url === track.url) ? { ...p, tracks: [...p.tracks, track] } : p));
        if (playlist === 'new') { setPlaylist(target); setNewName(''); }
        toast('Saved to your playlist');
      } else toast('Audio saved locally');
    } catch (error) { toast(String(error)); }
  }
  function songs(items: SharedSong[], live: boolean) {
    return items.length ? items.map((song, i) => {
      const available = !song.fileKey || !!jam.saved[song.jamId] || !!jam.room?.shared.some(t => t.jamId === song.jamId);
      const downloading = jam.downloads[song.jamId] === 'Downloading…';
      return <li key={`${song.jamId}-${i}`} className="jam-song">
        <div><strong>{song.title}</strong><small>{song.artist} · Shared by {song.sharedBy}</small><small aria-live="polite">{jam.saved[song.jamId] ? 'Saved' : jam.downloads[song.jamId] || (!available ? 'Unavailable — needs sharing again' : song.fileKey ? 'Shared audio file' : 'Online track')}</small></div>
        <div className="jam-song-actions">
          {live && <button disabled={jam.busy} onClick={() => jam.command({ action: 'next', tracks: [song] })}>Play next</button>}
          <button title={song.fileKey ? 'Download audio' : 'Download using your download settings'} aria-label={`Download ${song.title}`} disabled={!available || downloading || (song.fileKey ? !!jam.saved[song.jamId] : onlineProgress[song.url] !== undefined)} onClick={() => song.fileKey ? void save(song, false) : void downloadOnline(song)}>{!song.fileKey && onlineProgress[song.url] !== undefined ? `${Math.round(onlineProgress[song.url])}%` : <Download size={16} />}</button>
          <button title="Save to selected playlist" aria-label={`Save ${song.title} to playlist`} disabled={!available || downloading} onClick={() => void save(song, true)}><ListPlus size={16} /></button>
        </div>
      </li>;
    }) : <p className="jam-empty">Songs you share will appear here. Play a song or playlist anywhere in the app while connected.</p>;
  }
  return <>
    <button className={`jam-launch ${jam.room ? 'is-live' : ''}`} onClick={() => setOpen(true)}><Radio size={16} /> {jam.room ? 'In a Jam' : 'Start / Join Jam'}</button>
    {open && createPortal(<div className="jam-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="jam-panel" role="dialog" aria-modal="true" aria-label="Jam" onKeyDown={e => {
        if (e.key === 'Escape') setOpen(false);
        if (e.key === 'Tab') {
          const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, summary')).filter(el => el.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <header><div><h2><Radio size={22} /> Jam</h2><p>Listen together. Share music in both directions.</p></div><button autoFocus aria-label="Close Jam" onClick={() => setOpen(false)}><X /></button></header>
        {!jam.room ? <form onSubmit={e => { e.preventDefault(); if (intent === 'host') void jam.start(mode,name.trim()); else void jam.joinInvite(invite,name.trim(),mode); }} className="jam-connect">
          <div className="jam-options" role="group" aria-label="Jam connection type">
            <button type="button" aria-pressed={mode === 'local'} disabled={jam.busy} onClick={() => setMode('local')}><strong>Local</strong><small>Same Wi-Fi or network</small></button>
            <button type="button" aria-pressed={mode === 'internet'} disabled={jam.busy} onClick={() => setMode('internet')}><strong>Internet</strong><small>Listen from anywhere</small></button>
          </div>
          <div className="jam-options" role="group" aria-label="Start or join a Jam">
            <button type="button" aria-pressed={intent === 'host'} disabled={jam.busy} onClick={() => setIntent('host')}>Start a Jam</button>
            <button type="button" aria-pressed={intent === 'join'} disabled={jam.busy} onClick={() => setIntent('join')}>Join a friend</button>
          </div>
          <div className="jam-nickname"><label>Your nickname<input required maxLength={40} autoComplete="nickname" disabled={jam.busy} value={name} onChange={e => setName(e.target.value)} placeholder="What should your friend call you?" /></label><button type="button" disabled={jam.busy || !name.trim() || name.trim() === nickname} onClick={saveLocalNickname}>Save nickname</button></div>
          <small className="jam-profile-hint">{nickname && name.trim() === nickname ? 'Saved on this device · also shown on your player' : 'Your nickname appears on your player and in Jams.'}</small>
          {intent === 'join' ? <label>Friend’s invite<input required disabled={jam.busy} value={invite} onChange={e => setInvite(e.target.value)} placeholder="Paste the full Jam invite" /></label> : <small>{mode === 'local' ? 'The app starts your Jam automatically. Share the invite with a friend on your network.' : 'The app creates a temporary internet connection using Cloudflare. First use downloads a connection helper. Keep the host’s app open.'}</small>}
          <button className="jam-primary" disabled={jam.busy}>{jam.busy ? 'Connecting…' : intent === 'join' ? 'Join Jam' : `Start ${mode === 'local' ? 'Local' : 'Internet'} Jam`}</button>
        </form> : <div className="jam-room">
          <div className="jam-invite"><strong>{jam.mode === 'internet' ? 'Internet Jam' : 'Local Jam'}</strong><button aria-label="Copy Jam invite" onClick={() => void navigator.clipboard.writeText(jam.invite).then(() => toast('Invite copied — send it to your friend')).catch(() => toast('Select and copy the invite below.'))}><Copy size={16} /> Copy invite</button><button onClick={jam.leave}>{jam.hosting ? 'End Jam' : 'Leave'}</button></div>
          <input className="jam-invite-link" aria-label="Jam invite" readOnly value={jam.invite} onFocus={e => e.currentTarget.select()} />
          <div className="jam-members">{jam.room.members.map(m => <span key={m.id}>{m.name}{m.id === jam.memberId ? ' (you)' : ''}{m.id === jam.room!.host ? ' · host' : ''}</span>)}</div>
          <form className="jam-nickname" onSubmit={e => {e.preventDefault(); void jam.rename(name);}}><label>Your nickname<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><button disabled={jam.busy || name.trim() === jam.room.members.find(m => m.id === jam.memberId)?.name}>Update nickname</button></form>
          {jam.hosting && <small>Ending this Jam or quitting your app disconnects everyone.</small>}
          <p>{jam.room.current ? `Now playing: ${jam.room.current.title}` : 'Choose a song or playlist to start listening.'}</p>
          {jam.memberId === jam.room.host && <label className="jam-permission"><input type="checkbox" checked={jam.room.hostOnly} onChange={e => jam.command({ action: 'permissions', hostOnly: e.target.checked })} />Only host controls playback (both can add songs)</label>}
          <small>Local songs you select are uploaded for this room. Your library stays private. Your friend can save shared audio.</small>
        </div>}
        <p role="status" className="jam-status">{jam.status}</p>
        <nav aria-label="Jam views">{(['queue', 'shared', 'history'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'queue' ? 'Shared queue' : t === 'shared' ? 'Shared songs' : 'Jam history'}</button>)}</nav>
        <div className="jam-save-target"><label>Save to playlist<select value={playlist} onChange={e => setPlaylist(e.target.value)}>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="new">Create new playlist…</option></select></label>{playlist === 'new' && <input aria-label="New playlist name" value={newName} maxLength={100} onChange={e => setNewName(e.target.value)} placeholder="Playlist name" />}</div>
        <div className="jam-list">
          {tab === 'queue' && <><p className="jam-empty">{jam.room?.shuffle ? 'Shuffle is on — everyone follows this order.' : 'Everyone follows this queue.'}</p><ul>{songs(jam.room?.queue || [], !!jam.room)}</ul></>}
          {tab === 'shared' && <ul>{songs(jam.room?.shared || [], !!jam.room)}</ul>}
          {tab === 'history' && (jam.history.length ? jam.history.map(h => <details key={h.code}><summary>{new Date(h.date).toLocaleDateString()} · {h.songs.length} songs · {h.code}</summary><ul>{songs(h.songs, false)}</ul></details>) : <p className="jam-empty">Your past Jams will appear here.</p>)}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
