/**
 * sync.ts
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

import { db, IPlot, ILocation, IPlotVisit, ITree, ITreeMeasurement, ILookups, IEdit } from './db';
import { useAppStore } from './stores/appStore'

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
const SERVICE_URL =
  'https://services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/Growth_Monitoring_Plots/FeatureServer';

// Layer / table IDs from grow_mon_svc.json
const LAYER = {
  plot:        1,
  tree:        2,
  visit:       3,
  measurement: 4,
  location:    5,
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
    useGlobalIds:      'true',
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
    // location layer uses different editor-tracking field names
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
      established_date:  plot.established ?? null,
      planned_latitude:  plot.planned_latitude ?? null,
      planned_longitude: plot.planned_longitude ?? null,
      remarks:           plot.remarks ?? null,
    });

    const geo = buildPlotGeometry(plot);
    const feature: EsriFeature = geo
      ? { attributes: attrs, geometry: geo }
      : { attributes: attrs };

    if (remoteByGuid.has(plot.guid.toUpperCase())) {
      updates.push(feature);
    } else {
      adds.push(feature);
    }
  }

  const result = await applyEdits(LAYER.plot, adds, updates, token);
  logApplyResults('plots', result);
}

// ---- Locations (layer 5, Feature Layer) ------------------------------------

async function syncLocations(token: string): Promise<void> {
  const remote = await queryAll(LAYER.location, token);
  console.log('locations', remote.length)

  const remoteByGuid = new Map<string, EsriFeature>();
  for (const f of remote) {
    const g = f.attributes['guid'] as string | undefined;
    if (g) remoteByGuid.set(g.toUpperCase(), f);
  }

  const locals = await db.plotLocations.toArray();
  const localByGuid = new Map(locals.map(l => [l.guid.toUpperCase(), l]));

  const toAdd: ILocation[] = [];
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
  if (toAdd.length) await db.plotLocations.bulkAdd(toAdd);

  const adds:    EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  for (const loc of locals) {
    const attrs = stripReadOnly({
      guid:       loc.guid,
      plot_guid:  loc.plot_guid,
      latitude:   loc.latitude,
      longitude:  loc.longitude,
      time:       loc.time,
      model:      loc.model,
      fix:        loc.fix,
      sat:        loc.sat,
      hdop:       loc.hdop,
      vdop:       loc.vdop,
      pdop:       loc.pdop,
      ageofdgpsd: loc.ageofdgpsd,
      remarks:    loc.remarks,
    });

    const feature: EsriFeature = {
      attributes: attrs,
      geometry:   { x: loc.longitude, y: loc.latitude, spatialReference: SR_4326 },
    };

    if (remoteByGuid.has(loc.guid.toUpperCase())) {
      updates.push(feature);
    } else {
      adds.push(feature);
    }
  }

  const result = await applyEdits(LAYER.location, adds, updates, token);
  logApplyResults('locations', result);
}

// ---- Visits (table 3) ------------------------------------------------------

async function syncVisits(token: string): Promise<void> {
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
      measurement_date: visit.measurement_date,
      visit_number:     visit.visit_number,
      status:           visit.status ?? null,
      crew:             visit.crew ?? null,
      remarks:          visit.remarks ?? null,
    });

    if (remoteByGuid.has(visit.guid.toUpperCase())) {
      updates.push({ attributes: attrs });
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.visit, adds, updates, token);
  logApplyResults('visits', result);
}

// ---- Trees (table 2) -------------------------------------------------------

async function syncTrees(token: string): Promise<void> {
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
      tree_num:  tree.tree_num,
      sp:        tree.sp,
      az:        tree.az ?? null,
      hd:        tree.hd ?? null,
      ref:       tree.ref ?? null,
      sd:        tree.sd ?? null,
      remarks:   tree.remarks ?? null,
    });

    if (remoteByGuid.has(tree.guid.toUpperCase())) {
      updates.push({ attributes: attrs });
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.tree, adds, updates, token);
  logApplyResults('trees', result);
}

// ---- Measurements (table 4) ------------------------------------------------

async function syncMeasurements(token: string): Promise<void> {
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
      gt:         m.gt,
      dbh:        m.dbh,
      s:          m.s,
      fc:         m.fc ?? null,
      ht:         m.ht ?? null,
      age:        m.age ?? null,
      cr:         m.cr ?? null,
      cc:         m.cc ?? null,
      d1:         m.d1 ?? null,
      s1:         m.s1 ?? null,
      d2:         m.d2 ?? null,
      s2:         m.s2 ?? null,
      d3:         m.d3 ?? null,
      s3:         m.s3 ?? null,
      def1:       m.def1 ?? null,
      def2:       m.def2 ?? null,
      def3:       m.def3 ?? null,
      c:          m.c ?? null,
      bt:         m.bt ?? null,
      upstht:     m.upstht ?? null,
      upstd:      m.upstd ?? null,
      fiveyr:     m.fiveyr ?? null,
      tenyr:      m.tenyr ?? null,
      remarks:    m.remarks ?? null,
    });

    if (remoteByGuid.has(m.guid.toUpperCase())) {
      updates.push({ attributes: attrs });
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.measurement, adds, updates, token);
  logApplyResults('measurements', result);
}

// ---- Lookups (table 6) -----------------------------------------------------

async function syncLookups(token: string): Promise<void> {
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

    if (remoteByGuid.has(lookup.guid.toUpperCase())) {
      updates.push({ attributes: attrs });
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.lookup, adds, updates, token);
  logApplyResults('lookups', result);
}

// ---- Edits (table 7) -------------------------------------------------------

async function syncEdits(token: string): Promise<void> {
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
      edit_date:   edit.edit_date,
    });

    if (remoteByGuid.has(edit.guid.toUpperCase())) {
      updates.push({ attributes: attrs });
    } else {
      adds.push({ attributes: attrs });
    }
  }

  const result = await applyEdits(LAYER.edit, adds, updates, token);
  logApplyResults('edits', result);
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function logApplyResults(table: string, result: ApplyEditsResponse): void {
  const failedAdds    = (result.addResults    ?? []).filter(r => !r.success);
  const failedUpdates = (result.updateResults ?? []).filter(r => !r.success);

  if (failedAdds.length || failedUpdates.length) {
    console.warn(`[sync] ${table} -- ${failedAdds.length} add failure(s), ${failedUpdates.length} update failure(s)`);
    for (const r of [...failedAdds, ...failedUpdates]) {
      console.warn(`  globalId=${r.globalId} error=${r.error?.code} ${r.error?.description}`);
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
 *   plots -> locations -> visits -> trees -> measurements -> lookups -> edits
 */
export async function syncAll(state: ReturnType<typeof useAppStore> ): Promise<SyncResult> {
  const esriToken = state.esriToken.value;
  if (!esriToken) {
    return { success: false, errors: { auth: 'No ESRI token available' } };
  }

  const errors: Record<string, string> = {};

  const steps: [string, () => Promise<void>][] = [
    ['plots',        () => syncPlots(esriToken)],
    ['locations',    () => syncLocations(esriToken)],
    ['visits',       () => syncVisits(esriToken)],
    ['trees',        () => syncTrees(esriToken)],
    ['measurements', () => syncMeasurements(esriToken)],
    ['lookups',      () => syncLookups(esriToken)],
    ['edits',        () => syncEdits(esriToken)],
  ];

  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${name} failed:`, message);
      errors[name] = message;
    }
  }

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
  const esriToken = state.esriToken.value;
  if (!esriToken) {
    throw new Error('No ESRI token available');
  }

  const dispatch: Record<keyof typeof LAYER, () => Promise<void>> = {
    plot:        () => syncPlots(esriToken),
    location:    () => syncLocations(esriToken),
    visit:       () => syncVisits(esriToken),
    tree:        () => syncTrees(esriToken),
    measurement: () => syncMeasurements(esriToken),
    lookup:      () => syncLookups(esriToken),
    edit:        () => syncEdits(esriToken),
  };
  await dispatch[table]();
}