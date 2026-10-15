// DOM tutorial overlay: dim-with-hole, pulsing ring, pointing hand, mini card.
// Pointer-events pass through except on the card, so the game stays tappable.
import { button, el } from '../../../platform/ui/ui';

export interface OverlayTarget {
  kind: 'point';
  x: number;
  y: number;
}

export class TutorialOverlay {
  readonly root: HTMLElement;
  private dim: HTMLElement;
  private ring: HTMLElement;
  private hand: HTMLElement;
  private card: HTMLElement;
  private cardText: HTMLElement;
  private cardRow: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'tutorial');
    this.dim = el('div', 'tut-dim');
    this.ring = el('div', 'tut-ring');
    this.hand = el('div', 'tut-hand', '👆');
    this.card = el('div', 'tutorial-card');
    this.cardText = el('p', 'tut-text', '');
    this.cardRow = el('div', 'modal-row');
    this.card.append(this.cardText, this.cardRow);
    this.root.append(this.dim, this.ring, this.hand, this.card);
    parent.appendChild(this.root);
    this.hidePointer();
  }

  /** Highlight a root-relative point; hand emoji above, hole in the dim. */
  pointAt(x: number, y: number, hand: 'up' | 'down' | 'none'): void {
    this.dim.style.maskImage =
      `radial-gradient(circle 62px at ${x}px ${y}px, transparent 58px, black 70px)`;
    this.dim.style.webkitMaskImage = this.dim.style.maskImage;
    this.ring.style.display = 'block';
    this.ring.style.left = `${x - 42}px`;
    this.ring.style.top = `${y - 42}px`;
    if (hand === 'none') {
      this.hand.style.display = 'none';
    } else {
      this.hand.style.display = 'block';
      this.hand.textContent = hand === 'up' ? '👆' : '👇';
      this.hand.style.left = `${x - 20}px`;
      this.hand.style.top = hand === 'up' ? `${y - 138}px` : `${y + 66}px`;
    }
  }

  hidePointer(): void {
    this.dim.style.maskImage = 'none';
    this.dim.style.webkitMaskImage = 'none';
    this.ring.style.display = 'none';
    this.hand.style.display = 'none';
  }

  setText(html: string): void {
    this.cardText.textContent = html;
  }

  /** Dock the card to the top so it never covers highlighted bottom-bar buttons. */
  setCardTop(top: boolean): void {
    this.root.style.alignItems = top ? 'flex-start' : 'flex-end';
    this.root.style.paddingTop = top ? '64px' : '';
  }

  setActions(actions: Array<{ label: string; primary: boolean; onClick: () => void; aria: string }>): void {
    this.cardRow.innerHTML = '';
    for (const a of actions) {
      this.cardRow.append(button(a.label, a.primary ? 'btn primary' : 'btn', a.onClick, a.aria));
    }
  }

  pulse(): void {
    this.ring.classList.remove('repulse');
    void this.ring.offsetWidth;
    this.ring.classList.add('repulse');
  }

  destroy(): void {
    this.root.remove();
  }
}
