export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}app-icon.svg`} alt="" className="brand-icon" />
      {!compact && (
        <span className="brand-copy">
          <strong>知行学伴</strong>
          <small>TEACHING LOOP</small>
        </span>
      )}
    </div>
  )
}
