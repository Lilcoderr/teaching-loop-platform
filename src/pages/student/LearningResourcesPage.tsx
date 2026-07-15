import { BookOpen, ClipboardList, FileQuestion, FileText, Lightbulb, Library, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate, subjectLabels } from '../../lib/utils'
import type { LearningResource, LearningResourceType, Subject } from '../../types/domain'

const MarkdownContent = lazy(() => import('../../components/MarkdownContent').then((module) => ({ default: module.MarkdownContent })))

const typeMeta: Record<LearningResourceType, { label: string; icon: typeof BookOpen }> = {
  lecture: { label: '讲义', icon: BookOpen },
  assignment: { label: '作业', icon: ClipboardList },
  supplement: { label: '补充习题', icon: FileQuestion },
  method: { label: '方法技巧', icon: Lightbulb },
}

export function LearningResourcesPage() {
  const { state } = usePlatform()
  const student = state.students.find((item) => item.id === state.currentUser.id)
  const subjects = student?.subjects ?? ['math']
  const [subject, setSubject] = useState<Subject>(subjects[0] ?? 'math')
  const [type, setType] = useState<LearningResourceType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedMethod, setSelectedMethod] = useState<LearningResource | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const resources = state.learningResources.filter((item) => {
    if (item.studentId !== state.currentUser.id || item.subject !== subject || !item.publishedAt) return false
    if (type !== 'all' && item.resourceType !== type) return false
    if (!normalizedQuery) return true
    const searchable = item.resourceType === 'method'
      ? `${item.title} ${item.description ?? ''} ${item.body ?? ''}`
      : `${item.title} ${item.description ?? ''}`
    return searchable.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
  })
  const groups = useMemo(() => {
    const topics = new Map<string, typeof resources>()
    for (const resource of resources) topics.set(resource.topic, [...(topics.get(resource.topic) ?? []), resource])
    return [...topics.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
  }, [resources])

  return (
    <>
      <PageHeader title="学习资料" description="按科目和专题查看老师发布的讲义、作业、补充题与方法技巧。" />
      <div className="resource-toolbar panel">
        <div className="subject-tabs" role="tablist" aria-label="资料科目">
          {subjects.map((item) => <button type="button" role="tab" aria-selected={subject === item} className={subject === item ? 'active' : ''} onClick={() => setSubject(item)} key={item}>{subjectLabels[item]}</button>)}
        </div>
        <div className="resource-type-filter">
          <button type="button" className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>全部</button>
          {(Object.entries(typeMeta) as Array<[LearningResourceType, (typeof typeMeta)[LearningResourceType]]>).map(([value, meta]) => <button type="button" className={type === value ? 'active' : ''} onClick={() => setType(value)} key={value}>{meta.label}</button>)}
        </div>
        <label className="resource-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={type === 'method' ? '检索标题、说明或方法正文' : '检索标题或资料说明'} /></label>
      </div>

      {!groups.length ? <section className="panel"><EmptyState icon={Library} title="这个分类暂时没有资料" detail="老师发布后会按专题显示在这里。" /></section> : (
        <div className="resource-topic-list">
          {groups.map(([topic, items]) => (
            <section className="panel resource-topic" key={topic}>
              <div className="panel-header"><div><span className="panel-kicker">{subjectLabels[subject]}</span><h2>{topic}</h2></div><span>{items.length} 份</span></div>
              <div className="resource-list">
                {items.map((resource) => {
                  const meta = typeMeta[resource.resourceType]
                  const Icon = meta.icon
                  return (
                    <article className={`resource-row ${resource.resourceType === 'method' ? 'clickable-resource' : ''}`} key={resource.id}>
                      <span className={`resource-icon resource-${resource.resourceType}`}><Icon size={19} /></span>
                      <div className="resource-main">
                        <div><span className="resource-kind">{meta.label}</span><strong>{resource.title}</strong></div>
                        {resource.description && <p>{resource.description}</p>}
                        {resource.body && resource.resourceType !== 'method' && <blockquote>{resource.body}</blockquote>}
                        {resource.attachments.length > 0 && <div className="resource-files">{resource.attachments.map((file) => file.previewUrl ? <a href={file.previewUrl} target="_blank" rel="noreferrer" key={file.id}><FileText size={14} />{file.name}</a> : <span key={file.id}><FileText size={14} />{file.name}</span>)}</div>}
                        {resource.resourceType === 'method' && <button type="button" className="button small resource-open-button" onClick={() => setSelectedMethod(resource)}>阅读方法</button>}
                      </div>
                      <time>{formatShortDate(resource.publishedAt!)}</time>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={Boolean(selectedMethod)} title={selectedMethod?.title ?? '方法技巧'} onClose={() => setSelectedMethod(null)}>
        {selectedMethod && <div className="method-reader"><div className="method-reader-meta"><span>{subjectLabels[selectedMethod.subject]}</span><span>{selectedMethod.topic}</span>{selectedMethod.description && <p>{selectedMethod.description}</p>}</div><Suspense fallback={<p>正在载入方法正文</p>}><MarkdownContent>{selectedMethod.body || '老师尚未填写方法正文。'}</MarkdownContent></Suspense></div>}
      </Modal>
    </>
  )
}
