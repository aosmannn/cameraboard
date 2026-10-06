// Privacy and Terms: plain pages that share the site header and footer.
import { mountShell, CONTACT_EMAIL, setTitle } from './site';

mountShell('');
setTitle(document.querySelector('h1')?.textContent ?? '');
const a = document.getElementById('contact') as HTMLAnchorElement | null;
if (a) { a.href = 'mailto:' + CONTACT_EMAIL; a.textContent = CONTACT_EMAIL; }
