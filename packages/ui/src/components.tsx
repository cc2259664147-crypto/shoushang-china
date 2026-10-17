import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, Ref, RefObject } from 'react';

export type Intent = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  loading?: boolean;
  loadingLabel?: string;
  ref?: Ref<HTMLButtonElement>;
}
export function Button({ intent = 'primary', loading = false, loadingLabel = '正在处理，请稍候', disabled, type = 'button', className = '', children, onClick, ...props }: ButtonProps) {
  const clickLocked = useRef(false);
  return <span className="ss-button-wrap"><button {...props} type={type} className={`ss-button ss-button--${intent} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} onClick={e => {
    if (loading || disabled || clickLocked.current) { e.preventDefault(); return; }
    // Bridge the same-task interval before React commits the caller's loading state.
    clickLocked.current = true; queueMicrotask(() => { clickLocked.current = false; }); onClick?.(e);
  }}><span className={loading ? 'ss-button-label ss-button-label--loading' : 'ss-button-label'}>{children}</span>{loading && <span className="ss-button-progress" aria-hidden="true"><span className="ss-spinner" /></span>}</button><span className="ss-sr-only" role="status">{loading ? loadingLabel : ''}</span></span>;
}
export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label' | 'aria-labelledby'> & { 'aria-label': string; children: ReactNode };
export function IconButton({ children, className = '', ...props }: IconButtonProps) {
  return <Button {...props} className={`ss-icon-button ${className}`}><span aria-hidden="true" className="ss-icon">{children}</span></Button>;
}
export function CloseIcon() { return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>; }

export interface FieldControlProps { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; required?: boolean }
export interface FormFieldProps {
  id?: string;
  label: string;
  description?: ReactNode;
  error?: string;
  required?: boolean;
  describedBy?: string;
  children: (props: FieldControlProps) => ReactNode;
}
export function FormField({ id, label, description, error, required, describedBy, children }: FormFieldProps) {
  const generated = useId(); const controlId = id ?? `ss-field-${generated}`;
  const descriptions = [describedBy, description ? `${controlId}-description` : '', error ? `${controlId}-error` : ''].filter(Boolean).join(' ');
  const control: FieldControlProps = { id: controlId, ...(required === undefined ? {} : { required }), ...(descriptions ? { 'aria-describedby': descriptions } : {}), ...(error ? { 'aria-invalid': true } : {}) };
  return <div className="ss-field"><label className="ss-label" htmlFor={controlId}>{label}{required && <span className="ss-required">（必填）</span>}</label>{description && <div className="ss-description" id={`${controlId}-description`}>{description}</div>}{children(control)}{error && <p className="ss-field-error" id={`${controlId}-error`}>错误：{error}</p>}</div>;
}
export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };
export function TextInput({ className = '', type = 'text', ...props }: TextInputProps) { return <input {...props} type={type} className={`ss-input ${className}`} />; }
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> };
export function TextArea({ className = '', ...props }: TextAreaProps) { return <textarea {...props} className={`ss-input ss-textarea ${className}`} />; }

export interface NumberValue { raw: string; number: number | null; badInput: boolean }
export interface NumberInputProps extends Omit<TextInputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onInput'> {
  value: string;
  onValueChange: (value: NumberValue) => void;
}
export function NumberInput({ value, onValueChange, ...props }: NumberInputProps) {
  // onInput also fires when the browser's sanitized value stays '' (e.g. a lone '-').
  return <TextInput {...props} type="number" value={value} onChange={() => { /* Controlled writes come from onInput, including invalid intermediates. */ }} onInput={e => { const input = e.currentTarget; onValueChange({ raw: input.value, number: Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber, badInput: input.validity.badInput }); }} />;
}
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'multiple'> {
  options: readonly SelectOption[];
  ref?: Ref<HTMLSelectElement>;
}
export function Select({ options, className = '', ...props }: SelectProps) {
  return <select {...props} className={`ss-input ss-select ${className}`}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>;
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';
const toneLabels: Record<NoticeTone, string> = { info: '信息', success: '成功', warning: '注意', error: '错误' };
export interface InlineNoticeProps { tone?: NoticeTone; children: ReactNode; action?: ReactNode }
export function InlineNotice({ tone = 'info', children, action }: InlineNoticeProps) { return <div className={`ss-notice ss-notice--${tone}`}><div><strong>{toneLabels[tone]}：</strong>{children}</div>{action && <div className="ss-notice-action">{action}</div>}</div>; }
export interface StatusMessageProps { tone?: NoticeTone; message: string; urgent?: boolean }
export function StatusMessage({ tone = 'info', message, urgent = false }: StatusMessageProps) {
  // Stable text nodes: identical messages on ordinary rerenders do not change the live region.
  return <div className={`ss-status ss-status--${tone}`} role={urgent ? 'alert' : 'status'} aria-atomic="true">{message ? `${toneLabels[tone]}：${message}` : ''}</div>;
}
export function LoadingState({ label = '正在加载，请稍候' }: { label?: string }) { return <div className="ss-state" role="status"><span className="ss-spinner" aria-hidden="true" />{label}</div>; }
export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) { return <div className="ss-state ss-empty"><h3 className="ss-state-title">{title}</h3><div>{description}</div>{action}</div>; }

export type DialogCloseReason = 'escape' | 'close-button' | 'native';
export interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: (reason: DialogCloseReason) => void;
  actions?: ReactNode;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}
export function Dialog({ open, title, children, onClose, actions, busy = false, initialFocusRef, returnFocusRef, fallbackFocusRef }: DialogProps) {
  const id = useId(); const dialogRef = useRef<HTMLDialogElement>(null); const closeRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ open, onClose, busy, initialFocusRef, returnFocusRef, fallbackFocusRef });
  latest.current = { open, onClose, busy, initialFocusRef, returnFocusRef, fallbackFocusRef };
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (document.querySelector('dialog[open]')) throw new Error('M03 Dialog 不支持同时打开或嵌套弹窗');
    const active = document.activeElement;
    const trigger = latest.current.returnFocusRef?.current ?? (active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : null);
    dialog.showModal();
    (latest.current.initialFocusRef?.current ?? closeRef.current)?.focus();
    return () => {
      dialog.close();
      const fallback = latest.current.fallbackFocusRef?.current ?? document.querySelector<HTMLElement>('.ss-theme');
      const target = trigger?.isConnected && trigger.getClientRects().length > 0 && !trigger.matches(':disabled,[inert] *') ? trigger : fallback;
      if (target) { if (!target.hasAttribute('tabindex') && !target.matches('button,a[href],input,select,textarea')) target.tabIndex = -1; target.focus(); }
    };
  }, [open]);
  useEffect(() => { if (open && busy) dialogRef.current?.focus(); }, [open, busy]);
  return <dialog ref={dialogRef} tabIndex={-1} className="ss-dialog" aria-labelledby={`${id}-title`} aria-modal="true" aria-busy={busy || undefined} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const dialog = e.currentTarget;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')).filter(el => !el.matches(':disabled,[hidden],[inert] *') && el.tabIndex >= 0 && el.getClientRects().length > 0);
    const first = items[0]; const last = items.at(-1);
    if (!first) { e.preventDefault(); dialog.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus(); }
  }} onSubmit={e => { if (latest.current.busy) e.preventDefault(); }} onClose={() => { if (latest.current.open && !dialogRef.current?.open) latest.current.onClose('native'); }} onCancel={e => { e.preventDefault(); if (!latest.current.busy) latest.current.onClose('escape'); }}>
    <div className="ss-dialog-layout"><header className="ss-dialog-header"><h2 className="ss-dialog-title" id={`${id}-title`}>{title}</h2><IconButton ref={closeRef} intent="ghost" aria-label={`关闭${title}`} disabled={busy} onClick={() => onClose('close-button')}><CloseIcon /></IconButton></header><div className="ss-dialog-body">{children}</div>{actions && <footer className="ss-dialog-actions">{actions}</footer>}</div>
  </dialog>;
}

export interface ConfirmDialogProps extends Omit<DialogProps, 'actions' | 'busy' | 'initialFocusRef' | 'onClose'> {
  onClose: (reason: DialogCloseReason | 'cancel' | 'confirmed') => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  errorMessage?: string;
  onConfirmError?: (error: unknown) => void;
  onPendingChange?: (pending: boolean) => void;
}
export function ConfirmDialog({ onConfirm, confirmLabel, cancelLabel = '取消', danger = false, errorMessage = '操作未完成，请重试。', onConfirmError, onPendingChange, onClose, open, children, ...props }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const cancelRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0); const latest = useRef({ onClose, onConfirmError, onPendingChange }); latest.current = { onClose, onConfirmError, onPendingChange };
  useEffect(() => { generation.current++; setError(''); return () => { generation.current++; }; }, [open]);
  function requestClose(reason: DialogCloseReason | 'cancel') { if (!lock.current) latest.current.onClose(reason); }
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); latest.current.onPendingChange?.(true); const current = generation.current;
    try { await onConfirm(); if (current === generation.current) latest.current.onClose('confirmed'); }
    catch (cause: unknown) { if (current === generation.current) { setError(errorMessage); latest.current.onConfirmError?.(cause); } }
    finally { lock.current = false; setPending(false); latest.current.onPendingChange?.(false); }
  }
  return <Dialog {...props} open={open} onClose={requestClose} busy={pending} initialFocusRef={cancelRef} actions={<><Button ref={cancelRef} intent="secondary" disabled={pending} onClick={() => requestClose('cancel')}>{cancelLabel}</Button><Button intent={danger ? 'danger' : 'primary'} loading={pending} onClick={() => { void confirm(); }}>{confirmLabel}</Button></>}>
    {children}<StatusMessage tone="error" message={error} />{pending && <p className="ss-description">正在等待演示结果，暂时不能取消或关闭。</p>}
  </Dialog>;
}
