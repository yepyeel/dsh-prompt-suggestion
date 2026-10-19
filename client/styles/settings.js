export const SETTINGS_CSS = `
      .dsh-pset-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 720px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dsh-pset-title {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        line-height: 24px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-intro {
        margin: 0;
        font-size: 14px;
        line-height: 22px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-note {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-form {
        display: flex;
        flex-direction: column;
        margin-top: 4px;
      }
      .dsh-pset-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 0;
      }
      .dsh-pset-field + .dsh-pset-field {
        border-top: .5px solid var(--dsw-alias-border-l2);
      }
      .dsh-pset-fieldRow {
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .dsh-pset-rowText {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .dsh-pset-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-pset-label {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        line-height: 1.5;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-input {
        box-sizing: border-box;
        height: 34px;
        padding: 0 12px;
        border: .5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
        border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-input:focus-visible {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
      }
      .dsh-pset-input:disabled {
        color: var(--dsw-alias-label-tertiary);
        cursor: default;
      }
      .dsh-pset-input::placeholder {
        color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary));
      }
      .dsh-pset-select {
        position: relative;
        display: inline-block;
        align-self: flex-start;
        width: auto;
        min-width: 160px;
        max-width: 320px;
      }
      .dsh-pset-selectTrigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 40px;
        padding: 0 14px 0 16px;
        border: none;
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2, #f2f3f5);
        font: inherit;
        font-size: 15px;
        line-height: 1.45;
        color: var(--dsw-alias-label-primary);
        text-align: left;
        cursor: pointer;
        transition: background-color .15s ease;
      }
      .dsh-pset-selectTrigger:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-3, #eceef1);
      }
      .dsh-pset-selectTrigger:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
        outline-offset: 2px;
      }
      .dsh-pset-selectTrigger:disabled {
        color: var(--dsw-alias-label-tertiary);
        cursor: default;
        opacity: .6;
      }
      .dsh-pset-selectValue {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-pset-selectChevron {
        flex: none;
        display: flex;
        color: var(--dsw-alias-label-secondary, #81858c);
      }
      .dsh-pset-selectMenu {
        position: fixed;
        z-index: 1000;
        box-sizing: border-box;
        margin: 0;
        padding: 6px;
        list-style: none;
        max-height: 280px;
        overflow-y: auto;
        border: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .06));
        border-radius: 16px;
        background: var(--dsw-alias-bg-layer-3, #fff);
        box-shadow: 0 16px 40px rgba(0, 0, 0, .14), 0 2px 8px rgba(0, 0, 0, .06);
      }
      .dsh-pset-selectOption {
        display: flex;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
        min-height: 40px;
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 15px;
        line-height: 1.45;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
        user-select: none;
      }
      .dsh-pset-selectOption[data-active="true"] {
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, .04));
      }
      .dsh-pset-selectOptionLabel {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-pset-selectCheck {
        flex: none;
        display: flex;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-number {
        max-width: 120px;
      }
      .dsh-pset-textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 176px;
        padding: 8px 12px;
        border: .5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
        border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
        font-family: var(--ds-font-family-code);
        font-size: 12px;
        line-height: 1.65;
        color: var(--dsw-alias-label-primary);
        resize: vertical;
      }
      .dsh-pset-textarea:focus-visible {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
      }
      .dsh-pset-textarea:disabled {
        opacity: .6;
        cursor: default;
      }
      .dsh-pset-reset {
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-pset-reset:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pset-reset:disabled {
        cursor: default;
        opacity: .5;
      }
      .dsh-pset-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-top: 16px;
      }
      .dsh-pset-save {
        appearance: none;
        border: 1px solid transparent;
        border-radius: var(--dsw-radius-md);
        padding: 5px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        cursor: pointer;
        background: var(--dsw-alias-label-primary);
        color: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-base));
      }
      .dsh-pset-save:disabled {
        opacity: .4;
        cursor: default;
      }
      .dsh-pset-status {
        flex: 1;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-pset-statusError {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-pset-switch {
        box-sizing: border-box;
        position: relative;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
        padding: 2px;
        border: 0;
        border-radius: 999px;
        background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
        cursor: pointer;
      }
      .dsh-pset-switch[aria-checked="true"] {
        background: var(--dsw-alias-brand-primary);
      }
      .dsh-pset-switch:disabled {
        cursor: default;
        opacity: .5;
      }
      .dsh-pset-switch:focus-visible {
        outline: var(--dsw-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)));
        outline-offset: 2px;
      }
      .dsh-pset-thumb {
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-label-primary-foreground, #fff);
        transition: transform .12s ease;
      }
      .dsh-pset-switch[aria-checked="false"] .dsh-pset-thumb {
        background: var(--dsw-alias-switch-thumb, #fff);
      }
      .dsh-pset-switch[aria-checked="true"] .dsh-pset-thumb {
        transform: translate(16px);
      }
    `
