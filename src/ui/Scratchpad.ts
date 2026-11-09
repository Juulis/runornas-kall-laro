/**
 * Kladdruta: frihand och anteckningar bredvid en svår mattefråga.
 * Byggs med createElement/textContent. Ritningen fångar pekaren så sidan inte scrollar under strecket.
 */

const STYLE_ID = 'rk-scratch-style';
const PEN_PX = 4;
const ERASER_PX = 22;
const INK = '#1c140e';

const CSS = `
.rk-scratch{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:12px;border:4px solid #c7a35a;border-radius:18px;background:#1c1612;color:#efe7d2;max-width:100%}
.rk-scratch[hidden]{display:none !important}
.rk-scratch-title{margin:0;font:700 20px Cinzel,Georgia,serif;color:#e0b060}
.rk-scratch-row{display:flex;flex-wrap:wrap;gap:6px}
.rk-scratch-row[hidden]{display:none !important}
.rk-scratch-row button{flex:1 1 auto;min-height:44px;padding:6px 8px;border-radius:12px;border:2px solid #6b5a3e;background:#2a231c;color:#fff8e8;font:700 16px Cinzel,Georgia,serif;cursor:pointer}
.rk-scratch-row button[aria-pressed="true"]{border-color:#e0b060;background:#3a2e18}
.rk-scratch-frame{border:2px solid #6b5a3e;border-radius:12px;overflow:hidden;background:#fff6e4;min-width:0}
.rk-scratch-pane[hidden]{display:none !important}
.rk-scratch-canvas{display:block;width:100%;height:220px;touch-action:none;background:#fff6e4;cursor:crosshair;user-select:none}
.rk-scratch-note{display:block;width:100%;height:220px;box-sizing:border-box;margin:0;padding:10px;border:0;resize:none;background:#fff6e4;color:#1c140e;font:18px Georgia,serif}
@media (max-width:1000px){.rk-scratch-canvas,.rk-scratch-note{height:120px}}
`;

type Tool = 'pen' | 'eraser';
type Mode = 'draw' | 'text';

interface Point {
  x: number;
  y: number;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/** jsdom utan canvas-paketet loggar och returnerar null. I webbläsaren anropas getContext rakt av. */
function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const jsdom = window.navigator.userAgent.includes('jsdom');
  const report = console.error;
  if (jsdom) {
    console.error = (first?: unknown, ...rest: unknown[]) => {
      if (typeof first === 'string' && first.includes('HTMLCanvasElement.prototype.getContext')) return;
      report(first, ...rest);
    };
  }
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  } finally {
    if (jsdom) console.error = report;
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

/** Rita eller skriv. `clear` tömmer båda. Själva rutan fångar inte klick utanför sig. */
export class Scratchpad {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly note: HTMLTextAreaElement;
  private readonly drawPane: HTMLDivElement;
  private readonly textPane: HTMLDivElement;
  private readonly drawTools: HTMLDivElement;
  private readonly drawBtn: HTMLButtonElement;
  private readonly textBtn: HTMLButtonElement;
  private readonly penBtn: HTMLButtonElement;
  private readonly eraseBtn: HTMLButtonElement;
  private tool: Tool = 'pen';
  private dpr = 1;
  private activePointer: number | null = null;
  private last: Point | null = null;

  constructor() {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'rk-scratch';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Kladdruta');

    const title = document.createElement('div');
    title.className = 'rk-scratch-title';
    title.textContent = 'Räkna här';

    this.drawBtn = button('Rita', () => this.setMode('draw'));
    this.drawBtn.setAttribute('aria-pressed', 'true');
    this.textBtn = button('Text', () => this.setMode('text'));
    this.textBtn.setAttribute('aria-pressed', 'false');
    const clearBtn = button('Sudda', () => this.clearContent());
    clearBtn.setAttribute('aria-label', 'Sudda allt');
    const modes = document.createElement('div');
    modes.className = 'rk-scratch-row';
    modes.append(this.drawBtn, this.textBtn, clearBtn);

    this.penBtn = button('Penna', () => this.setTool('pen'));
    this.penBtn.setAttribute('aria-pressed', 'true');
    this.eraseBtn = button('Sudd', () => this.setTool('eraser'));
    this.eraseBtn.setAttribute('aria-label', 'Suddgummi');
    this.eraseBtn.setAttribute('aria-pressed', 'false');
    this.drawTools = document.createElement('div');
    this.drawTools.className = 'rk-scratch-row';
    this.drawTools.append(this.penBtn, this.eraseBtn);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rk-scratch-canvas';
    this.canvas.style.touchAction = 'none';
    this.canvas.setAttribute('aria-label', 'Rityta');
    this.canvas.draggable = false;
    this.drawPane = document.createElement('div');
    this.drawPane.className = 'rk-scratch-pane';
    this.drawPane.append(this.canvas);

    this.note = document.createElement('textarea');
    this.note.className = 'rk-scratch-note';
    this.note.setAttribute('aria-label', 'Anteckningar');
    this.note.placeholder = 'Skriv här …';
    this.note.spellcheck = true;
    this.textPane = document.createElement('div');
    this.textPane.className = 'rk-scratch-pane';
    this.textPane.hidden = true;
    this.textPane.append(this.note);

    const frame = document.createElement('div');
    frame.className = 'rk-scratch-frame';
    frame.append(this.drawPane, this.textPane);

    this.root.append(title, modes, this.drawTools, frame);
    this.bindPointer();
    this.root.hidden = true;
  }

  /** Tömmer rityta och text. Nästa fråga börjar i ritläge med pennan. */
  clear(): void {
    this.clearContent();
    this.setMode('draw');
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible) this.fitCanvas();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('lostpointercapture', this.onLostCapture);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private clearContent(): void {
    this.note.value = '';
    this.activePointer = null;
    this.last = null;
    this.setTool('pen');
    this.wipeCanvas();
  }

  private setMode(mode: Mode): void {
    this.drawPane.hidden = mode !== 'draw';
    this.textPane.hidden = mode !== 'text';
    this.drawTools.hidden = mode !== 'draw';
    this.drawBtn.setAttribute('aria-pressed', mode === 'draw' ? 'true' : 'false');
    this.textBtn.setAttribute('aria-pressed', mode === 'text' ? 'true' : 'false');
    if (mode === 'draw' && !this.root.hidden) this.fitCanvas();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.penBtn.setAttribute('aria-pressed', tool === 'pen' ? 'true' : 'false');
    this.eraseBtn.setAttribute('aria-pressed', tool === 'eraser' ? 'true' : 'false');
    this.canvas.style.cursor = tool === 'pen' ? 'crosshair' : 'cell';
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('lostpointercapture', this.onLostCapture);
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.canvas.addEventListener('dragstart', (ev) => ev.preventDefault());
    window.addEventListener('resize', this.onResize);
  }

  private readonly onResize = (): void => {
    this.activePointer = null;
    this.last = null;
    if (!this.root.hidden) this.fitCanvas();
  };

  private readonly onDown = (ev: PointerEvent): void => {
    if (this.activePointer !== null) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    this.activePointer = ev.pointerId;
    this.capturePointer(ev);
    this.fitCanvas();
    const p = this.point(ev);
    this.last = p;
    this.ink(p, p);
  };

  private readonly onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointer) return;
    if (ev.pointerType === 'mouse' && ev.buttons === 0) {
      this.endStroke(ev);
      return;
    }
    ev.preventDefault();
    const p = this.point(ev);
    this.ink(this.last ?? p, p);
    this.last = p;
  };

  private readonly onUp = (ev: PointerEvent): void => {
    this.endStroke(ev);
  };

  private readonly onLostCapture = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.last = null;
  };

  private endStroke(ev: PointerEvent): void {
    if (ev.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.last = null;
    this.releasePointer(ev);
  }

  private capturePointer(ev: PointerEvent): void {
    const cap = this.canvas.setPointerCapture;
    if (typeof cap !== 'function') return;
    try {
      cap.call(this.canvas, ev.pointerId);
    } catch {
      // jsdom saknar pointer capture.
    }
  }

  private releasePointer(ev: PointerEvent): void {
    const release = this.canvas.releasePointerCapture;
    if (typeof release !== 'function') return;
    try {
      const has = this.canvas.hasPointerCapture;
      if (typeof has === 'function' && !has.call(this.canvas, ev.pointerId)) return;
      release.call(this.canvas, ev.pointerId);
    } catch {
      // Redan släppt, eller så finns inte API:t.
    }
  }

  private point(ev: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    return { x: ev.offsetX, y: ev.offsetY };
  }

  /** Bitmap i CSS-pixlar. Ändrad storlek kopierar det som redan är ritat. */
  private fitCanvas(): void {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 280));
    const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 220));
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    this.dpr = dpr;
    if (canvas.width === bw && canvas.height === bh) return;
    const prev = document.createElement('canvas');
    prev.width = canvas.width;
    prev.height = canvas.height;
    const prevCtx = contextOf(prev);
    if (prevCtx && canvas.width > 0 && canvas.height > 0) prevCtx.drawImage(canvas, 0, 0);
    canvas.width = bw;
    canvas.height = bh;
    const ctx = contextOf(canvas);
    if (!ctx || prev.width === 0 || prev.height === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, cssW, cssH);
  }

  private wipeCanvas(): void {
    const ctx = contextOf(this.canvas);
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  private ink(from: Point, to: Point): void {
    const ctx = contextOf(this.canvas);
    if (!ctx) return;
    const end = from.x === to.x && from.y === to.y ? { x: to.x + 0.01, y: to.y } : to;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = ERASER_PX;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = INK;
      ctx.lineWidth = PEN_PX;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}
