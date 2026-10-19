export const CONTROLS_CSS = `
  .dsh-ps-controls { display: flex; align-items: center; gap: 4px; border: 0; margin: 0; padding: 0; min-width: 0; }
  .dsh-ps-controls button {
    color: inherit;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 6px;
    padding: 3px 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .dsh-ps-controls button[aria-pressed="false"] { opacity: .65; }
  .dsh-ps-controls button:disabled { opacity: .35; cursor: default; }
  .dsh-ps-controls button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`
