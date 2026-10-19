export const GHOST_CSS = `
      .dsh-ps-root {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 0;
        pointer-events: none;
        z-index: 6;
      }
      .dsh-ps-ghost {
        position: absolute;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        pointer-events: none;
      }
      .dsh-ps-text {
        min-width: 0;
        overflow: hidden;
        opacity: .9;
      }
      .dsh-ps-keyWrap {
        flex: none;
        display: flex;
        align-items: center;
      }
      .dsh-ps-key {
        display: inline-block;
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 14px;
        padding: 0 4px;
        border: 1px solid currentColor;
        border-radius: 4px;
        opacity: .45;
      }
    `
