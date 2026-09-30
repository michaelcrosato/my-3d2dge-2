/** Short status messages (controller connected, binding replaced, profile imported). Screen readers hear them too. */
import { h } from './dom';

export function toast(message: string, ms = 2600) {
  const host = document.getElementById('toast');
  if (!host) return;
  const el = h('div', {}, message);
  host.append(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  setTimeout(() => el.remove(), ms);
}
