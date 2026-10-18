import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ContentClient, CutOperation, TemplateVersion, Work } from '@shoushang/contracts';
import { createArtworkRenderer } from '@shoushang/artwork-renderer';
import { Button, Dialog, EmptyState, FormField, InlineNotice, LoadingState, NumberInput, StatusMessage, TextInput } from '@shoushang/ui';
import { WorkshopSession } from './session';
import { openIndexedDbRepository } from '@shoushang/local-repository';
import { WorkshopCanvas } from './Canvas';
import type { Candidate } from './Canvas';
import { makeThumbnail } from './thumbnail';
import { WorkCardExport } from './WorkCardExport';
import './workshop.css';

const renderer = createArtworkRenderer();
const paperColors = ['#B82025', '#E59C38', '#276B62', '#445566', '#8C4B86', '#F2D9A6'];
const steps = ['template', 'color', 'cut', 'preview', 'save'] as const;
const stepName = { template: '选模板', color: '选纸色', cut: '剪切', preview: '展开预览', save: '保存' };
function initialCandidate(template: TemplateVersion, shape: Candidate['shape']): Candidate { const limits = template.allowedCuts.find(x => x.shape === shape); return { shape, center: { x: 0.25, y: 0.5 }, width: Math.max(limits?.minWidth ?? 0.02, Math.min(0.1, limits?.maxWidth ?? 0.1)), height: Math.max(limits?.minHeight ?? 0.02, Math.min(0.1, limits?.maxHeight ?? 0.1)), angleDeg: 0, parameterVersion: 1 }; }
export function WorkshopPage({ contentClient, onExit, registerLeaveGuard, databaseName, testFault }: { contentClient: ContentClient; onExit: () => void; registerLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void; databaseName?: string; testFault?: 'quota' | 'thumbnail' }) {
  const session = useMemo(() => new WorkshopSession(contentClient, () => openIndexedDbRepository(databaseName ? { name: databaseName, ...(testFault === 'quota' ? { testQuotaAfterWrite: true } : {}) } : {})), [contentClient, databaseName, testFault]);
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [dialog, setDialog] = useState<'leave' | 'switch' | 'reload' | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ kind: 'template'; template: TemplateVersion } | { kind: 'draft' | 'completed'; id: string } | null>(null);
  const [view, setView] = useState<'folded' | 'unfolded'>('folded');
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaveOperation, setLeaveOperation] = useState<'save' | 'discard' | null>(null);
  const [switchOperation, setSwitchOperation] = useState<'save' | 'discard' | null>(null);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);
  const leaveToken = useRef(0);
  const switchToken = useRef(0);
  const state = snapshot.state;
  useEffect(() => { void session.start(); return () => session.dispose(); }, [session]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (session.hasUncommitted()) event.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [session]);
  useEffect(() => { registerLeaveGuard?.(() => { if (!session.hasUncommitted()) return Promise.resolve(true); setDialog('leave'); return new Promise<boolean>(resolve => { leaveResolver.current = resolve; }); }); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, session]);
  useEffect(() => { if (state) setName(state.work.name); }, [state?.work.id]);
  useEffect(() => { setView(snapshot.step === 'preview' || snapshot.step === 'save' ? 'unfolded' : 'folded'); }, [snapshot.step, state?.work.id]);
  async function chooseTemplate(template: TemplateVersion) {
    if (state && session.hasUncommitted()) { setPendingSwitch({ kind: 'template', template }); setDialog('switch'); return; }
    if (session.newWork(template)) { setCandidate(null); setView('folded'); }
  }
  function openWork(kind: 'draft' | 'completed', id: string) { if (state && session.hasUncommitted()) { setPendingSwitch({ kind, id }); setDialog('switch'); return; } void (kind === 'draft' ? session.restore(id) : session.openCompleted(id)); setCandidate(null); }
  async function leaveChoice(choice: 'save' | 'discard' | 'cancel') {
    if (choice === 'cancel') { if (leaveOperation === 'discard') return; leaveToken.current++; setBusy(false); setLeaveOperation(null); setDialog(null); leaveResolver.current?.(false); leaveResolver.current = null; return; }
    if (leaveOperation !== null) return;
    const token = ++leaveToken.current;
    setLeaveOperation(choice); setBusy(true);
    const ok = choice === 'save' ? (await session.saveDraft(), session.snapshot().status === '草稿已保存') : await session.discard();
    if (token !== leaveToken.current) return;
    setBusy(false); setLeaveOperation(null);
    if (!ok) return;
    setDialog(null); leaveResolver.current?.(true); leaveResolver.current = null;
  }
  async function switchChoice(choice: 'save' | 'discard' | 'cancel') {
    if (choice === 'cancel') { if (switchOperation === 'discard') return; switchToken.current++; setBusy(false); setSwitchOperation(null); setDialog(null); setPendingSwitch(null); return; }
    if (switchOperation !== null) return;
    const token = ++switchToken.current;
    const target = pendingSwitch;
    setSwitchOperation(choice); setBusy(true);
    const ok = choice === 'save' ? (await session.saveDraft(), session.snapshot().status === '草稿已保存') : await session.discard();
    if (token !== switchToken.current) return;
    setBusy(false); setSwitchOperation(null); if (!ok) return;
    setDialog(null); setPendingSwitch(null);
    if (target?.kind === 'template') { if (session.newWork(target.template)) { setCandidate(null); setView('folded'); } }
    else if (target) { await (target.kind === 'draft' ? session.restore(target.id) : session.openCompleted(target.id)); setCandidate(null); setView('folded'); }
  }
  const allowedShapes = state?.work.templateSnapshot.allowedCuts ?? [];
  const candidateOperation: CutOperation | null = candidate && state ? { ...candidate, id: crypto.randomUUID(), order: state.work.operations.length } : null;
  const canCut = candidateOperation && state ? session.core.validate({ ...state.work, operations: [...state.work.operations, candidateOperation] }).ok : false;
  const setNumber = (key: 'x' | 'y' | 'width' | 'height' | 'angleDeg', value: number | null) => { if (!candidate || value === null || !Number.isFinite(value)) return; if (key === 'x' || key === 'y') setCandidate({ ...candidate, center: { ...candidate.center, [key]: Math.max(0, Math.min(1, value)) } }); else setCandidate({ ...candidate, [key]: value }); };
  return <main className="ws-page ss-theme"><header className="ws-header"><div><p className="ws-eyebrow">手上中国 · 数字工坊</p><h1>剪纸工坊</h1><p>开发样例模板，仅用于阶段交互验证，并非正式非遗内容。</p></div><Button intent="secondary" onClick={() => { if (session.hasUncommitted()) { setDialog('leave'); leaveResolver.current = allowed => { if (allowed) onExit(); }; } else onExit(); }}>返回工程检查页</Button></header>
    <nav className="ws-steps" aria-label="工坊步骤">{steps.map(step => <Button key={step} intent={snapshot.step === step ? 'primary' : 'ghost'} disabled={!state && step !== 'template'} onClick={() => { session.setStep(step); setView(step === 'preview' || step === 'save' ? 'unfolded' : 'folded'); }}>{stepName[step]}</Button>)}</nav>
    {snapshot.storageError && <InlineNotice tone="error">本地存储不可用：{snapshot.storageError}。可继续在当前页面创作，但无法保存；请勿关闭页面。</InlineNotice>}
    {snapshot.issues.length > 0 && <InlineNotice tone="warning">发现 {snapshot.issues.length} 条损坏或不兼容的原始记录，已保留。<Button intent="secondary" onClick={() => { void session.downloadBackup(); }}>下载原始备份</Button></InlineNotice>}
    <StatusMessage tone={snapshot.status === '保存失败' ? 'error' : 'info'} message={`${snapshot.status}${snapshot.error ? `：${snapshot.error}` : ''}`} urgent={snapshot.status === '保存失败'} />
    <div className={`ws-layout${state ? ' ws-layout--active' : ''}`}><aside className="ws-panel"><h2>作品与模板</h2>
      {snapshot.templateLoading ? <LoadingState label="模板加载中" /> : snapshot.templateError ? <InlineNotice tone="error">模板加载失败：{snapshot.templateError}<Button onClick={() => { void session.refreshTemplates(); }}>重试</Button></InlineNotice> : snapshot.templates.length === 0 ? <EmptyState title="暂无模板" description="当前没有可用的剪纸模板。" /> : <div className="ws-template-list">{snapshot.templates.map(t => { const probe: Work = { id: 'probe', name: '预检', craftId: t.craftId, templateSnapshot: t, palette: { paper: t.recommendedColors[0] ?? '#B82025', background: '#FFFFEE' }, operations: [], status: 'draft', schemaVersion: 1, revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }; const supported = session.core.createState(probe); return <div className="ws-template" key={`${t.id}:${t.version}`}><strong>{t.name}</strong><p>{t.digitalNotice}</p><Button disabled={!t.enabled || !supported.ok} onClick={() => { void chooseTemplate(t); }}>使用模板</Button>{!supported.ok && <p className="ws-invalid">暂不支持：{supported.error.message}</p>}</div>; })}</div>}
      <h3>继续草稿</h3>{snapshot.drafts.length === 0 ? <p>暂无可恢复草稿。</p> : snapshot.drafts.map(d => <Button key={d.workId} intent="secondary" onClick={() => openWork('draft', d.workId)}>{d.work.name} · {stepName[d.step]}</Button>)}
      <FormField label="按作品 ID 打开已保存作品" description="用于重新编辑已完成作品；不会提前覆盖完成版。">{props => <TextInput {...props} value={openId} onChange={e => setOpenId(e.target.value)} />}</FormField><Button intent="secondary" disabled={!openId.trim()} onClick={() => openWork('completed', openId.trim())}>打开作品</Button>
    </aside>
    <section className="ws-center" aria-label="作品预览">{state ? <><div className="ws-view-switch"><Button intent={view === 'folded' ? 'primary' : 'secondary'} onClick={() => { session.setStep('cut'); setView('folded'); }}>折叠视图</Button><Button intent={view === 'unfolded' ? 'primary' : 'secondary'} onClick={() => { session.setStep('preview'); setView('unfolded'); }}>展开预览</Button></div><WorkshopCanvas state={state} candidate={candidate} onCandidate={setCandidate} core={session.core} renderer={renderer} view={view} /><p>切口 {state.work.operations.length} / {state.work.templateSnapshot.rules.maxOperations}</p></> : <EmptyState title="先选择模板" description="选择模板后开始数字剪纸。" />}</section>
    <aside className="ws-panel ws-tools"><h2>工具</h2>{state && <><FormField label="作品名称" description="1–30 个字符，离开输入框时应用。">{props => <TextInput {...props} value={name} maxLength={30} onChange={e => setName(e.target.value)} onBlur={() => session.setName(name)} />}</FormField>
      <h3>纸张配色</h3><div className="ws-swatches">{paperColors.map(color => <button key={color} className="ws-swatch" aria-label={`纸色 ${color}`} aria-pressed={state.work.palette.paper === color} style={{ background: color }} onClick={() => session.command({ type: 'set-palette', palette: { ...state.work.palette, paper: color } })} />)}</div><FormField label="背景色">{props => <input {...props} type="color" value={state.work.palette.background} onChange={e => session.command({ type: 'set-palette', palette: { ...state.work.palette, background: e.target.value } })} />}</FormField>
      <h3>形状</h3><div className="ws-shapes">{allowedShapes.map(limit => <Button key={limit.shape} intent={candidate?.shape === limit.shape ? 'primary' : 'secondary'} onClick={() => { setCandidate(initialCandidate(state.work.templateSnapshot, limit.shape)); setView('folded'); session.setStep('cut'); }}>{limit.shape === 'circle' ? '圆形' : limit.shape === 'triangle' ? '三角形' : '水滴形'}</Button>)}</div>
      {candidate && <div className="ws-numbers">{([['x', '中心 X', candidate.center.x], ['y', '中心 Y', candidate.center.y], ['width', '宽度', candidate.width], ['height', '高度', candidate.height], ['angleDeg', '角度', candidate.angleDeg]] as const).map(([key, label, value]) => <FormField key={key} label={label}>{props => <NumberInput {...props} value={String(value)} min={key === 'angleDeg' ? 0 : 0} max={key === 'angleDeg' ? 359 : 1} step={key === 'angleDeg' ? 1 : 0.01} onValueChange={v => setNumber(key, v.number)} />}</FormField>)}<div className="ws-nudge"><Button intent="secondary" onClick={() => setNumber('x', candidate.center.x - 0.01)}>左移</Button><Button intent="secondary" onClick={() => setNumber('x', candidate.center.x + 0.01)}>右移</Button><Button intent="secondary" onClick={() => setNumber('y', candidate.center.y - 0.01)}>上移</Button><Button intent="secondary" onClick={() => setNumber('y', candidate.center.y + 0.01)}>下移</Button></div><Button disabled={!canCut || state.work.operations.length >= state.work.templateSnapshot.rules.maxOperations} onClick={() => { if (candidateOperation && session.command({ type: 'add-cut', operation: candidateOperation })) setCandidate(null); }}>确认剪切</Button>{state.work.operations.length >= state.work.templateSnapshot.rules.maxOperations && <p>已达到此模板的切口数量上限。</p>}</div>}
      <div className="ws-history"><Button intent="secondary" disabled={state.undo.length === 0} onClick={() => session.command({ type: 'undo' })}>撤销</Button><Button intent="secondary" disabled={state.redo.length === 0} onClick={() => session.command({ type: 'redo' })}>重做</Button></div>
      <Button intent="secondary" onClick={() => { void session.saveDraft(); }}>保存草稿</Button><Button loading={busy} onClick={() => { setBusy(true); void session.saveCompleted(work => testFault === 'thumbnail' ? Promise.reject(new Error('测试缩略图失败')) : makeThumbnail(renderer, work)).finally(() => setBusy(false)); }}>完成并保存作品</Button><WorkCardExport key={state.work.id} work={state.work} />
      {snapshot.error && <p className="ws-invalid" role="alert">{snapshot.error}</p>}{snapshot.status === '保存失败' && <><Button intent="secondary" onClick={() => { void session.saveDraft(); }}>重试保存</Button><Button intent="secondary" onClick={() => setDialog('reload')}>重新载入最新</Button><Button intent="secondary" onClick={() => { void session.fork(); }}>另存副本</Button></>}
    </>}</aside></div>
    <Dialog open={dialog === 'leave'} title="离开工坊" onClose={() => { void leaveChoice('cancel'); }} busy={busy} actions={<><Button intent="secondary" disabled={leaveOperation === 'discard'} onClick={() => { void leaveChoice('cancel'); }}>继续编辑</Button><Button intent="danger" disabled={leaveOperation !== null} onClick={() => { void leaveChoice('discard'); }}>放弃修改并离开</Button><Button disabled={leaveOperation !== null} onClick={() => { void leaveChoice('save'); }}>保存草稿后离开</Button></>}>当前有未提交内容。保存草稿后可回来继续创作。</Dialog>
    <Dialog open={dialog === 'switch'} title="切换作品" onClose={() => { void switchChoice('cancel'); }} busy={busy} actions={<><Button intent="secondary" disabled={switchOperation === 'discard'} onClick={() => { void switchChoice('cancel'); }}>继续编辑</Button><Button intent="danger" disabled={switchOperation !== null} onClick={() => { void switchChoice('discard'); }}>放弃修改并切换</Button><Button disabled={switchOperation !== null} onClick={() => { void switchChoice('save'); }}>保存草稿并切换</Button></>}>切换后当前历史不会带入目标作品。可以先保存当前草稿，稍后继续。</Dialog>
    <Dialog open={dialog === 'reload'} title="重新载入最新草稿" onClose={() => setDialog(null)} actions={<><Button intent="secondary" onClick={() => setDialog(null)}>取消</Button><Button intent="danger" onClick={() => { const id = state?.work.id; setDialog(null); if (id) void session.restore(id); }}>放弃本地修改并载入</Button></>}>当前未保存的修改将丢失；数据库中的草稿不会被删除。</Dialog>
  </main>;
}
