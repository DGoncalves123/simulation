import type { SimEvent } from '../workers/protocol';

const KIND_COLOR: Record<SimEvent['kind'], string> = {
  enforce: '#7cf',
  fight:   '#f75',
  schism:  '#cf7',
  fusion:  '#c7f',
};

const KIND_VERB: Record<SimEvent['kind'], string> = {
  enforce: 'converting',
  fight:   'clashing with',
  schism:  'splintering from',
  fusion:  'merging into',
};

interface Props {
  events: SimEvent[];
}

export function EventLog({ events }: Props) {
  if (events.length === 0) return null;
  const visible = events.slice(-8).reverse();

  return (
    <div style={{
      position: 'absolute',
      bottom: 12,
      left: 12,
      right: 12,
      fontFamily: 'ui-monospace, monospace',
      fontSize: 11,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      {visible.map((e, idx) => {
        const color = KIND_COLOR[e.kind];
        const verb = KIND_VERB[e.kind];
        const opacity = 1 - idx * 0.12;
        return (
          <div key={idx} style={{ opacity, display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ color: '#555', minWidth: 36 }}>{e.tick}</span>
            <span style={{ color }}>
              {e.kind === 'enforce' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' — '}
                  {verb} the grey
                </>
              )}
              {e.kind === 'fight' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' '}
                  {verb}
                  {' '}
                  <em style={{ color: '#ddd' }}>{e.targetBelief}</em>
                  {e.targetLabel ? <span style={{ color: '#777' }}> ({e.targetLabel})</span> : null}
                </>
              )}
              {e.kind === 'schism' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' '}
                  {verb}
                  {' → '}
                  <em style={{ color: '#ddd' }}>{e.targetBelief}</em>
                </>
              )}
              {e.kind === 'fusion' && (
                <>
                  <em style={{ color: '#ddd' }}>{e.actorBelief}</em>
                  {' '}
                  {verb}
                  {' → '}
                  <em style={{ color: '#ddd' }}>{e.targetBelief}</em>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
