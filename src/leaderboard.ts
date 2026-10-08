// Leaderboard: which cameras took the most community photos, today, this week, this month, this year and of all time.
import * as cloud from './cloud';
import { mountShell, el, $, setTitle } from './site';

mountShell('leaderboard');
const root = $('root');

type Period = 'today' | 'week' | 'month' | 'year' | 'all';
const PERIODS: [Period, string][] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
const EMPTY: Record<Period, string> = {
  today: 'No community photos were taken today yet.', week: 'No community photos were taken this week yet.',
  month: 'No community photos were taken this month yet.', year: 'No community photos were taken this year yet.',
  all: 'No cameras yet. They appear once people share photos to the community gallery.'
};

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The first day of a period and the day after it ends, as local dates. Photos carry the local date they were taken on. */
function range(p: Period): [string, string] {
  if (p === 'all') return ['', ''];
  const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = p === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : p === 'week' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))   // weeks start on Monday
    : p === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), 0, 1);
  return [day(start), day(tomorrow)];
}

let period: Period = (new URLSearchParams(location.search).get('period') as Period) || 'all';
if (!PERIODS.some(([k]) => k === period)) period = 'all';
let token = 0;

const head = el('div', 'page-head'), t = el('div');
t.append(el('h1', '', 'Leaderboard'), el('p', 'lede', 'The most popular cameras on Wayframe, counted from the photos people shared to the community gallery.'));
head.append(t); root.innerHTML = ''; root.append(head);
setTitle('Leaderboard');

const tabs = el('div', 'tabs board-tabs'); tabs.setAttribute('role', 'tablist');
const list = el('div', 'board-box'); list.setAttribute('aria-live', 'polite');
const note = el('p', 'fine');
root.append(tabs, list, note);

function drawTabs() {
  tabs.innerHTML = '';
  for (const [key, label] of PERIODS) {
    const b = el('button', '', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(key === period));
    b.onclick = () => { if (key === period) return; period = key; history.replaceState(null, '', key === 'all' ? location.pathname : `?period=${key}`); drawTabs(); void load(); };
    tabs.append(b);
  }
}

async function load() {
  const my = ++token;
  list.innerHTML = ''; list.append(el('p', 'status', 'Counting…')); note.textContent = '';
  try {
    const [from, to] = range(period);
    const { rows, partial } = await cloud.cameraLeaderboard(from, to);
    if (my !== token) return;
    list.innerHTML = '';
    if (!rows.length) {
      const e = el('div', 'empty'); e.append(el('p', '', EMPTY[period]));
      if (period !== 'all') { const a = el('button', 'btn small', 'See all time'); a.type = 'button'; a.onclick = () => { period = 'all'; history.replaceState(null, '', location.pathname); drawTabs(); void load(); }; e.append(a); }
      list.append(e); return;
    }
    const top = rows[0].photos, ol = el('ol', 'board');
    rows.forEach((r, i) => {
      const li = el('li', 'board-row' + (i < 3 ? ' podium p' + (i + 1) : ''));
      const a = el('a', 'board-main'); a.href = '/cameras/' + r.slug;
      a.append(el('span', 'rank', String(i + 1)), el('span', 'cam', r.camera));
      const bar = el('span', 'bar'); const fill = el('i'); fill.style.width = Math.max(4, Math.round((r.photos / top) * 100)) + '%'; bar.append(fill);
      const stat = el('span', 'stat'); stat.append(el('b', '', r.photos.toLocaleString()), el('small', '', `${r.photos === 1 ? 'photo' : 'photos'} · ${r.people} ${r.people === 1 ? 'person' : 'people'}`));
      li.append(a, bar, stat); ol.append(li);
    });
    list.append(ol);
    note.textContent = period === 'all' ? 'Counts every photo shared to the community gallery.' : 'Counted by the day each photo was taken.';
    if (partial) note.textContent += ' This count is based on the newest community photos only.';
  } catch (err) {
    if (my !== token) return;
    list.innerHTML = ''; list.append(el('p', 'status', 'Couldn’t load the leaderboard: ' + (err as Error).message));
  }
}
drawTabs(); void load();
