import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function panelGeometry(leftPosition, leftSize, panelPosition, panelSize, mode = 'expanded') {
  if (!['expanded', 'collapsed'].includes(mode)) return null;
  const point = value => /^\d+,\d+$/.test(value) ? value.split(',').map(Number) : [];
  const size = value => /^\d+x\d+$/.test(value) ? value.split('x').map(Number) : [];
  const [x, y] = point(leftPosition), [width, height] = size(leftSize);
  const [px, py] = point(panelPosition), [pw, ph] = size(panelSize);
  if (![x,y,width,height,px,py,pw,ph].every(Number.isSafeInteger)
      || x !== 0 || y !== 0 || py !== y || px !== x + width || height !== ph
      || width <= 0 || height <= 0 || pw <= 56 || width + pw > 65535 || height > 65535
      || width * height <= 100000 || pw * ph <= 100000) return null;
  return {
    leftPosition, leftSize: `${mode === 'collapsed' ? width + pw - 56 : width}x${height}`,
    panelPosition: `${mode === 'collapsed' ? width + pw - 56 : px},${py}`,
    panelSize, screen: `${width + pw} ${height}`
  };
}

export function panelSnapshot(state, xSession, { internal = false, provider, session, generation } = {}) {
  if (!state.activeProvider || state.closeRequestId || (!internal && state.openingProvider)
      || !xSession || state.lastOpenedXSessionGeneration !== xSession || !state.lastOpenedRequestId) {
    throw new Error('PANEL_BUSY_OR_STALE');
  }
  if (!internal && (provider !== state.activeProvider || session !== state.lastOpenedRequestId || generation !== xSession)) {
    throw new Error('PANEL_BUSY_OR_STALE');
  }
  return {
    activeProvider: state.activeProvider, lastOpenedRequestId: state.lastOpenedRequestId,
    lastOpenedXSessionGeneration: xSession, openingProvider: state.openingProvider ?? null,
    openRequestId: state.openRequestId ?? null, closeRequestId: null,
    panelMode: state.panelMode === 'collapsed' ? 'collapsed' : 'expanded'
  };
}

export function panelCommit(state, snapshot, xSession, mode) {
  if (!['expanded', 'collapsed'].includes(mode)) throw new Error('PANEL_INVALID_MODE');
  for (const [key, value] of Object.entries(snapshot)) {
    const current = key === 'panelMode' ? (state.panelMode === 'collapsed' ? 'collapsed' : 'expanded') : state[key] ?? null;
    if (current !== value) throw new Error('PANEL_BUSY_OR_STALE');
  }
  if (xSession !== snapshot.lastOpenedXSessionGeneration) throw new Error('PANEL_BUSY_OR_STALE');
  return {...state, panelMode: mode, updatedAt: new Date().toISOString()};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, ...args] = process.argv.slice(2);
  try {
    if (operation === 'geometry') {
      const geometry = panelGeometry(...args);
      if (!geometry) throw new Error('PANEL_LAYOUT_UNSUPPORTED');
      console.log([geometry.leftPosition, geometry.leftSize, geometry.panelPosition, geometry.panelSize, geometry.screen].join('\t'));
    } else {
      const [statePath, generationPath, ...rest] = args;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const generation = fs.readFileSync(generationPath, 'utf8').trim();
      if (operation === 'snapshot') {
        console.log(JSON.stringify(panelSnapshot(state, generation, {
          internal: rest[0] === 'internal', provider: rest[1], session: rest[2], generation: rest[3]
        })));
      } else if (operation === 'check' || operation === 'commit') {
        const next = panelCommit(state, JSON.parse(rest[0]), generation, rest[1]);
        if (operation === 'commit') {
          const temporary = `${statePath}.panel-${process.pid}.tmp`;
          try {
            fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {mode: fs.statSync(statePath).mode & 0o777});
            fs.renameSync(temporary, statePath);
          } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        }
      } else throw new Error('PANEL_INVALID_OPERATION');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
