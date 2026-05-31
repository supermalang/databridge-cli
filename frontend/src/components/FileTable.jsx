// Reusable file-listing table. `columns` is an array of { key, label, render?, style? }.
// `rows` is the data; `actions` renders a per-row trailing cell.
export default function FileTable({ columns, rows, actions }) {
  return (
    <table className="file-table">
      <thead>
        <tr>
          {columns.map(c => <th key={c.key} style={c.thStyle}>{c.label}</th>)}
          {actions && <th></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id ?? row.name ?? i}>
            {columns.map(c => (
              <td key={c.key} style={c.tdStyle}>
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
            {actions && (
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>{actions(row)}</div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
