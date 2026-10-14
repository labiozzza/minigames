export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, cls: string, onClick: () => void, aria: string): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

export function toast(root: HTMLElement, text: string, ms = 2600): void {
  const t = el('div', 'toast', text);
  t.setAttribute('role', 'status');
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function modal(root: HTMLElement, cls = ''): { box: HTMLElement; close: () => void } {
  const overlay = el('div', `modal-overlay ${cls}`);
  const box = el('div', 'modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  overlay.appendChild(box);
  root.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  return { box, close };
}

export function confirmDialog(
  root: HTMLElement,
  text: string,
  okLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const { box, close } = modal(root, 'confirm');
    box.appendChild(el('p', 'modal-text', text));
    const row = el('div', 'modal-row');
    const ok = button(okLabel, 'btn primary', () => {
      close();
      resolve(true);
    }, okLabel);
    const cancel = button(cancelLabel, 'btn', () => {
      close();
      resolve(false);
    }, cancelLabel);
    row.append(ok, cancel);
    box.appendChild(row);
    cancel.focus();
  });
}
