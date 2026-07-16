import { Activity, Bot, CheckCircle2, Database, KeyRound, LoaderCircle, RotateCcw, Save, ScanText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { invokeFunction } from '../../lib/supabase'

export function SettingsPage() {
  const { state, updateSettings, demoMode, resetDemo } = usePlatform()
  const [settings, setSettings] = useState(state.settings)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [healthBusy, setHealthBusy] = useState(false)
  const [healthResult, setHealthResult] = useState<{ model: string; latencyMs: number } | null>(null)
  const [healthError, setHealthError] = useState('')
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

  const checkTextModel = async () => {
    if (healthBusy) return
    setHealthBusy(true)
    setHealthResult(null)
    setHealthError('')
    try {
      const result = await invokeFunction<{ ok: true; model: string; latencyMs: number }>('settings', { action: 'health_check' })
      setHealthResult({ model: result.model, latencyMs: result.latencyMs })
    } catch (reason) {
      setHealthError(reason instanceof Error ? reason.message : '文本模型检测失败')
    } finally {
      setHealthBusy(false)
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
            <ProviderRow icon={Sparkles} label="文本模型" provider={settings.textProvider} model={settings.textModel} enabled={settings.aiEnabled} configured={settings.textModelConfigured} demoMode={demoMode} />
            <ProviderRow icon={ScanText} label="视觉模型" provider={settings.visionProvider} model={settings.visionModel} enabled={settings.aiEnabled} configured={settings.visionModelConfigured} demoMode={demoMode} />
            <ProviderRow icon={Database} label="Embedding" provider={settings.embeddingProvider} model={settings.embeddingModel} enabled={settings.aiEnabled} configured={settings.embeddingModelConfigured} demoMode={demoMode} optional />
            <div className="secret-notice"><KeyRound size={17} /><div><strong>API Key 不在网页中配置</strong><span>“配置已检测”只表示服务端存在地址、密钥和模型名；使用下方检测确认真实连通。网页不会读取或返回密钥。</span></div></div>
            {!demoMode && (
              <div className="model-health-row">
                <button className="button small" type="button" onClick={() => void checkTextModel()} disabled={healthBusy}>
                  {healthBusy ? <LoaderCircle className="spin" size={16} /> : <Activity size={16} />}
                  {healthBusy ? '正在检测' : '检测文本模型'}
                </button>
                {healthResult && <span className="model-health-success" role="status"><CheckCircle2 size={16} />连接检测通过 · {healthResult.model} · {healthResult.latencyMs} ms</span>}
                {healthError && <span className="model-health-error" role="alert">{healthError}</span>}
              </div>
            )}
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

function ProviderRow({
  icon: Icon,
  label,
  provider,
  model,
  enabled,
  configured,
  demoMode,
  optional = false,
}: {
  icon: typeof Bot
  label: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  demoMode: boolean
  optional?: boolean
}) {
  const providerLabel = provider && !provider.startsWith('未配置') ? provider : ''
  const modelLabel = model || (optional ? '关键词检索' : '未指定模型')
  const detail = [modelLabel, providerLabel].filter(Boolean).join(' · ')
  const status = demoMode
    ? { label: '演示模式', tone: 'demo' }
    : !enabled
      ? { label: '未启用', tone: 'muted' }
      : configured
        ? { label: '配置已检测', tone: 'connected' }
        : optional
          ? { label: '未配置（关键词检索）', tone: 'fallback' }
          : { label: '缺少服务端密钥', tone: 'missing' }

  return <div className="provider-row"><span><Icon size={17} /></span><div><strong>{label}</strong><small>{detail}</small></div><i className={`provider-status ${status.tone}`}>{status.label}</i></div>
}
