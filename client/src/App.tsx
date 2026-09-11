import { FormEvent, useEffect, useState } from 'react';

type Sender = { id: string; name: string; email: string };
type User = { id: string; name: string; email: string; avatarUrl?: string; slackConnected?: boolean };
type Email = { id: string; recipient: string; subject: string; body: string; scheduledAt: string; sentAt?: string | null; status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED'; sender: Sender };

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(path, { headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), ...options });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Something went wrong');
      return response.json();
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'TimeoutError') || attempt === 2) {
        if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('The API request timed out. Check that Redis and the database are running.');
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }
  throw new Error('Unable to connect to API');
};
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2);

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [view, setView] = useState<'SCHEDULED' | 'SENT'>('SCHEDULED');
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [selected, setSelected] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('authError');
    if (authError) setError(authError);
    void api<User>('/api/me').then(setUser).catch(() => undefined).finally(() => setAuthChecked(true));
  }, []);

  const loadEmails = async () => {
    if (!user) { setLoading(false); return; }
    try {
      const emailList = await api<Email[]>(`/api/emails?status=${view}&search=${encodeURIComponent(search)}`);
      setEmails(emailList); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to connect to API'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!user) return;
    void api<Sender[]>('/api/senders').then(setSenders).catch(() => undefined);
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      await loadEmails();
      if (!cancelled) timer = window.setTimeout(refresh, 10000);
    };
    const debounce = window.setTimeout(() => void refresh(), 250);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [view, search, user?.id]);

  const connectSlack = () => { window.location.href = '/api/slack/connect'; };
  const disconnectSlack = async () => { await api('/api/slack/disconnect', { method: 'POST', body: '{}' }); setUser((current) => current ? { ...current, slackConnected: false } : current); };
  const signOut = async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); setUser(null); };

  if (!authChecked) return <main className="login-page"><div className="login-loading"><span className="spinner" /> Checking your Google session</div></main>;
  if (!user) return <Login error={error} />;

  if (composeOpen) return <Compose sender={senders[0]} onClose={() => setComposeOpen(false)} onCreated={() => { setComposeOpen(false); setView('SCHEDULED'); void loadEmails(); }} />;
  if (selected) return <EmailDetail email={selected} onBack={() => setSelected(null)} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">out<span>8</span></div>
      <button className="account" onClick={signOut}><img src={user.avatarUrl} alt="" /><span><strong>{user.name}</strong><small>{user.email}</small></span><b>↪</b></button>
      <button className="compose-btn" onClick={() => setComposeOpen(true)}>＋ Compose</button>
      <div className="nav-label">Workspace</div>
      <button className={view === 'SCHEDULED' ? 'nav-item active' : 'nav-item'} onClick={() => setView('SCHEDULED')}><span>◷</span> Scheduled <em>{view === 'SCHEDULED' ? emails.length : ''}</em></button>
      <button className={view === 'SENT' ? 'nav-item active' : 'nav-item'} onClick={() => setView('SENT')}><span>➤</span> Sent <em>{view === 'SENT' ? emails.length : ''}</em></button>
      <div className="sidebar-bottom">
        <div className="nav-label">Integrations</div>
        {user?.slackConnected ? <button className="integration connected" onClick={disconnectSlack}><i>●</i> Slack connected <span>×</span></button> : <button className="integration" onClick={connectSlack}><i>●</i> Connect Slack <span>→</span></button>}
        <a className="integration" href="http://localhost:4000/admin/queues" target="_blank" rel="noreferrer"><i>▦</i> Queue monitor <span>↗</span></a>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div><p className="eyebrow">Outbound workspace</p><h1>{view === 'SCHEDULED' ? 'Scheduled' : 'Sent mail'}</h1></div><div className="top-actions"><div className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search emails" /></div><button className="icon-btn" title="Refresh" onClick={() => void loadEmails()}>↻</button><div className="presence">● Live</div><div className="top-profile"><img src={user.avatarUrl} alt="" /><span><strong>{user.name}</strong><small>{user.email}</small></span><button onClick={() => void signOut()} title="Log out">↪</button></div></div></header>
      <section className="content">
        <div className="content-head"><div><p className="muted">{view === 'SCHEDULED' ? 'Queued and ready to go' : 'Delivered through your senders'}</p></div><button className="text-btn" onClick={() => setComposeOpen(true)}>＋ New email</button></div>
        {error && <div className="notice error">{error}. Run <code>npm run db:push && npm run db:seed</code> to initialize the demo.</div>}
        {loading ? <div className="empty"><span className="spinner" /> Loading your workspace</div> : !emails.length ? <div className="empty"><div className="empty-mark">✦</div><h2>No {view === 'SCHEDULED' ? 'scheduled' : 'sent'} emails yet</h2><p>{view === 'SCHEDULED' ? 'Create your first outbound message and it will appear here.' : 'Sent messages will show up here after the worker delivers them.'}</p><button className="compose-btn compact" onClick={() => setComposeOpen(true)}>Compose email</button></div> : <div className="mail-list">{emails.map((email) => <button className="mail-row" key={email.id} onClick={() => setSelected(email)}><span className="recipient">To: <strong>{email.recipient}</strong></span><span className={`time ${email.status.toLowerCase()}`}>◷ {formatDate(email.scheduledAt)}</span><span className="subject">{email.subject}</span><span className="preview">— {email.body.replace(/<[^>]+>/g, '').slice(0, 72)}</span><span className="star">☆</span></button>)}</div>}
      </section>
    </main>
  </div>;
}

function Login({ error }: { error: string }) {
  return <main className="login-page"><div className="login-brand">out<span>8</span><small>ReachInbox workspace</small></div><section className="login-card"><div className="login-heading"><p className="eyebrow">Welcome back</p><h1>Login</h1><p>Sign in with your Google account to continue.</p></div><button type="button" className="google-btn" onClick={() => { window.location.href = '/api/auth/google'; }}><strong>G</strong> Continue with Google <span>↗</span></button>{error && <div className="login-error">{error}</div>}<p className="oauth-note">Your name, email, and Google profile avatar will appear in the dashboard after authorization.</p></section><p className="login-footer">Built for focused, reliable outbound work.</p></main>;
}

function Compose({ sender, onClose, onCreated }: { sender?: Sender; onClose: () => void; onCreated: () => void }) {
  const [recipient, setRecipient] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 3600000).toISOString().slice(0, 16)); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!sender) return; setBusy(true); setError(''); try { await api('/api/emails', { method: 'POST', body: JSON.stringify({ recipient, subject, body, scheduledAt, senderId: sender.id }) }); onCreated(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not schedule email'); } finally { setBusy(false); } };
  return <div className="compose-page"><header className="compose-header"><button className="back-btn" onClick={onClose}>←</button><h1>Compose new email</h1><div className="compose-tools"><span>⌕</span><span>◷</span><button className="send-btn" form="compose-form" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule'}</button></div></header><form id="compose-form" onSubmit={submit} className="compose-form"><div className="form-row"><label>From</label><div className="sender-pill">{sender?.email ?? 'No sender configured'}⌄</div></div><div className="form-row"><label>To</label><input required type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="recipient@example.com" /><button type="button" className="upload-btn">↥ Upload list</button></div><div className="form-row"><label>Subject</label><input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" /></div><div className="form-row schedule-row"><label>Send at</label><input required type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><span className="schedule-hint">Uses BullMQ delayed delivery</span></div><div className="editor"><textarea required value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type your message…" /><div className="toolbar"><span>↶</span><span>↷</span><span>|</span><b>B</b><i>I</i><u>U</u><span>|</span><span>≡</span><span>☷</span><span>❝</span><span>⌁</span></div></div>{error && <div className="notice error">{error}</div>}<p className="compose-footnote">Messages are sent through Ethereal SMTP for safe testing. Rate limits and queue state are handled server-side.</p></form></div>;
}

function EmailDetail({ email, onBack }: { email: Email; onBack: () => void }) { return <div className="detail-page"><header className="detail-header"><button className="back-btn" onClick={onBack}>←</button><h1>{email.subject}</h1><div className="detail-actions">☆　□　⌫</div></header><article className="message"><div className="message-meta"><div className="avatar">{initials(email.sender.name)}</div><div><strong>{email.sender.name}</strong><small>&lt;{email.sender.email}&gt;</small><span>to {email.recipient}</span></div><time>{formatDate(email.sentAt ?? email.scheduledAt)}</time></div><div className="message-body"><p className="message-status">{email.status === 'SENT' ? 'Delivered successfully' : 'Scheduled for delivery'}</p><div>{email.body}</div></div></article></div>; }

export default App;
