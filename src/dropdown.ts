// A drop-down list that opens and closes smoothly, replacing the browser's built-in <select>, whose pop-up can't be animated.
// Works with the keyboard (arrows, Home/End, Enter, Escape, typing a letter) and with screen readers.
import { el } from './site';

export interface Choice { value: string; label: string }
export interface Dropdown {
  el: HTMLElement;
  setChoices(choices: Choice[]): void;
  value: string;
}
let counter = 0;

export function dropdown(opts: { label: string; onChange: (value: string) => void }): Dropdown {
  const id = 'dd' + ++counter;
  const root = el('div', 'dd');
  const btn = el('button', 'dd-btn'); btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id); btn.setAttribute('aria-label', opts.label);
  const text = el('span', 'dd-text');
  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  caret.setAttribute('viewBox', '0 0 20 20'); caret.setAttribute('class', 'dd-caret'); caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = '<path d="M5 8l5 5 5-5"/>';
  btn.append(text, caret);
  const list = el('ul', 'dd-list'); list.id = id; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', opts.label); list.tabIndex = -1;
  root.append(btn, list);

  let choices: Choice[] = [], current = '', active = -1, typed = '', typedAt = 0;
  const items = () => [...list.children] as HTMLElement[];
  const label = () => choices.find(c => c.value === current)?.label ?? choices[0]?.label ?? '';
  const paint = () => {
    text.textContent = label();
    items().forEach((li, i) => { li.setAttribute('aria-selected', String(choices[i].value === current)); li.classList.toggle('active', i === active); });
  };
  const isOpen = () => root.classList.contains('open');
  const setActive = (i: number) => {
    active = Math.max(0, Math.min(choices.length - 1, i)); paint();
    const li = items()[active]; if (li) { btn.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  const open = () => {
    if (isOpen() || !choices.length) return;
    root.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, choices.findIndex(c => c.value === current)));
  };
  const close = () => { root.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-activedescendant'); active = -1; paint(); };
  const choose = (i: number) => {
    const c = choices[i]; if (!c) return;
    const changed = c.value !== current; current = c.value; close();
    if (changed) opts.onChange(current);
  };

  btn.onclick = () => (isOpen() ? close() : open());
  btn.addEventListener('keydown', e => {
    const k = e.key;
    if (!isOpen()) { if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); } return; }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(choices.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
    else if (k === 'Escape' || k === 'Tab') { if (k === 'Escape') e.preventDefault(); close(); }
    else if (k.length === 1) {   // typing "p" jumps to the first entry starting with p
      const now = Date.now(); typed = now - typedAt > 700 ? k.toLowerCase() : typed + k.toLowerCase(); typedAt = now;
      const at = choices.findIndex(c => c.label.toLowerCase().startsWith(typed)); if (at >= 0) setActive(at);
    }
  });
  document.addEventListener('pointerdown', e => { if (isOpen() && !root.contains(e.target as Node)) close(); });

  return {
    el: root,
    setChoices(next) {
      choices = next; list.innerHTML = '';
      next.forEach((c, i) => {
        const li = el('li', 'dd-item', c.label); li.id = `${id}-${i}`; li.setAttribute('role', 'option');
        li.onpointerdown = e => e.preventDefault();   // keep focus on the button
        li.onclick = () => choose(i);
        li.onpointermove = () => { if (active !== i) setActive(i); };
        list.append(li);
      });
      paint();
    },
    get value() { return current; },
    set value(v: string) { current = v; paint(); }
  };
}
