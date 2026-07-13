export function MetricBars({ items }: { items: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <div className="metric-bars">
      {items.map((item) => (
        <div className="metric-bar" key={item.label}>
          <span>{item.label}</span>
          <div><i style={{ width: `${Math.max(4, (item.value / max) * 100)}%`, backgroundColor: item.color }} /></div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}
