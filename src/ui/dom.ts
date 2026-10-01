/** Minimal DOM builder for the settings UI and touch overlay (no framework, no innerHTML). */
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration>; dataset?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Array<Child | Child[]>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && k !== 'list' && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Gamepad / D-pad navigation inside any dialog: moves focus, nudges sliders, clicks. */
export function focusNav(root: HTMLElement, cmd: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prevTab' | 'nextTab', back: () => void) {
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null);
  const active = document.activeElement as HTMLElement | null;
  const i = active ? list.indexOf(active) : -1;
  const move = (d: number) => {
    const next = list[i < 0 ? 0 : (i + d + list.length) % list.length];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };
  switch (cmd) {
    case 'up': case 'prevTab': move(-1); break;
    case 'down': case 'nextTab': move(1); break;
    case 'left': case 'right': {
      const d = cmd === 'left' ? -1 : 1;
      if (active instanceof HTMLInputElement && active.type === 'range') {
        active.value = String(Number(active.value) + d * Number(active.step || 1));
        active.dispatchEvent(new Event('input', { bubbles: true }));
      } else move(d);
      break;
    }
    case 'confirm': active?.click(); break;
    case 'back': back(); break;
  }
}
