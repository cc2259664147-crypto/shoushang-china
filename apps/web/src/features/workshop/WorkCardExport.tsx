import { useEffect, useRef, useState } from 'react';
import type { Work } from '@shoushang/contracts';
import { createArtworkExporter } from '@shoushang/artwork-exporter';
import { Button, StatusMessage } from '@shoushang/ui';

const exporter = createArtworkExporter();
type Preview = { url: string; filename: string };

export function WorkCardExport({ work }: { work: Work }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  const previewRef = useRef<Preview | null>(null);
  useEffect(() => {
    generation.current++;
    lock.current = false;
    setPreview(null); setPhase('idle'); setMessage('');
    return () => { generation.current++; if (previewRef.current) URL.revokeObjectURL(previewRef.current.url); previewRef.current = null; };
  }, [work.id]);
  async function generate() {
    if (lock.current) return;
    lock.current = true;
    const token = ++generation.current;
    setPhase('running'); setMessage('正在生成作品卡，请稍候…');
    const slowTimer = window.setTimeout(() => { if (token === generation.current) setMessage('生成已超过10秒，可取消后重试'); }, 10000);
    try {
      const result = await exporter.exportCard({ work });
      if (token !== generation.current) return;
      if (!result.ok) { setPhase('error'); setMessage(`${result.error.message}（${result.error.code}）`); return; }
      const blob = new Blob([result.value.bytes.slice().buffer], { type: result.value.mimeType });
      const next = { url: URL.createObjectURL(blob), filename: result.value.filename };
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
      previewRef.current = next;
      setPreview(next); setPhase('success'); setMessage('作品卡已生成');
    } catch {
      if (token === generation.current) { setPhase('error'); setMessage('作品卡生成失败，请重试'); }
    } finally { window.clearTimeout(slowTimer); if (token === generation.current) lock.current = false; }
  }
  function cancel() { generation.current++; lock.current = false; setPhase(previewRef.current ? 'success' : 'idle'); setMessage(previewRef.current ? '作品卡已生成' : '已取消本次生成'); }
  return <section className="ws-export" aria-label="PNG 作品卡导出">
    <h3>作品卡导出</h3>
    <div className="ws-export-actions"><Button loading={phase === 'running'} onClick={() => { void generate(); }}>{phase === 'error' ? '重试生成 PNG' : '生成 PNG 作品卡'}</Button>{phase === 'running' && <Button intent="secondary" onClick={cancel}>取消生成</Button>}</div>
    <StatusMessage tone={phase === 'error' ? 'error' : phase === 'success' ? 'success' : 'info'} message={message} urgent={phase === 'error'} />
    {preview && <div className="ws-export-result"><img src={preview.url} alt="已生成的作品卡预览" /><div className="ws-export-actions"><a className="ws-export-link" href={preview.url} download={preview.filename}>下载 PNG</a><a className="ws-export-link" href={preview.url} target="_blank" rel="noopener noreferrer">打开图片</a></div><p>手机可打开图片后尝试长按保存；浏览器和系统是否支持保存到相册取决于设备。下载操作不代表文件已保存。</p></div>}
  </section>;
}
