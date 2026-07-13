import { Bot, Database, KeyRound, RotateCcw, Save, ScanText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'

export function SettingsPage() {
  const { state, updateSettings, demoMode, resetDemo } = usePlatform()
  const [settings, setSettings] = useState(state.settings)
  const [saved, setSaved] = useState(false)
  const save = async () => { await updateSettings(settings); setSaved(true); window.setTimeout(() => setSaved(false), 1600) }

  return (
    <>
      <PageHeader title="平台设置" description="密钥保存在 Supabase Secrets，网页无法读取。" actions={<button className="button primary" type="button" onClick={() => void save()}><Save size={16} /><span>{saved ? '已保存' : '保存设置'}</span></button>} />
      <div className="settings-layout">
        <section className="panel settings-section">
          <div className="panel-header"><div><h2>AI 服务</h2><p>关闭后保留人工上传、复核与复习流程</p></div><Bot size={18} /></div>
          <div className="settings-list">
            <label className="setting-row"><div><strong>启用 AI 分析与答疑</strong><span>上传失败或模型不可用时自动转人工队列</span></div><input type="checkbox" checked={settings.aiEnabled} onChange={(event) => setSettings({ ...settings, aiEnabled: event.target.checked })} /></label>
            <ProviderRow icon={Sparkles} label="文本模型" value={settings.textProvider} />
            <ProviderRow icon={ScanText} label="视觉模型" value={settings.visionProvider} />
            <ProviderRow icon={Database} label="Embedding" value={settings.embeddingProvider} />
            <div className="secret-notice"><KeyRound size={17} /><div><strong>API Key 不在网页中配置</strong><span>通过 Supabase Functions Secrets 写入，前端构建产物不会包含密钥。</span></div></div>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="panel-header"><div><h2>用量与上传</h2><p>限制异常费用和超大文件</p></div></div>
          <div className="panel-body form-grid">
            <label className="field"><span>学生每日 AI 消息上限</span><input type="number" min="1" max="200" value={settings.dailyStudentMessageLimit} onChange={(event) => setSettings({ ...settings, dailyStudentMessageLimit: Number(event.target.value) })} /></label>
            <label className="field"><span>单文件上限（MB）</span><input type="number" min="1" max="25" value={settings.maxUploadMb} onChange={(event) => setSettings({ ...settings, maxUploadMb: Number(event.target.value) })} /></label>
          </div>
        </section>
        {demoMode && <section className="panel settings-section danger-zone"><div className="panel-header"><div><h2>演示数据</h2><p>恢复虚构的初始数据和全部示例状态</p></div></div><div className="panel-body"><button className="button danger" type="button" onClick={resetDemo}><RotateCcw size={16} />重置演示数据</button></div></section>}
      </div>
    </>
  )
}

function ProviderRow({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return <div className="provider-row"><span><Icon size={17} /></span><div><strong>{label}</strong><small>{value}</small></div><i>{value.startsWith('未配置') ? '待配置' : '已连接'}</i></div>
}
