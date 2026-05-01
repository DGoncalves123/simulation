import type { SimEventSummary } from '../workers/protocol';

const KIND_COLOR: Record<SimEventSummary['kind'], string> = {
  enforce: '#7cf',
  fight:   '#f75',
  schism:  '#cf7',
  fusion:  '#c7f',
};

const KIND_LABEL: Record<SimEventSummary['kind'], string> = {
  enforce: 'converting the grey',
  fight:   'clashing with',
  schism:  'splinter →',
  fusion:  'merge →',
};

interface Props {
  events: SimEventSummary[];
}

export function EventLog({ events }: Props) {
  if (events.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 12,
      left: 12,
      fontFamily: 'ui-monospace, monospace',
      fontSize: 11,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      maxWidth: 560,
    }}>
      {events.map((e, idx) => {
        const color = KIND_COLOR[e.kind];
        const label = KIND_LABEL[e.kind];
        const opacity = 1 - idx * 0.10;
        return (
          <div key={idx} style={{ opacity, display: 'flex', gap: 6, alignItems: 'baseline' }}>
            {/* count badge */}
            <span style={{
              background: color,
              color: '#111',
              fontWeight: 700,
              fontSize: 10,
              padding: '0 5px',
              borderRadius: 3,
              minWidth: 24,
              textAlign: 'center',
            }}>
              {e.count > 999 ? '999+' : e.count}
            </span>
            {/* description */}
            <span style={{ color }}>
              {e.kind === 'enforce' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' — '}
                  {label}
                </>
              )}
              {e.kind === 'fight' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' '}
                  {label}
                  {' '}
                  <em style={{ color: '#ddd' }}>{e.targetBelief}</em>
                  {e.targetLabel
                    ? <span style={{ color: '#777' }}> ({e.targetLabel})</span>
                    : null}
                </>
              )}
              {(e.kind === 'schism' || e.kind === 'fusion') && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {` ${label} `}
                  <em style={{ color: '#ddd' }}>{e.targetBelief}</em>
                </>
              )}
            </span>
            {/* last tick */}
            <span style={{ color: '#444', marginLeft: 'auto' }}>t{e.lastTick}</span>
          </div>
        );
      })}
    </div>
  );
}
