import DefaultViewManager from 'epubjs/src/managers/default/index.js';
import { pageTurnTarget } from './pagination.mjs';

export default class PaginatedManager extends DefaultViewManager {
  constructor(options) {
    super(options);
    this.pendingLayouts = new WeakMap();
  }

  createView(section, forceRight) {
    const view = super.createView(section, forceRight);
    const contentReady = new Promise(resolve => this.pendingLayouts.set(view, resolve));
    const display = view.display.bind(view);
    view.display = async request => {
      const displayed = await display(request);
      // EPUB.js resolves view.display before its content hooks apply the theme.
      // Measure the styled content before navigation chooses a chapter endpoint.
      await contentReady;
      if (view.contents) {
        view.contents.textWidth(); // Start any font loads required by the theme.
        await view.contents.document.fonts.ready;
        view.setLayout(this.layout);
      }
      return displayed;
    };
    return view;
  }

  contentRendered(view) {
    this.pendingLayouts.get(view)?.();
    this.pendingLayouts.delete(view);
  }

  usesPageGrid() {
    return this.views?.length && this.isPaginated && !this.settings.fullsize &&
      this.settings.axis === 'horizontal' && this.settings.direction !== 'rtl' &&
      this.layout.name === 'reflowable';
  }

  turnWithinChapter(direction) {
    const c = this.container;
    const target = pageTurnTarget(c.scrollLeft, c.clientWidth, c.scrollWidth, this.layout.delta, direction);
    if (target === null) return false;
    this.scrollTo(target, 0, true);
    return true;
  }

  next() {
    if (this.usesPageGrid() && this.turnWithinChapter(1)) return;
    return super.next();
  }

  prev() {
    if (this.usesPageGrid()) {
      if (this.turnWithinChapter(-1)) return;
      this.scrollTo(0, 0, true);
    }
    return super.prev();
  }
}
