import type { QueryResult } from '../workers/protocol';

interface Props {
  screenX: number;
  screenY: number;
  result: QueryResult;
}

const BOX_STYLE: React.CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 12,
  lineHeight: 1.4,
  padding: '10px 12px',
  background: 'rgba(10,12,16,0.92)',
  color: '#eaeaea',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  maxWidth: 380,
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};

export function Tooltip({ screenX, screenY, result }: Props) {
  if (result.matchCount === 0) return null;

  // Offset so cursor isn't covered; flip if near right/bottom edge.
  const offset = 14;
  const style: React.CSSProperties = {
    ...BOX_STYLE,
    left: Math.min(screenX + offset, window.innerWidth - 400),
    top: Math.min(screenY + offset, window.innerHeight - 240),
  };

  if (result.agent) {
    const a = result.agent;
    return (
      <div style={style}>
        <div style={{ opacity: 0.6, marginBottom: 4 }}>
          Agent #{a.index} · ({a.x.toFixed(1)}, {a.y.toFixed(1)})
        </div>
        {a.beliefs.length === 0 ? (
          <div style={{ opacity: 0.7 }}>no beliefs (non-reactionary)</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {a.beliefs.map((b) => (
              <li
                key={b.id}
                style={{
                  marginBottom: 6,
                  opacity: b.active ? 1 : 0.55,
                  fontWeight: b.active ? 600 : 400,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8, height: 8, borderRadius: 4,
                    background: b.active ? '#7bd88f' : '#6c6c6c',
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }}
                />
                {b.name}
                <span style={{ opacity: 0.55, marginLeft: 6 }}>
                  {b.credibility.toFixed(2)}
                </span>
                {b.parentName && (
                  <div style={{ opacity: 0.5, fontWeight: 400, fontSize: 11, marginLeft: 14, fontStyle: 'italic' }}>
                    schism from "{b.parentName}"
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={style}>
      <div style={{ opacity: 0.6, marginBottom: 6 }}>
        {result.matchCount.toLocaleString()} agents in this area
        {result.nonReactionaryCount > 0 && (
          <> · {result.nonReactionaryCount.toLocaleString()} non-reactionary</>
        )}
      </div>
      {result.tallies.length === 0 ? (
        <div style={{ opacity: 0.7 }}>no beliefs</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {result.tallies.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: '2px 0', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', opacity: 0.7 }}>
                  {t.activeHolders}/{t.holders}
                </td>
                <td style={{ padding: '2px 0', textAlign: 'right', opacity: 0.55 }}>
                  {t.avgCredibility.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
