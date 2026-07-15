import { Bot, Database, KeyRound, LoaderCircle, RotateCcw, Save, ScanText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'

export function SettingsPage() {
  const { state, updateSettings, demoMode, resetDemo } = usePlatform()
  const [settings, setSettings] = useState(state.settings)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await updateSettings(settings)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '设置保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="平台设置" description="密钥保存在 Supabase Secrets，网页无法读取。" actions={<button className="button primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}<span>{busy ? '正在保存' : saved ? '已保存' : '保存设置'}</span></button>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="settings-layout">
        <section className="panel settings-section">
          <div className="panel-header"><div><h2>AI 服务</h2><p>关闭后保留人工上传、复核与复习流程</p></div><Bot size={18} /></div>
          <div className="settings-list">
            <label className="setting-row"><div><strong>启用 AI 分析与答疑</strong><span>上传失败或模型不可用时自动转人工队列</span></div><input type="checkbox" checked={settings.aiEnabled} disabled={busy} onChange={(event) => { setSettings({ ...settings, aiEnabled: event.target.checked }); setSaved(false); setError('') }} /></label>
            <ProviderRow icon={Sparkles} label="文本模型" value={settings.textProvider} enabled={settings.aiEnabled} />
            <ProviderRow icon={ScanText} label="视觉模型" value={settings.visionProvider} enabled={settings.aiEnabled} />
            <ProviderRow icon={Database} label="Embedding" value={settings.embeddingProvider} enabled={settings.aiEnabled} />
            <div className="secret-notice"><KeyRound size={17} /><div><strong>API Key 不在网页中配置</strong><span>启用开关不代表密钥已经配置；通过 Supabase Functions Secrets 写入后，还需分别验证文本和图片调用。</span></div></div>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="panel-header"><div><h2>用量与上传</h2><p>限制异常费用和超大文件</p></div></div>
          <div className="panel-body form-grid">
            <label className="field"><span>学生每日 AI 消息上限</span><input type="number" min="1" max="200" value={settings.dailyStudentMessageLimit} disabled={busy} onChange={(event) => { setSettings({ ...settings, dailyStudentMessageLimit: Number(event.target.value) }); setSaved(false); setError('') }} /></label>
            <label className="field"><span>单文件上限（MB）</span><input type="number" min="1" max="25" value={settings.maxUploadMb} disabled={busy} onChange={(event) => { setSettings({ ...settings, maxUploadMb: Number(event.target.value) }); setSaved(false); setError('') }} /></label>
          </div>
        </section>
        {demoMode && <section className="panel settings-section danger-zone"><div className="panel-header"><div><h2>演示数据</h2><p>恢复虚构的初始数据和全部示例状态</p></div></div><div className="panel-body"><button className="button danger" type="button" onClick={resetDemo}><RotateCcw size={16} />重置演示数据</button></div></section>}
      </div>
    </>
  )
}

function ProviderRow({ icon: Icon, label, value, enabled }: { icon: typeof Bot; label: string; value: string; enabled: boolean }) {
  const status = !enabled ? '未启用' : !value || value.startsWith('未配置') ? '待配置' : '待服务端验证'
  return <div className="provider-row"><span><Icon size={17} /></span><div><strong>{label}</strong><small>{value || '未指定服务商'}</small></div><i>{status}</i></div>
}
