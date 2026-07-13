import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  FileCheck2,
  FileText,
  FolderOpen,
  KeyRound,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Shield,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatDateTime, subjectLabels } from '../../lib/utils'
import type { KnowledgeDocument, KnowledgeVisibility, Subject } from '../../types/domain'

type MaterialCategory = 'lecture' | 'assignment' | 'supplement' | 'method'

const visibilityLabels: Record<KnowledgeVisibility, string> = {
  student_visible: '学生可查看',
  solution_gated: '完成作答后',
  teacher_only: '仅教师可见',
}

const categoryLabels: Record<MaterialCategory, string> = {
  lecture: '讲义',
  assignment: '作业',
  supplement: '补充习题',
  method: '方法技巧',
}

const categoryIcons: Record<MaterialCategory, typeof FileText> = {
  lecture: BookOpen,
  assignment: FileCheck2,
  supplement: ListChecks,
  method: Lightbulb,
}

function getMaterialCategory(document: KnowledgeDocument): MaterialCategory {
  const name = `${document.title} ${document.relativePath}`
  if (/方法|技巧|结论|模型/.test(name)) return 'method'
  if (document.documentType === 'lecture') return 'lecture'
  if (document.documentType === 'exercise') return /作业/.test(name) ? 'assignment' : 'supplement'
  if (document.documentType === 'solution') return 'assignment'
  return 'method'
}

function getTopic(document: KnowledgeDocument) {
  const parts = document.relativePath.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts.at(-2) ?? '未分类' : '未分类'
}

export function KnowledgePage() {
  const { state, createLearningResource, createSyncToken, revokeSyncToken } = usePlatform()
  const [configOpen, setConfigOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [view, setView] = useState<'materials' | 'questions'>('materials')
  const [studentFilter, setStudentFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState<'all' | Subject>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | MaterialCategory>('all')
  const [copied, setCopied] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<{ token: string; tokenId: string } | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenOperation, setTokenOperation] = useState<'knowledge' | 'question_bank'>('knowledge')
  const [tokenStudentId, setTokenStudentId] = useState(state.students[0]?.id ?? '')
  const [tokenSubject, setTokenSubject] = useState<Subject>('math')
  const [uploadStudentId, setUploadStudentId] = useState(state.students[0]?.id ?? '')
  const [uploadSubject, setUploadSubject] = useState<Subject>(state.students[0]?.subjects[0] ?? 'math')
  const [uploadCategory, setUploadCategory] = useState<MaterialCategory>('lecture')
  const [uploadTopic, setUploadTopic] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadBody, setUploadBody] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const active = state.knowledgeDocuments.filter((item) => item.active)
  const latest = state.syncRuns[0]
  const uploadStudent = state.students.find((student) => student.id === uploadStudentId)
  const filteredDocuments = useMemo(() => state.knowledgeDocuments.filter((document) => {
    if (studentFilter !== 'all' && document.studentId !== studentFilter) return false
    if (subjectFilter !== 'all' && document.subject !== subjectFilter) return false
    if (categoryFilter !== 'all' && getMaterialCategory(document) !== categoryFilter) return false
    return true
  }), [categoryFilter, state.knowledgeDocuments, studentFilter, subjectFilter])
  const filteredResources = useMemo(() => state.learningResources.filter((resource) => {
    if (studentFilter !== 'all' && resource.studentId !== studentFilter) return false
    if (subjectFilter !== 'all' && resource.subject !== subjectFilter) return false
    if (categoryFilter !== 'all' && resource.resourceType !== categoryFilter) return false
    return true
  }), [categoryFilter, state.learningResources, studentFilter, subjectFilter])

  const command = tokenOperation === 'knowledge'
    ? 'npm run knowledge:sync -- --config knowledge-sources.local.json'
    : 'npm run question-bank:import -- --config question-bank-import.local.json'

  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const closeConfig = () => { setConfigOpen(false); setGeneratedToken(null) }

  const issueToken = async () => {
    setTokenBusy(true)
    try {
      setGeneratedToken(await createSyncToken(
        tokenOperation === 'knowledge' ? '本地学习资料同步' : '本地题库导入',
        tokenOperation,
        tokenOperation === 'knowledge' ? [tokenStudentId] : [],
        [tokenSubject],
      ))
    } finally { setTokenBusy(false) }
  }

  const chooseUploadStudent = (studentId: string) => {
    setUploadStudentId(studentId)
    const student = state.students.find((item) => item.id === studentId)
    setUploadSubject(student?.subjects[0] ?? 'math')
  }

  const publishUpload = async () => {
    setUploadError('')
    if (!uploadStudentId || !uploadTopic.trim() || !uploadTitle.trim()) return setUploadError('请完整填写学生、专题目录和资料名称')
    if (uploadCategory === 'method' && !uploadBody.trim()) return setUploadError('请填写方法技巧的 Markdown 正文')
    if (uploadCategory !== 'method' && !uploadFile) return setUploadError('请选择一个资料文件')
    setUploadBusy(true)
    try {
      await createLearningResource({
        studentIds: [uploadStudentId], subject: uploadSubject, topic: uploadTopic.trim(), title: uploadTitle.trim(),
        resourceType: uploadCategory, description: uploadDescription.trim(), body: uploadCategory === 'method' ? uploadBody.trim() : undefined,
      }, uploadFile ? [uploadFile] : [])
      setUploadOpen(false)
      setUploadTopic(''); setUploadTitle(''); setUploadDescription(''); setUploadBody(''); setUploadFile(null)
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : '资料上传失败，请稍后重试')
    } finally { setUploadBusy(false) }
  }

  return (
    <>
      <PageHeader
        title="学习资料"
        description="按学生、科目和专题管理讲义、作业、补充习题与方法技巧。"
        actions={<>
          <button className="button" type="button" onClick={() => setConfigOpen(true)}><RefreshCw size={16} /><span>本地同步</span></button>
          <button className="button primary" type="button" onClick={() => setUploadOpen(true)}><Plus size={16} /><span>添加资料</span></button>
        </>}
      />

      <div className="knowledge-summary">
        <div><BookOpen size={20} /><span>讲义</span><strong>{active.filter((item) => getMaterialCategory(item) === 'lecture').length + state.learningResources.filter((item) => item.resourceType === 'lecture').length}</strong></div>
        <div><FileCheck2 size={20} /><span>作业与习题</span><strong>{active.filter((item) => ['assignment', 'supplement'].includes(getMaterialCategory(item))).length + state.learningResources.filter((item) => ['assignment', 'supplement'].includes(item.resourceType)).length}</strong></div>
        <div><Lightbulb size={20} /><span>方法技巧</span><strong>{active.filter((item) => getMaterialCategory(item) === 'method').length + state.learningResources.filter((item) => item.resourceType === 'method').length}</strong></div>
        <div><Clock3 size={20} /><span>最近更新</span><strong>{latest ? formatDateTime(latest.finishedAt ?? latest.startedAt) : '尚未同步'}</strong></div>
      </div>

      <section className="panel knowledge-table-panel">
        <div className="panel-header">
          <div><h2>{view === 'materials' ? '资料目录' : '已复核题库'}</h2><p>{view === 'materials' ? '学生只能看到分配给本人且已开放的科目资料' : '仅题面与官方答案均已复核的题目可进入练习推荐'}</p></div>
          <div className="segmented-control compact-segments">
            <button type="button" className={view === 'materials' ? 'active' : ''} onClick={() => setView('materials')}><FolderOpen size={14} />学习资料</button>
            <button type="button" className={view === 'questions' ? 'active' : ''} onClick={() => setView('questions')}><ListChecks size={14} />题库</button>
          </div>
        </div>

        {view === 'materials' && (
          <div className="panel-header">
            <select className="student-select" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} aria-label="按学生筛选">
              <option value="all">全部学生</option>
              {state.students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
            </select>
            <select className="student-select" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value as 'all' | Subject)} aria-label="按科目筛选">
              <option value="all">全部科目</option>
              <option value="math">数学</option><option value="physics">物理</option><option value="chemistry">化学</option>
            </select>
            <select className="student-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | MaterialCategory)} aria-label="按资料类型筛选">
              <option value="all">全部类型</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        )}

        <div className="table-scroll">
          {view === 'materials' ? <table className="data-table">
            <thead><tr><th>资料</th><th>类型</th><th>学生</th><th>科目</th><th>专题目录</th><th>开放范围</th><th>状态</th></tr></thead>
            <tbody>
              {filteredResources.map((resource) => {
                const student = state.students.find((item) => item.id === resource.studentId)
                const CategoryIcon = categoryIcons[resource.resourceType]
                return <tr key={`resource-${resource.id}`}><td><div className="document-cell"><CategoryIcon size={17} /><span><strong>{resource.title}</strong><small>{resource.attachments.map((file) => file.name).join('、') || resource.description}</small></span></div></td><td>{categoryLabels[resource.resourceType]}</td><td>{student?.displayName ?? '--'}</td><td>{subjectLabels[resource.subject]}</td><td>{resource.topic}</td><td><span className="visibility visibility-student_visible">学生可查看</span></td><td>{resource.publishedAt ? <span className="active-state"><CheckCircle2 size={14} />已发布</span> : <span className="inactive-state"><XCircle size={14} />草稿</span>}</td></tr>
              })}
              {filteredDocuments.map((document) => {
                const student = state.students.find((item) => item.id === document.studentId)
                const category = getMaterialCategory(document)
                const CategoryIcon = categoryIcons[category]
                return (
                  <tr key={document.id}>
                    <td><div className="document-cell"><CategoryIcon size={17} /><span><strong>{document.title}</strong><small>{document.relativePath}</small></span></div></td>
                    <td>{categoryLabels[category]}</td>
                    <td>{student?.displayName ?? '共享'}</td>
                    <td>{subjectLabels[document.subject]}</td>
                    <td>{getTopic(document)}</td>
                    <td><span className={`visibility visibility-${document.visibility}`}>{visibilityLabels[document.visibility]}</span></td>
                    <td>{document.active ? <span className="active-state"><CheckCircle2 size={14} />已发布</span> : <span className="inactive-state"><XCircle size={14} />已停用</span>}</td>
                  </tr>
                )
              })}
              {!filteredDocuments.length && !filteredResources.length && <tr><td colSpan={7}>当前筛选条件下暂无学习资料</td></tr>}
            </tbody>
          </table> : <table className="data-table question-bank-table"><thead><tr><th>编号</th><th>试卷与题号</th><th>专题</th><th>考点</th><th>难度</th><th>来源页码</th><th>状态</th></tr></thead><tbody>{state.questionBankItems.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td><div className="document-cell"><FileCheck2 size={17} /><span><strong>{item.paperName} · {item.questionNumber}</strong><small>{item.sourcePath}</small></span></div></td><td>{item.topic}</td><td>{item.knowledgePoints.join('、')}</td><td>{item.difficulty}</td><td>题面 {item.questionPage} / 答案 {item.answerPage}</td><td><span className="active-state"><CheckCircle2 size={14} />已复核</span></td></tr>)}</tbody></table>}
        </div>
      </section>

      <Modal open={uploadOpen} title="添加学习资料" onClose={() => setUploadOpen(false)} footer={<><button type="button" className="button" onClick={() => setUploadOpen(false)}>取消</button><button type="button" className="button primary" disabled={uploadBusy} onClick={() => void publishUpload()}><UploadCloud size={16} />{uploadBusy ? '正在上传' : '上传并发布'}</button></>}>
        <div className="sync-config">
          <label className="field"><span>分配给学生</span><select value={uploadStudentId} onChange={(event) => chooseUploadStudent(event.target.value)}>{state.students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label>
          <label className="field"><span>科目</span><select value={uploadSubject} onChange={(event) => setUploadSubject(event.target.value as Subject)}>{(uploadStudent?.subjects ?? ['math']).map((subject) => <option key={subject} value={subject}>{subjectLabels[subject]}</option>)}</select></label>
          <label className="field"><span>资料类型</span><select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as MaterialCategory)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>专题目录</span><input value={uploadTopic} onChange={(event) => setUploadTopic(event.target.value)} placeholder="例如：数列 / 等差数列" /></label>
          <label className="field"><span>资料名称</span><input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="输入学生端显示的名称" /></label>
          <label className="field"><span>资料说明（可选）</span><textarea value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} placeholder="作为副标题展示，可填写学习要求、重点或使用方法" /></label>
          {uploadCategory === 'method' ? <label className="field"><span>方法正文（Markdown）</span><textarea className="markdown-editor" value={uploadBody} onChange={(event) => setUploadBody(event.target.value)} placeholder={'## 方法名称\n\n适用条件、关键步骤与易错提醒……\n\n公式可写为 $a_n=a_1+(n-1)d$'} /></label> : <label className="field"><span>选择文件</span><input type="file" accept=".pdf,.md,.html,.doc,.docx,application/pdf,text/markdown,text/html" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>}
          {uploadFile && <div className="sync-security"><FileText size={18} /><div><strong>{uploadFile.name}</strong><p>{(uploadFile.size / 1024 / 1024).toFixed(1)} MB · {categoryLabels[uploadCategory]} · {subjectLabels[uploadSubject]}</p></div></div>}
          {uploadError && <p className="form-error">{uploadError}</p>}
        </div>
      </Modal>

      <section className="panel sync-history-panel">
        <div className="panel-header"><div><h2>资料同步记录</h2><p>本地资料发布与更新留痕</p></div></div>
        {state.syncRuns.map((run) => <div className="sync-run" key={run.id}><span className={`sync-state ${run.status}`}><RefreshCw size={15} /></span><div><strong>{formatDateTime(run.startedAt)}</strong><p>新增 {run.added} · 更新 {run.updated} · 未变 {run.unchanged} · 停用 {run.deactivated}</p></div><span>{run.status === 'succeeded' ? '成功' : run.status === 'running' ? '运行中' : '失败'}</span></div>)}
      </section>

      <Modal open={configOpen} title="本地增量同步" onClose={closeConfig}>
        <div className="sync-config">
          <div className="sync-security"><KeyRound size={18} /><div><strong>专用同步令牌</strong><p>令牌仅写入本机 `.env.local`，可在后台随时撤销。</p></div></div>
          <label className="field"><span>令牌用途</span><select value={tokenOperation} onChange={(event) => { setTokenOperation(event.target.value as 'knowledge' | 'question_bank'); setGeneratedToken(null) }}><option value="knowledge">学习资料同步</option><option value="question_bank">已复核题库导入</option></select></label>
          {tokenOperation === 'knowledge' && <label className="field"><span>限定学生</span><select value={tokenStudentId} onChange={(event) => setTokenStudentId(event.target.value)}>{state.students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label>}
          <label className="field"><span>限定科目</span><select value={tokenSubject} onChange={(event) => setTokenSubject(event.target.value as Subject)}><option value="math">数学</option><option value="physics">物理</option><option value="chemistry">化学</option></select></label>
          {generatedToken ? <div className="generated-token"><span>仅显示一次</span><div><code>{generatedToken.token}</code><button type="button" className="icon-button" onClick={() => void navigator.clipboard.writeText(generatedToken.token)} title="复制令牌"><Copy size={16} /></button></div><button type="button" className="button danger small" onClick={async () => { await revokeSyncToken(generatedToken.tokenId); setGeneratedToken(null) }}>立即撤销</button></div> : <button type="button" className="button" onClick={() => void issueToken()} disabled={tokenBusy || (tokenOperation === 'knowledge' && !tokenStudentId)}><KeyRound size={15} />{tokenBusy ? '正在签发' : '生成新同步令牌'}</button>}
          <label className="field"><span>运行命令</span><div className="copy-field"><code>{command}</code><button type="button" className="icon-button" onClick={() => void copy()} title="复制命令">{copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}</button></div></label>
          <div className="config-example"><span><Code2 size={15} />目录映射示例</span><pre>{`{
  "sources": [{
    "studentId": "student-uuid",
    "subject": "math",
    "root": "../学生目录/数学"
  }]
}`}</pre></div>
          {state.syncTokens.length > 0 && <div className="sync-token-list"><strong>当前有效令牌</strong>{state.syncTokens.map((token) => <div key={token.id}><span>{token.label} · {token.operation === 'knowledge' ? '资料同步' : '题库导入'} · {token.subjects.map((subject) => subjectLabels[subject]).join('、')}</span><button type="button" className="button danger small" onClick={() => void revokeSyncToken(token.id)}><XCircle size={14} />撤销</button></div>)}</div>}
          <div className="sync-security"><Shield size={18} /><div><strong>学生资料隔离</strong><p>同步令牌仅允许写入选定学生与科目的目录。</p></div></div>
        </div>
      </Modal>
    </>
  )
}
