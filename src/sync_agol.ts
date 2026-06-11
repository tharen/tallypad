/**
 * sync_agol.ts
 *
 * Bidirectional sync between TallypadDB (Dexie/IndexedDB) and an ESRI Feature
 * Service REST endpoint.  Conflict resolution: local wins (last-write-wins on
 * the local side).
 *
 * Strategy per layer / table:
 *   1. Pull all records from the service (query where 1=1).
 *   2. Insert them into local Dexie tables ONLY when the record does NOT
 *      already exist locally -- we never overwrite a local record with a remote
 *      one (local wins).
 *   3. Push every local record to the service using applyEdits with
 *      useGlobalIds=true, sending adds for records the service does not know
 *      and updates for records it does.
 *
 * Schema notes:
 *   - Service spatial reference is WKID 4326 (WGS-84) for both feature layers.
 *   - All tables carry a "guid" field used as the primary key locally and
 *     matched server-side via applyEdits with useGlobalIds=true.
 *   - tenyr: service field is SmallInteger, local type is number. Send null
 *     when undefined; no coercion required.
 */

// TODO: Query adds/updates/deletes instead of full database
// FIXME: Records with text exceeding the field width on the server will fail to sync.
//        Capture these in a local table so the user can fix them

import { db, IPlot, IGpsPoint, IPlotVisit, ITree, ITreeMeasurement, ILookups, IEdit, ISyncError } from './db';
import { useAppStore } from './stores/appStore'

/** Helper to convert empty string or other falsy values to null, and coerce numbers to valid numbers or null */
function toEsriNumber(val: unknown): number | null {
  if (val === '' || val === undefined || val === null) {
    return null;
  }
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function hasChanges(localAttrs: Record<string, unknown>, remoteAttrs: Record<string, unknown>): boolean {
  const remoteLower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(remoteAttrs)) {
    remoteLower.set(k.toLowerCase(), v);
  }

  for (const [key, localVal] of Object.entries(localAttrs)) {
    const remoteVal = remoteLower.get(key.toLowerCase());
    
    const normalizedLocal = (localVal === null || localVal === undefined || localVal === '') ? null : localVal;
    const normalizedRemote = (remoteVal === null || remoteVal === undefined || remoteVal === '') ? null : remoteVal;
    
    if (normalizedLocal !== normalizedRemote) {
      if (typeof normalizedLocal === 'number' && typeof normalizedRemote === 'number') {
        if (Math.abs(normalizedLocal - normalizedRemote) > 0.00001) {
          return true;
        }
      } else if (String(normalizedLocal) !== String(normalizedRemote)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// App state -- replace with your actual reactive state source (Pinia, etc.)
// ---------------------------------------------------------------------------
// export interface AppState {
//   userName: string;
//   esriToken: string;
// }

const store = useAppStore();

// ---------------------------------------------------------------------------
// Service configuration
// ---------------------------------------------------------------------------
const SERVICE_URL = import.meta.env.VITE_PLOT_SERVICE_URL;

// Layer / table IDs from grow_mon_svc.json
const LAYER = {
  plot:        1,
  tree:        2,
  visit:       3,
  measurement: 4,
  gps_point:   5,
  lookup:      6,
  edit:        7,
} as const;

// WGS-84 spatial reference sent with every geometry object
const SR_4326 = { wkid: 4326 };

// ---------------------------------------------------------------------------
// Low-level REST helpers
// ---------------------------------------------------------------------------

type EsriFeature = {
  attributes: Record<string, unknown>;
  geometry?: Record<string, unknown>;
};

type ApplyEditsResponse = {
  addResults?:    { objectId: number; globalId: string; success: boolean; error?: { code: number; description: string } }[];
  updateResults?: { objectId: number; globalId: string; success: boolean; error?: { code: number; description: string } }[];
  deleteResults?: { objectId: number; success: boolean }[];
};

/** POST helper -- wraps form-encoded ESRI REST requests */
async function esriPost(url: string, params: Record<string, string>, token: string): Promise<unknown> {
  const body = new URLSearchParams({ ...params, token, f: 'json' });
  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} -- ${url}`);
  }
  const json = await response.json() as { error?: { code: number; message: string } };
  if (json.error) {
    throw new Error(`ESRI error ${json.error.code}: ${json.error.message}`);
  }
  return json;
}

/** Query all features/rows from a layer, handling maxRecordCount pagination */
async function queryAll(layerId: number, token: string): Promise<EsriFeature[]> {
  const baseUrl = `${SERVICE_URL}/${layerId}/query`;
  const collected: EsriFeature[] = [];
  let offset = 0;
  const pageSize = 2000;

  while (true) {
    const result = await esriPost(baseUrl, {
      where:             '1=1',
      outFields:         '*',
      returnGeometry:    'true',
      resultOffset:      String(offset),
      resultRecordCount: String(pageSize),
    }, token) as { features?: EsriFeature[]; exceededTransferLimit?: boolean };

    const features = result.features ?? [];
    collected.push(...features);

    if (!result.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }

  console.log('Layer', layerId, 'collected', collected.length, 'features');
  return collected;
}

/** Send adds + updates to a layer using useGlobalIds */
async function applyEdits(
  layerId: number,
  adds: EsriFeature[],
  updates: EsriFeature[],
  token: string,
): Promise<ApplyEditsResponse> {
  if (adds.length === 0 && updates.length === 0) return {};
  const url = `${SERVICE_URL}/${layerId}/applyEdits`;
  const result = await esriPost(url, {
    adds:              JSON.stringify(adds),
    updates:           JSON.stringify(updates),
    useGlobalIds:      'false',
    rollbackOnFailure: 'false',
  }, token) as ApplyEditsResponse;
  return result;
}

// ---------------------------------------------------------------------------
// Field-mapping helpers
// ---------------------------------------------------------------------------

/** Strip fields that ESRI manages (read-only) so we do not send them on push */
function stripReadOnly(attrs: Record<string, unknown>): Record<string, unknown> {
  const readOnly = new Set([
    'OBJECTID', 'GlobalID',
    'created_user', 'created_date',
    'last_edited_user', 'last_edited_date',
    // gps_point layer uses different editor-tracking field names
    'CreationDate', 'Creator', 'EditDate', 'Editor',
  ]);
  return Object.fromEntries(Object.entries(attrs).filter(([k]) => !readOnly.has(k)));
}

/**
 * Build a WGS-84 point geometry for a plot feature.
 * Uses planned_latitude / planned_longitude when present; falls back to the
 * stored Shape (which may already be an ESRI point JSON from a prior sync).
 * Returns null when no coordinates are available, which skips the geometry
 * key on push -- the service will leave the existing geometry unchanged.
 */
function buildPlotGeometry(plot: IPlot): Record<string, unknown> | null {
  if (plot.planned_latitude != null && plot.planned_longitude != null) {
    return { x: plot.planned_longitude, y: plot.planned_latitude, spatialReference: SR_4326 };
  }
  if (plot.Shape) {
    const s = plot.Shape as Record<string, unknown>;
    if ('x' in s && 'y' in s) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-table sync functions
// ---------------------------------------------------------------------------

// ---- Plots (layer 1, Feature Layer) ----------------------------------------

async function syncPlots(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('plots').delete();
  const remote = await queryAll(LAYER.plot, token);
  // console.log('plots', remote.length)

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.plots.toArray();
  const localByGuid = new Map(locals.map(p => [p.guid.toUpperCase(), p]));

  // Ingest remote records that do not exist locally (local wins on conflict)
  const toAdd: IPlot[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:               a['guid'] as string,
      plotid:             a['plotid'] as string,
      Shape:              f.geometry ?? null,
      established:        a['established_date'] as number | undefined,
      planned_latitude:   a['planned_latitude'] as number | undefined,
      planned_longitude:  a['planned_longitude'] as number | undefined,
      remarks:            a['remarks'] as string | undefined,
      OBJECTID:           a['OBJECTID'] as number | undefined,
      GlobalID:           a['GlobalID'] as string | undefined,
      created_user:       a['created_user'] as string | undefined,
      created_date:       a['created_date'] as number | undefined,
      last_edited_user:   a['last_edited_user'] as string | undefined,
      last_edited_date:   a['last_edited_date'] as number | undefined,
    });
  }
  if (toAdd.length) await db.plots.bulkAdd(toAdd);

  // Push all local records to the service
  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const plot of locals) {
    const attrs = stripReadOnly({
      guid:              plot.guid,
      plotid:            plot.plotid,
      established_date:  toEsriNumber(plot.established),
      planned_latitude:  toEsriNumber(plot.planned_latitude),
      planned_longitude: toEsriNumber(plot.planned_longitude),
      remarks:           plot.remarks ?? null,
    });

    const geo = buildPlotGeometry(plot);
    const feature: EsriFeature = geo
      ? { attributes: attrs, geometry: geo }
      : { attributes: attrs };

    const remoteFeature = remoteByGuid.get(plot.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push(feature);
      }
    } else {
      adds.push(feature);
    }
  }

  const result = await applyEdits(LAYER.plot, adds, updates, token);
  await logApplyResults('plots', result, adds, updates);
}

// ---- GpsPoints (layer 5, Feature Layer) ------------------------------------

async function syncGpsPoints(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('gps_points').delete();
  const remote = await queryAll(LAYER.gps_point, token);
  console.log('GpsPoints', remote.length)

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.plotGpsPoints.toArray();
  const localByGuid = new Map(locals.map(l => [l.guid.toUpperCase(), l]));

  const toAdd: IGpsPoint[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:       a['guid'] as string,
      plot_guid:  a['plot_guid'] as string,
      latitude:   a['latitude'] as number,
      longitude:  a['longitude'] as number,
      time:       a['time'] as number,
      model:      a['model'] as string,
      fix:        a['fix'] as number,
      sat:        a['sat'] as number,
      hdop:       a['hdop'] as number,
      vdop:       a['vdop'] as number,
      pdop:       a['pdop'] as number,
      ageofdgpsd: a['ageofdgpsd'] as number,
      remarks:    a['remarks'] as string,
      OBJECTID:   a['OBJECTID'] as number | undefined,
      GlobalID:   a['GlobalID'] as string | undefined,
    });
  }
  if (toAdd.length) await db.plotGpsPoints.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const loc of locals) {
    const attrs = stripReadOnly({
      guid:       loc.guid,
      plot_guid:  loc.plot_guid,
      latitude:   toEsriNumber(loc.latitude),
      longitude:  toEsriNumber(loc.longitude),
      time:       toEsriNumber(loc.time),
      model:      loc.model,
      fix:        toEsriNumber(loc.fix),
      sat:        toEsriNumber(loc.sat),
      hdop:       toEsriNumber(loc.hdop),
      vdop:       toEsriNumber(loc.vdop),
      pdop:       toEsriNumber(loc.pdop),
      ageofdgpsd: toEsriNumber(loc.ageofdgpsd),
      remarks:    loc.remarks,
    });

    const feature: EsriFeature = {
      attributes: attrs,
      geometry:   { x: loc.longitude, y: loc.latitude, spatialReference: SR_4326 },
    };

    const remoteFeature = remoteByGuid.get(loc.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push(feature);
      }
    } else {
      adds.push(feature);
    }
  }

  const result = await applyEdits(LAYER.gps_point, adds, updates, token);
  await logApplyResults('gps_points', result, adds, updates);
}

// ---- Visits (table 3) ------------------------------------------------------

async function syncVisits(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('visits').delete();
  const remote = await queryAll(LAYER.visit, token);

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.plotVisits.toArray();
  const localByGuid = new Map(locals.map(v => [v.guid.toUpperCase(), v]));

  const toAdd: IPlotVisit[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:             a['guid'] as string,
      plot_guid:        a['plot_guid'] as string,
      measurement_date: a['measurement_date'] as number,
      visit_number:     a['visit_number'] as number,
      status:           a['status'] as string | undefined,
      crew:             a['crew'] as string | undefined,
      remarks:          a['remarks'] as string | undefined,
      OBJECTID:         a['OBJECTID'] as number | undefined,
      GlobalID:         a['GlobalID'] as string | undefined,
      created_user:     a['created_user'] as string | undefined,
      created_date:     a['created_date'] as number | undefined,
      last_edited_user: a['last_edited_user'] as string | undefined,
      last_edited_date: a['last_edited_date'] as number | undefined,
    });
  }
  if (toAdd.length) await db.plotVisits.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const visit of locals) {
    const attrs = stripReadOnly({
      guid:             visit.guid,
      plot_guid:        visit.plot_guid,
      measurement_date: toEsriNumber(visit.measurement_date),
      visit_number:     toEsriNumber(visit.visit_number),
      status:           visit.status ?? null,
      crew:             visit.crew ?? null,
      remarks:          visit.remarks ?? null,
    });

    const remoteFeature = remoteByGuid.get(visit.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push({ attributes: attrs });
      }
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.visit, adds, updates, token);
  await logApplyResults('visits', result, adds, updates);
}

// ---- Trees (table 2) -------------------------------------------------------

async function syncTrees(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('trees').delete();
  const remote = await queryAll(LAYER.tree, token);

  // Service tree table now has a "guid" field -- key on it like every other table
  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.plotTrees.toArray();
  const localByGuid = new Map(locals.map(t => [t.guid.toUpperCase(), t]));

  const toAdd: ITree[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:             a['guid'] as string,
      plot_guid:        a['plot_guid'] as string,
      tree_num:         a['tree_num'] as number,
      sp:               a['sp'] as string,
      az:               a['az'] as number | undefined,
      hd:               a['hd'] as number | undefined,
      ref:              a['ref'] as string | undefined,
      sd:               a['sd'] as number | undefined,
      remarks:          a['remarks'] as string | undefined,
      OBJECTID:         a['OBJECTID'] as number | undefined,
      GlobalID:         a['GlobalID'] as string | undefined,
      created_user:     a['created_user'] as string | undefined,
      created_date:     a['created_date'] as number | undefined,
      last_edited_user: a['last_edited_user'] as string | undefined,
      last_edited_date: a['last_edited_date'] as number | undefined,
    });
  }
  if (toAdd.length) await db.plotTrees.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const tree of locals) {
    const attrs = stripReadOnly({
      guid:      tree.guid,
      plot_guid: tree.plot_guid,
      tree_num:  toEsriNumber(tree.tree_num),
      sp:        tree.sp,
      az:        toEsriNumber(tree.az),
      hd:        toEsriNumber(tree.hd),
      ref:       toEsriNumber(tree.ref),
      sd:        toEsriNumber(tree.sd),
      remarks:   tree.remarks ?? null,
    });

    const remoteFeature = remoteByGuid.get(tree.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push({ attributes: attrs });
      }
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.tree, adds, updates, token);
  await logApplyResults('trees', result, adds, updates);
}

// ---- Measurements (table 4) ------------------------------------------------

async function syncMeasurements(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('measurements').delete();
  const remote = await queryAll(LAYER.measurement, token);

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.treeMeasurements.toArray();
  const localByGuid = new Map(locals.map(m => [m.guid.toUpperCase(), m]));

  const toAdd: ITreeMeasurement[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:       a['guid'] as string,
      tree_guid:  a['tree_guid'] as string,
      visit_guid: a['visit_guid'] as string,
      gp:         a['gp'] as string,
      gt:         a['gt'] as number,
      dbh:        a['dbh'] as number,
      s:          a['s'] as string,
      fc:         a['fc'] as number | undefined,
      ht:         a['ht'] as number | undefined,
      age:        a['age'] as number | undefined,
      cr:         a['cr'] as number | undefined,
      cc:         a['cc'] as number | undefined,
      d1:         a['d1'] as number | undefined,
      s1:         a['s1'] as number | undefined,
      d2:         a['d2'] as number | undefined,
      s2:         a['s2'] as number | undefined,
      d3:         a['d3'] as number | undefined,
      s3:         a['s3'] as number | undefined,
      def1:       a['def1'] as number | undefined,
      def2:       a['def2'] as number | undefined,
      def3:       a['def3'] as number | undefined,
      c:          a['c'] as number | undefined,
      bt:         a['bt'] as number | undefined,
      upstht:     a['upstht'] as number | undefined,
      upstd:      a['upstd'] as number | undefined,
      fiveyr:     a['fiveyr'] as number | undefined,
      tenyr:      a['tenyr'] as number | undefined,
      remarks:    a['remarks'] as string | undefined,
      OBJECTID:   a['OBJECTID'] as number | undefined,
      GlobalID:   a['GlobalID'] as string | undefined,
      created_user:     a['created_user'] as string | undefined,
      created_date:     a['created_date'] as number | undefined,
      last_edited_user: a['last_edited_user'] as string | undefined,
      last_edited_date: a['last_edited_date'] as number | undefined,
    });
  }
  if (toAdd.length) await db.treeMeasurements.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const m of locals) {
    const attrs = stripReadOnly({
      guid:       m.guid,
      tree_guid:  m.tree_guid,
      visit_guid: m.visit_guid,
      gp:         m.gp,
      gt:         toEsriNumber(m.gt),
      dbh:        toEsriNumber(m.dbh),
      s:          toEsriNumber(m.s),
      fc:         toEsriNumber(m.fc),
      ht:         toEsriNumber(m.ht),
      age:        toEsriNumber(m.age),
      cr:         toEsriNumber(m.cr),
      cc:         toEsriNumber(m.cc),
      d1:         toEsriNumber(m.d1),
      s1:         toEsriNumber(m.s1),
      d2:         toEsriNumber(m.d2),
      s2:         toEsriNumber(m.s2),
      d3:         toEsriNumber(m.d3),
      s3:         toEsriNumber(m.s3),
      def1:       toEsriNumber(m.def1),
      def2:       toEsriNumber(m.def2),
      def3:       toEsriNumber(m.def3),
      c:          toEsriNumber(m.c),
      bt:         toEsriNumber(m.bt),
      upstht:     toEsriNumber(m.upstht),
      upstd:      toEsriNumber(m.upstd),
      fiveyr:     toEsriNumber(m.fiveyr),
      tenyr:      toEsriNumber(m.tenyr),
      remarks:    m.remarks ?? null,
    });

    const remoteFeature = remoteByGuid.get(m.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push({ attributes: attrs });
      }
    } else {
      adds.push({ attributes: attrs });
    }
  }

  // console.log('measurements - Adds:', adds.length, 'Updates:', updates.length);
  // console.log(adds);

  const result = await applyEdits(LAYER.measurement, adds, updates, token);
  await logApplyResults('measurements', result, adds, updates);
}

// ---- Lookups (table 6) -----------------------------------------------------

async function syncLookups(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('lookups').delete();
  const remote = await queryAll(LAYER.lookup, token);

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.lookups.toArray();
  const localByGuid = new Map(locals.map(l => [l.guid.toUpperCase(), l]));

  const toAdd: ILookups[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:        a['guid'] as string,
      feature:     a['feature'] as string,
      code:        a['code'] as string,
      value:       a['value'] as string,
      description: a['description'] as string,
      OBJECTID:    a['OBJECTID'] as number | undefined,
      GlobalID:    a['GlobalID'] as string | undefined,
    });
  }
  if (toAdd.length) await db.lookups.bulkAdd(toAdd);

  // Push any locally-created lookups back to the service
  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const lookup of locals) {
    const attrs = stripReadOnly({
      guid:        lookup.guid,
      feature:     lookup.feature,
      code:        lookup.code,
      value:       lookup.value,
      description: lookup.description,
    });

    const remoteFeature = remoteByGuid.get(lookup.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push({ attributes: attrs });
      }
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.lookup, adds, updates, token);
  await logApplyResults('lookups', result, adds, updates);
}

// ---- Edits (table 7) -------------------------------------------------------

async function syncEdits(token: string): Promise<void> {
  await db.syncErrors.where('table_name').equals('edits').delete();
  const remote = await queryAll(LAYER.edit, token);

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.edits.toArray();
  const localByGuid = new Map(locals.map(e => [e.guid.toUpperCase(), e]));

  const toAdd: IEdit[] = [];
  for (const f of remote) {
    const g = (f.attributes['guid'] as string | undefined)?.toUpperCase();
    if (!g || localByGuid.has(g)) continue;
    const a = f.attributes;
    toAdd.push({
      guid:        a['guid'] as string,
      table_name:  a['table_name'] as string,
      record_guid: a['record_guid'] as string,
      field_name:  a['field_name'] as string,
      old_value:   a['old_value'] as string,
      new_value:   a['new_value'] as string,
      reason:      a['reason'] as string,
      edit_date:   a['edit_date'] as number,
      OBJECTID:    a['OBJECTID'] as number | undefined,
      GlobalID:    a['GlobalID'] as string | undefined,
    });
  }
  if (toAdd.length) await db.edits.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const edit of locals) {
    const attrs = stripReadOnly({
      guid:        edit.guid,
      table_name:  edit.table_name,
      record_guid: edit.record_guid,
      field_name:  edit.field_name,
      old_value:   edit.old_value,
      new_value:   edit.new_value,
      reason:      edit.reason,
      edit_date:   toEsriNumber(edit.edit_date),
    });

    const remoteFeature = remoteByGuid.get(edit.guid.toUpperCase());
    if (remoteFeature) {
      if (hasChanges(attrs, remoteFeature.attributes)) {
        attrs['OBJECTID'] = remoteFeature.attributes['OBJECTID'];
        updates.push({ attributes: attrs });
      }
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.edit, adds, updates, token);
  await logApplyResults('edits', result, adds, updates);
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

async function logApplyResults(
  table: string,
  result: ApplyEditsResponse,
  adds: EsriFeature[],
  updates: EsriFeature[]
): Promise<void> {
  const failedAdds    = (result.addResults    ?? []).filter(r => !r.success);
  const failedUpdates = (result.updateResults ?? []).filter(r => !r.success);

  if (failedAdds.length || failedUpdates.length) {
    console.warn(`[sync] ${table} -- ${failedAdds.length} add failure(s), ${failedUpdates.length} update failure(s)`);
    for (const r of [...failedAdds, ...failedUpdates]) {
      console.warn(`  globalId=${r.globalId} error=${r.error?.code} ${r.error?.description}`);
    }

    const errorsToInsert: ISyncError[] = [];
    if (result.addResults) {
      for (let i = 0; i < result.addResults.length; i++) {
        const r = result.addResults[i];
        if (!r.success) {
          const guid = adds[i]?.attributes?.['guid'] as string;
          errorsToInsert.push({
            table_name: table,
            record_guid: guid || r.globalId || 'unknown',
            error_message: r.error ? `Code ${r.error.code}: ${r.error.description}` : 'Unknown error',
            timestamp: Date.now()
          });
        }
      }
    }
    if (result.updateResults) {
      for (let i = 0; i < result.updateResults.length; i++) {
        const r = result.updateResults[i];
        if (!r.success) {
          const guid = updates[i]?.attributes?.['guid'] as string;
          errorsToInsert.push({
            table_name: table,
            record_guid: guid || r.globalId || 'unknown',
            error_message: r.error ? `Code ${r.error.code}: ${r.error.description}` : 'Unknown error',
            timestamp: Date.now()
          });
        }
      }
    }
    if (errorsToInsert.length > 0) {
      await db.syncErrors.bulkAdd(errorsToInsert);
    }
  } else {
    const added   = (result.addResults    ?? []).length;
    const updated = (result.updateResults ?? []).length;
    if (added || updated) {
      console.info(`[sync] ${table} -- pushed ${added} add(s), ${updated} update(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  errors: Record<string, string>;
}

/**
 * Run a full bidirectional sync for all tables.
 *
 * Order matters: parents before children to avoid FK violations on the server.
 *   plots -> GpsPoints -> visits -> trees -> measurements -> lookups -> edits
 */
export type SyncStep = 'plots' | 'gps_points' | 'visits' | 'trees' | 'measurements' | 'lookups' | 'edits';
export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface SyncProgress {
  step: SyncStep;
  status: SyncStatus;
  message?: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export async function syncAll(
  state: ReturnType<typeof useAppStore>,
  onProgress?: SyncProgressCallback
): Promise<SyncResult> {
  if (state.isTokenExpired.value && state.esriRefreshToken.value) {
    const refreshResult = await state.refreshEsriToken();
    if (refreshResult === 'PERMANENT_FAILURE') {
      state.logoutEsri();
      return { success: false, errors: { auth: 'ESRI session expired. Please log in again.' } };
    } else if (!refreshResult) {
      return { success: false, errors: { auth: 'Network error: Unable to refresh ESRI token.' } };
    }
  }

  const esriToken = state.esriToken.value;
  if (!esriToken) {
    return { success: false, errors: { auth: 'No ESRI token available' } };
  }

  const errors: Record<string, string> = {};

  if (onProgress) {
    const allSteps: SyncStep[] = ['plots', 'gps_points', 'visits', 'trees', 'measurements', 'lookups', 'edits'];
    for (const step of allSteps) {
      onProgress({ step, status: 'pending' });
    }
  }

  const steps: [SyncStep, () => Promise<void>][] = [
    ['plots',        () => syncPlots(esriToken)],
    ['gps_points',   () => syncGpsPoints(esriToken)],
    ['visits',       () => syncVisits(esriToken)],
    ['trees',        () => syncTrees(esriToken)],
    ['measurements', () => syncMeasurements(esriToken)],
    ['lookups',      () => syncLookups(esriToken)],
    ['edits',        () => syncEdits(esriToken)],
  ];

  for (const [name, fn] of steps) {
    try {
      if (onProgress) {
        onProgress({ step: name, status: 'syncing' });
      }
      await fn();
      if (onProgress) {
        onProgress({ step: name, status: 'completed' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${name} failed:`, message);
      errors[name] = message;

      await db.syncErrors.add({
        table_name: name,
        record_guid: 'ALL',
        error_message: message,
        timestamp: Date.now()
      });

      if (onProgress) {
        onProgress({ step: name, status: 'failed', message });
      }
    }
  }

  await state.checkSyncErrors();
  return { success: Object.keys(errors).length === 0, errors };
}

/**
 * Sync a single named layer / table.
 * Useful for targeted refreshes, e.g. immediately after a local edit.
 */
export async function syncTable(
  table: keyof typeof LAYER,
  state: ReturnType<typeof useAppStore>,
): Promise<void> {
  if (state.isTokenExpired.value && state.esriRefreshToken.value) {
    const refreshResult = await state.refreshEsriToken();
    if (refreshResult === 'PERMANENT_FAILURE') {
      state.logoutEsri();
      throw new Error('ESRI session expired. Please log in again.');
    } else if (!refreshResult) {
      throw new Error('Network error: Unable to refresh ESRI token.');
    }
  }

  const esriToken = state.esriToken.value;
  if (!esriToken) {
    throw new Error('No ESRI token available');
  }

  const dispatch: Record<keyof typeof LAYER, () => Promise<void>> = {
    plot:        () => syncPlots(esriToken),
    gps_point:    () => syncGpsPoints(esriToken),
    visit:       () => syncVisits(esriToken),
    tree:        () => syncTrees(esriToken),
    measurement: () => syncMeasurements(esriToken),
    lookup:      () => syncLookups(esriToken),
    edit:        () => syncEdits(esriToken),
  };
  await dispatch[table]();
  await state.checkSyncErrors();
}