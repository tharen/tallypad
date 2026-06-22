/**
 * sync_agol.ts
 *
 * Bidirectional sync between TallypadDB (Dexie/IndexedDB) and an ESRI Featu * Service REST endpoint using ArcGIS Online Replica REST endpoints (createReplica,
 * synchronizeReplica, and unregisterReplica).
 *
 * Conflict resolution: Last-Write-Wins based on last_edited_date.
 */

import { db, IPlot, IGpsPoint, IPlotVisit, ITree, ITreeMeasurement, ILookups, IEdit, ISyncError } from './db';
import { useAppStore } from './stores/appStore';

/** Helper to convert empty string or other falsy values to null, and coerce numbers to valid numbers or null */
function toEsriNumber(val: unknown): number | null {
  if (val === '' || val === undefined || val === null) {
    return null;
  }
  const num = Number(val);
  return isNaN(num) ? null : num;
}

// function hasChanges(localAttrs: Record<string, unknown>, remoteAttrs: Record<string, unknown>): boolean {
//   const remoteLower = new Map<string, unknown>();
//   for (const [k, v] of Object.entries(remoteAttrs)) {
//     remoteLower.set(k.toLowerCase(), v);
//   }

//   for (const [key, localVal] of Object.entries(localAttrs)) {
//     const remoteVal = remoteLower.get(key.toLowerCase());
    
//     const normalizedLocal = (localVal === null || localVal === undefined || localVal === '') ? null : localVal;
//     const normalizedRemote = (remoteVal === null || remoteVal === undefined || remoteVal === '') ? null : remoteVal;
    
//     if (normalizedLocal !== normalizedRemote) {
//       if (typeof normalizedLocal === 'number' && typeof normalizedRemote === 'number') {
//         if (Math.abs(normalizedLocal - normalizedRemote) > 0.00001) {
//           return true;
//         }
//       } else if (String(normalizedLocal) !== String(normalizedRemote)) {
//         return true;
//       }
//     }
//   }
//   return false;
// }

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const store = useAppStore();

// ---------------------------------------------------------------------------
// Service configuration
// ---------------------------------------------------------------------------
const SERVICE_URL = import.meta.env.VITE_PLOT_SERVICE_URL;

// Layer / table IDs from service_definition.json
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

// ---------------------------------------------------------------------------
// Field-mapping & GUID helpers
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

function getAttrCaseInsensitive(attrs: Record<string, unknown> | undefined, name: string): any {
  if (!attrs) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(attrs)) {
    if (k.toLowerCase() === lower) {
      return v;
    }
  }
  return undefined;
}

function normalizeGuid(guid: string | undefined | null): string {
  if (!guid) return '';
  return guid.replace(/[{}]/g, '').trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Replica Sync Helpers
// ---------------------------------------------------------------------------

const LAYER_TO_TABLE: Record<number, any> = {
  [LAYER.plot]:        db.plots,
  [LAYER.tree]:        db.plotTrees,
  [LAYER.visit]:       db.plotVisits,
  [LAYER.measurement]: db.treeMeasurements,
  [LAYER.gps_point]:   db.plotGpsPoints,
  [LAYER.lookup]:      db.lookups,
  [LAYER.edit]:        db.edits,
};

function mapRemoteToLocal(layerId: number, f: EsriFeature): any {
  const a = f.attributes;
  const rawGuid = getAttrCaseInsensitive(a, 'guid') as string | undefined;
  const g = normalizeGuid(rawGuid);

  const base = {
    guid: rawGuid || g,
    OBJECTID: getAttrCaseInsensitive(a, 'OBJECTID') as number | undefined,
    GlobalID: getAttrCaseInsensitive(a, 'GlobalID') as string | undefined,
    created_user: a['created_user'] as string | undefined,
    created_date: a['created_date'] as number | undefined,
    last_edited_user: a['last_edited_user'] as string | undefined,
    last_edited_date: a['last_edited_date'] as number | undefined,
  };

  switch (layerId) {
    case LAYER.plot:
      return {
        ...base,
        plotid: a['plotid'] as string,
        Shape: f.geometry ?? null,
        established: a['established_date'] as number | undefined,
        planned_latitude: a['planned_latitude'] as number | undefined,
        planned_longitude: a['planned_longitude'] as number | undefined,
        remarks: a['remarks'] as string | undefined,
      };
    case LAYER.gps_point:
      return {
        ...base,
        plot_guid: a['plot_guid'] as string,
        latitude: a['latitude'] as number,
        longitude: a['longitude'] as number,
        time: a['time'] as number,
        model: a['model'] as string,
        fix: a['fix'] as number,
        sat: a['sat'] as number,
        hdop: a['hdop'] as number,
        vdop: a['vdop'] as number,
        pdop: a['pdop'] as number,
        ageofdgpsd: a['ageofdgpsd'] as number,
        remarks: a['remarks'] as string,
      };
    case LAYER.visit:
      return {
        ...base,
        plot_guid: a['plot_guid'] as string,
        measurement_date: a['measurement_date'] as number,
        visit_number: a['visit_number'] as number,
        status: a['status'] as string | undefined,
        crew: a['crew'] as string | undefined,
        remarks: a['remarks'] as string | undefined,
      };
    case LAYER.tree:
      return {
        ...base,
        plot_guid: a['plot_guid'] as string,
        tree_num: a['tree_num'] as number,
        sp: a['sp'] as string,
        az: a['az'] as number | undefined,
        hd: a['hd'] as number | undefined,
        ref: a['ref'] as string | undefined,
        sd: a['sd'] as number | undefined,
        remarks: a['remarks'] as string | undefined,
      };
    case LAYER.measurement:
      return {
        ...base,
        tree_guid: a['tree_guid'] as string,
        visit_guid: a['visit_guid'] as string,
        gp: a['gp'] as string,
        gt: a['gt'] as number,
        dbh: a['dbh'] as number,
        s: a['s'] as number,
        fc: a['fc'] as number | undefined,
        ht: a['ht'] as number | undefined,
        age: a['age'] as number | undefined,
        cr: a['cr'] as number | undefined,
        cc: a['cc'] as number | undefined,
        d1: a['d1'] as number | undefined,
        s1: a['s1'] as number | undefined,
        d2: a['d2'] as number | undefined,
        s2: a['s2'] as number | undefined,
        d3: a['d3'] as number | undefined,
        s3: a['s3'] as number | undefined,
        def1: a['def1'] as number | undefined,
        def2: a['def2'] as number | undefined,
        def3: a['def3'] as number | undefined,
        c: a['c'] as number | undefined,
        bt: a['bt'] as number | undefined,
        upstht: a['upstht'] as number | undefined,
        upstd: a['upstd'] as number | undefined,
        fiveyr: a['fiveyr'] as number | undefined,
        tenyr: a['tenyr'] as number | undefined,
        remarks: a['remarks'] as string | undefined,
      };
    case LAYER.lookup:
      return {
        ...base,
        feature: a['feature'] as string,
        code: a['code'] as string,
        value: a['value'] as string,
        description: a['description'] as string,
      };
    case LAYER.edit:
      return {
        ...base,
        table_name: a['table_name'] as string,
        record_guid: a['record_guid'] as string,
        field_name: a['field_name'] as string,
        old_value: a['old_value'] as string,
        new_value: a['new_value'] as string,
        reason: a['reason'] as string,
        edit_date: a['edit_date'] as number,
      };
    default:
      throw new Error(`Unsupported layer ID: ${layerId}`);
  }
}

async function applyRemoteFeatures(layerId: number, remoteFeatures: EsriFeature[]): Promise<void> {
  const dbTable = LAYER_TO_TABLE[layerId];
  if (!dbTable) return;
  console.log('Sync ', dbTable)

  const locals = await dbTable.toArray();
  const localByGuid = new Map(locals.map((l: any) => [normalizeGuid(l.guid), l]));

  const toAddLocally: any[] = [];
  const toUpdateLocally: any[] = [];

  for (const f of remoteFeatures) {
    const rawGuid = getAttrCaseInsensitive(f.attributes, 'guid') as string | undefined;
    const g = normalizeGuid(rawGuid);
    if (!g) continue;

    const remoteRecord = mapRemoteToLocal(layerId, f);
    const localRecord = localByGuid.get(g);

    if (!localRecord) {
      toAddLocally.push(remoteRecord);
    } else {
      const localTime = localRecord.last_edited_date ?? 0;
      const remoteTime = remoteRecord.last_edited_date ?? 0;
      // Last-Write-Wins: overwrite local copy if remote record is newer, or if local is missing IDs
      if (remoteTime > localTime || localRecord.OBJECTID === undefined || localRecord.OBJECTID === null || localRecord.GlobalID === undefined || localRecord.GlobalID === null) {
        toUpdateLocally.push(remoteRecord);
      }
    }
  }

  if (toAddLocally.length) await dbTable.bulkAdd(toAddLocally);
  if (toUpdateLocally.length) await dbTable.bulkPut(toUpdateLocally);
}

async function applyRemoteDeletes(layerId: number, deletes: any[]): Promise<void> {
  const dbTable = LAYER_TO_TABLE[layerId];
  if (!dbTable || !deletes || deletes.length === 0) return;

  for (const d of deletes) {
    let key: string | number | undefined = undefined;
    if (typeof d === 'string' || typeof d === 'number') {
      key = d;
    } else if (d && typeof d === 'object') {
      key = d.globalId || d.globalID || d.objectId || d.OBJECTID || d.GlobalID;
    }

    if (key !== undefined) {
      let localRecord: any = undefined;
      if (typeof key === 'string') {
        const normalized = normalizeGuid(key);
        const records = await dbTable.toArray();
        localRecord = records.find((r: any) => normalizeGuid(r.GlobalID) === normalized || normalizeGuid(r.guid) === normalized);
      } else if (typeof key === 'number') {
        const records = await dbTable.toArray();
        localRecord = records.find((r: any) => r.OBJECTID === key);
      }

      if (localRecord && localRecord.guid) {
        await dbTable.delete(localRecord.guid);
      }
    }
  }
}

async function getLocalEditsForLayer(
  layerId: number,
  lastSyncTime: number
): Promise<{ adds: EsriFeature[]; updates: EsriFeature[]; deletes: (number | string)[] }> {
  const dbTable = LAYER_TO_TABLE[layerId];
  if (!dbTable) return { adds: [], updates: [], deletes: [] };

  const locals = await dbTable.toArray();
  const adds: EsriFeature[] = [];
  const updates: EsriFeature[] = [];

  let deleteTableName = '';
  if (dbTable === db.plotVisits) deleteTableName = 'visit';
  else if (dbTable === db.plotTrees) deleteTableName = 'tree';
  else if (dbTable === db.treeMeasurements) deleteTableName = 'measurement';

  let deletes: (number | string)[] = [];
  if (deleteTableName) {
    const deletedRecords = await db.deletedRecords
      .where('table_name')
      .equals(deleteTableName)
      .toArray();
    
    // Clear unsynced deletes immediately
    const unsyncedDeletes = deletedRecords
      .filter(d => d.objectid === undefined && d.globalid === undefined)
      .map(d => d.guid);
    if (unsyncedDeletes.length > 0) {
      await db.deletedRecords.bulkDelete(unsyncedDeletes);
    }

    deletes = deletedRecords
      .map(d => d.objectid || d.globalid)
      .filter((id): id is string | number => id !== undefined && id !== null);
  }

  for (const record of locals) {
    const isAdd = record.OBJECTID === undefined || record.OBJECTID === null;
    const isUpdate = !isAdd && record.last_edited_date && record.last_edited_date > lastSyncTime;

    if (isAdd || isUpdate) {
      const attrs = buildFeatureAttributes(layerId, record);
      const feature: EsriFeature = { attributes: attrs };
      if (layerId === LAYER.plot) {
        const geo = buildPlotGeometry(record);
        if (geo) feature.geometry = geo;
      } else if (layerId === LAYER.gps_point) {
        feature.geometry = { x: record.longitude, y: record.latitude, spatialReference: SR_4326 };
      }

      if (isAdd) {
        adds.push(feature);
      } else {
        attrs['OBJECTID'] = record.OBJECTID;
        updates.push(feature);
      }
    }
  }

  return { adds, updates, deletes };
}

function buildFeatureAttributes(layerId: number, record: any): Record<string, unknown> {
  let attrs: Record<string, unknown> = {};

  switch (layerId) {
    case LAYER.plot:
      attrs = {
        guid:              record.guid,
        plotid:            record.plotid,
        established_date:  toEsriNumber(record.established),
        planned_latitude:  toEsriNumber(record.planned_latitude),
        planned_longitude: toEsriNumber(record.planned_longitude),
        remarks:           record.remarks ?? null,
      };
      break;
    case LAYER.gps_point:
      attrs = {
        guid:       record.guid,
        plot_guid:  record.plot_guid,
        latitude:   toEsriNumber(record.latitude),
        longitude:  toEsriNumber(record.longitude),
        time:       toEsriNumber(record.time),
        model:      record.model,
        fix:        toEsriNumber(record.fix),
        sat:        toEsriNumber(record.sat),
        hdop:       toEsriNumber(record.hdop),
        vdop:       toEsriNumber(record.vdop),
        pdop:       toEsriNumber(record.pdop),
        ageofdgpsd: toEsriNumber(record.ageofdgpsd),
        remarks:    record.remarks,
      };
      break;
    case LAYER.visit:
      attrs = {
        guid:             record.guid,
        plot_guid:        record.plot_guid,
        measurement_date: toEsriNumber(record.measurement_date),
        visit_number:     toEsriNumber(record.visit_number),
        status:           record.status ?? null,
        crew:             record.crew ?? null,
        remarks:          record.remarks ?? null,
      };
      break;
    case LAYER.tree:
      attrs = {
        guid:      record.guid,
        plot_guid: record.plot_guid,
        tree_num:  toEsriNumber(record.tree_num),
        sp:        record.sp,
        az:        toEsriNumber(record.az),
        hd:        toEsriNumber(record.hd),
        ref:       toEsriNumber(record.ref),
        sd:        toEsriNumber(record.sd),
        remarks:   record.remarks ?? null,
      };
      break;
    case LAYER.measurement:
      attrs = {
        guid:       record.guid,
        tree_guid:  record.tree_guid,
        visit_guid: record.visit_guid,
        gp:         record.gp,
        gt:         toEsriNumber(record.gt),
        dbh:        toEsriNumber(record.dbh),
        s:          toEsriNumber(record.s),
        fc:         toEsriNumber(record.fc),
        ht:         toEsriNumber(record.ht),
        age:        toEsriNumber(record.age),
        cr:         toEsriNumber(record.cr),
        cc:         toEsriNumber(record.cc),
        d1:         toEsriNumber(record.d1),
        s1:         toEsriNumber(record.s1),
        d2:         toEsriNumber(record.d2),
        s2:         toEsriNumber(record.s2),
        d3:         toEsriNumber(record.d3),
        s3:         toEsriNumber(record.s3),
        def1:       toEsriNumber(record.def1),
        def2:       toEsriNumber(record.def2),
        def3:       toEsriNumber(record.def3),
        c:          toEsriNumber(record.c),
        bt:         toEsriNumber(record.bt),
        upstht:     toEsriNumber(record.upstht),
        upstd:      toEsriNumber(record.upstd),
        fiveyr:     toEsriNumber(record.fiveyr),
        tenyr:      toEsriNumber(record.tenyr),
        remarks:    record.remarks ?? null,
      };
      break;
    case LAYER.lookup:
      attrs = {
        guid:        record.guid,
        feature:     record.feature,
        code:        record.code,
        value:       record.value,
        description: record.description,
      };
      break;
    case LAYER.edit:
      attrs = {
        guid:        record.guid,
        table_name:  record.table_name,
        record_guid: record.record_guid,
        field_name:  record.field_name,
        old_value:   record.old_value,
        new_value:   record.new_value,
        reason:      record.reason,
        edit_date:   toEsriNumber(record.edit_date),
      };
      break;
    default:
      throw new Error(`Unsupported layer ID: ${layerId}`);
  }

  return stripReadOnly(attrs);
}

async function updateLocalIds(
  dbTable: any,
  result: ApplyEditsResponse,
  adds: EsriFeature[],
  updates: EsriFeature[]
): Promise<void> {
  // Update successful additions with OBJECTID and GlobalID
  if (result.addResults && result.addResults.length > 0) {
    for (let i = 0; i < result.addResults.length; i++) {
      const r = result.addResults[i];
      if (r.success) {
        const guid = getAttrCaseInsensitive(adds[i]?.attributes, 'guid') as string | undefined;
        if (guid) {
          const localRecord = await dbTable.get(guid);
          if (localRecord) {
            localRecord.OBJECTID = r.objectId ?? (r as any).objectID ?? (r as any).OBJECTID;
            const remoteGlobalId = r.globalId ?? (r as any).globalID ?? (r as any).GlobalID;
            if (remoteGlobalId) localRecord.GlobalID = remoteGlobalId;
            await dbTable.put(localRecord);
          }
        }
      }
    }
  }

  // Update successful updates with OBJECTID and GlobalID
  if (result.updateResults && result.updateResults.length > 0) {
    for (let i = 0; i < result.updateResults.length; i++) {
      const r = result.updateResults[i];
      if (r.success) {
        const guid = getAttrCaseInsensitive(updates[i]?.attributes, 'guid') as string | undefined;
        if (guid) {
          const localRecord = await dbTable.get(guid);
          if (localRecord) {
            localRecord.OBJECTID = r.objectId ?? (r as any).objectID ?? (r as any).OBJECTID;
            const remoteGlobalId = r.globalId ?? (r as any).globalID ?? (r as any).GlobalID;
            if (remoteGlobalId) localRecord.GlobalID = remoteGlobalId;
            await dbTable.put(localRecord);
          }
        }
      }
    }
  }
}

async function logAppliedResultsForLayer(
  layerId: number,
  tableName: string,
  result: ApplyEditsResponse,
  adds: EsriFeature[],
  updates: EsriFeature[]
): Promise<void> {
  const failedAdds    = (result.addResults    ?? []).filter(r => !r.success);
  const failedUpdates = (result.updateResults ?? []).filter(r => !r.success);

  if (failedAdds.length || failedUpdates.length) {
    console.warn(`[sync] ${tableName} -- ${failedAdds.length} add failure(s), ${failedUpdates.length} update failure(s)`);
    for (const r of [...failedAdds, ...failedUpdates]) {
      console.warn(`  globalId=${r.globalId} error=${r.error?.code} ${r.error?.description}`);
    }

    const errorsToInsert: ISyncError[] = [];
    if (result.addResults) {
      for (let i = 0; i < result.addResults.length; i++) {
        const r = result.addResults[i];
        if (!r.success) {
          const guid = getAttrCaseInsensitive(adds[i]?.attributes, 'guid') as string | undefined;
          errorsToInsert.push({
            table_name: tableName,
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
          const guid = getAttrCaseInsensitive(updates[i]?.attributes, 'guid') as string | undefined;
          errorsToInsert.push({
            table_name: tableName,
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
      console.info(`[sync] ${tableName} -- pushed ${added} add(s), ${updated} update(s)`);
    }
  }
}

export async function unregisterCurrentReplica(token: string): Promise<void> {
  const replicaId = localStorage.getItem('tallypad_replica_id');
  if (!replicaId) return;

  const url = `${SERVICE_URL}/unregisterReplica`;
  const params = {
    replicaID: replicaId,
    f: 'json'
  };

  try {
    const res = await esriPost(url, params, token) as { success?: boolean };
    console.info('[sync] Unregistered replica:', replicaId, res);
  } catch (err) {
    console.warn('[sync] Failed to unregister replica on server:', err);
  } finally {
    localStorage.removeItem('tallypad_replica_id');
    localStorage.removeItem('tallypad_replica_server_gen');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  errors: Record<string, string>;
}

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

  console.log('syncAll');

  const allSteps: SyncStep[] = ['plots', 'gps_points', 'visits', 'trees', 'measurements', 'lookups', 'edits'];
  if (onProgress) {
    for (const step of allSteps) {
      onProgress({ step, status: 'pending' });
    }
  }

  try {
    const replicaId = localStorage.getItem('tallypad_replica_id');
    if (!replicaId) {
      // --------------------------------------------------------
      // Phase 1: Create Replica & Initial Seed
      // --------------------------------------------------------
      console.info('[sync] No active replica found. Registering new replica...');
      
      if (onProgress) {
        onProgress({ step: 'plots', status: 'syncing', message: 'Creating replica...' });
      }

      const layerQueries: Record<number, { where: string; useGeometry: boolean; queryOption: string }> = {};
      for (const id of [LAYER.plot, LAYER.tree, LAYER.visit, LAYER.measurement, LAYER.gps_point, LAYER.lookup, LAYER.edit]) {
        layerQueries[id] = {
          where: '1=1',
          useGeometry: false,
          queryOption: 'useFilter'
        };
      }

      const params: Record<string, string> = {
        replicaName: `Tallypad_Replica_${Date.now()}`,
        layers: JSON.stringify([LAYER.plot, LAYER.tree, LAYER.visit, LAYER.measurement, LAYER.gps_point, LAYER.lookup, LAYER.edit]),
        layerQueries: JSON.stringify(layerQueries),
        syncModel: 'perReplica',
        syncDirection: 'bidirectional',
        dataFormat: 'json',
        async: 'false',
        transportType: 'esriTransportTypeEmbedded',
        returnAttachments: 'false',
        returnAttachmentsDataByUrl: 'false',
      };

      const url = `${SERVICE_URL}/createReplica`;
      const result = await esriPost(url, params, esriToken) as any;

      const newReplicaId = result.replicaID ?? result.replicaId;
      const serverGen = result.replicaServerGen ?? result.serverGen;

      if (!newReplicaId) {
        throw new Error('Server did not return a valid replica ID.');
      }

      // Seed the database
         const responseLayers = [
        ...(result.layers ?? result.layerData ?? []),
        ...(result.tables ?? result.tableData ?? [])
      ] as any[];
      for (const stepName of allSteps) {
        if (onProgress) {
          onProgress({ step: stepName, status: 'syncing', message: 'Applying data...' });
        }
        
        let layerId = -1;
        if (stepName === 'plots') layerId = LAYER.plot;
        else if (stepName === 'gps_points') layerId = LAYER.gps_point;
        else if (stepName === 'visits') layerId = LAYER.visit;
        else if (stepName === 'trees') layerId = LAYER.tree;
        else if (stepName === 'measurements') layerId = LAYER.measurement;
        else if (stepName === 'lookups') layerId = LAYER.lookup;
        else if (stepName === 'edits') layerId = LAYER.edit;

        const layerObj = responseLayers.find(l => (l.id !== undefined ? l.id : l.layerId) === layerId);
        if (layerObj && layerObj.features) {
          await applyRemoteFeatures(layerId, layerObj.features);
        }
        if (onProgress) {
          onProgress({ step: stepName, status: 'completed' });
        }
      }

      localStorage.setItem('tallypad_replica_id', newReplicaId);
      localStorage.setItem('tallypad_replica_server_gen', String(serverGen));
    } else {
      // --------------------------------------------------------
      // Phase 2: Synchronize Replica (Incremental)
      // --------------------------------------------------------
      console.info(`[sync] Found active replica: ${replicaId}. Synchronizing...`);

      const lastSyncTime = Number(localStorage.getItem('tallypad_last_sync_time') || 0);
      const replicaServerGen = localStorage.getItem('tallypad_replica_server_gen') || '0';

      const localEditsMap: Record<number, { adds: EsriFeature[], updates: EsriFeature[] }> = {};
      const editsPayload: any[] = [];

      // Step 2.1: Gather local edits layer-by-layer
      for (const stepName of allSteps) {
        if (onProgress) {
          onProgress({ step: stepName, status: 'syncing', message: 'Preparing edits...' });
        }

        let layerId = -1;
        if (stepName === 'plots') layerId = LAYER.plot;
        else if (stepName === 'gps_points') layerId = LAYER.gps_point;
        else if (stepName === 'visits') layerId = LAYER.visit;
        else if (stepName === 'trees') layerId = LAYER.tree;
        else if (stepName === 'measurements') layerId = LAYER.measurement;
        else if (stepName === 'lookups') layerId = LAYER.lookup;
        else if (stepName === 'edits') layerId = LAYER.edit;

        const { adds, updates, deletes } = await getLocalEditsForLayer(layerId, lastSyncTime);
        localEditsMap[layerId] = { adds, updates };

        if (adds.length > 0 || updates.length > 0 || deletes.length > 0) {
          editsPayload.push({
            id: layerId,
            adds,
            updates,
            deletes
          });
        }
      }

      // Step 2.2: Make the synchronize replica request
      if (onProgress) {
        onProgress({ step: 'plots', status: 'syncing', message: 'Sending synchronization request...' });
      }

      const params: Record<string, string> = {
        replicaID: replicaId,
        replicaServerGen,
        syncDirection: 'bidirectional',
        transportType: 'esriTransportTypeEmbedded',
        f: 'json'
      };

      if (editsPayload.length > 0) {
        params.edits = JSON.stringify(editsPayload);
      }

      const url = `${SERVICE_URL}/synchronizeReplica`;
      let result: any;
      try {
        result = await esriPost(url, params, esriToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Replica not found') || msg.includes('replica not found') || msg.includes('400')) {
          console.warn('[sync] Server replica invalid or expired. Re-creating replica...');
          localStorage.removeItem('tallypad_replica_id');
          localStorage.removeItem('tallypad_replica_server_gen');
          return await syncAll(state, onProgress);
        }
        throw err;
      }

      const newServerGen = result.replicaServerGen ?? result.serverGen;
      if (newServerGen !== undefined) {
        localStorage.setItem('tallypad_replica_server_gen', String(newServerGen));
      }

      // Step 2.3: Apply results and remote edits layer-by-layer
      const editResults = (result.editResults ?? result.submitResults ?? []) as any[];
      const remoteEdits = (
        result.edits ?? 
        (result.layers || result.tables ? [...(result.layers ?? []), ...(result.tables ?? [])] : [])
      ) as any[];

      for (const stepName of allSteps) {
        if (onProgress) {
          onProgress({ step: stepName, status: 'syncing', message: 'Applying updates...' });
        }

        let layerId = -1;
        if (stepName === 'plots') layerId = LAYER.plot;
        else if (stepName === 'gps_points') layerId = LAYER.gps_point;
        else if (stepName === 'visits') layerId = LAYER.visit;
        else if (stepName === 'trees') layerId = LAYER.tree;
        else if (stepName === 'measurements') layerId = LAYER.measurement;
        else if (stepName === 'lookups') layerId = LAYER.lookup;
        else if (stepName === 'edits') layerId = LAYER.edit;

        const dbTable = LAYER_TO_TABLE[layerId];

        // 1. Process upload results
        const er = editResults.find(r => (r.id !== undefined ? r.id : r.layerId) === layerId);
        if (er && dbTable) {
          const localEdits = localEditsMap[layerId];
          const layerResult: ApplyEditsResponse = {
            addResults: er.addResults,
            updateResults: er.updateResults,
            deleteResults: er.deleteResults
          };
          if (localEdits) {
            await logAppliedResultsForLayer(layerId, stepName, layerResult, localEdits.adds, localEdits.updates);
            await updateLocalIds(dbTable, layerResult, localEdits.adds, localEdits.updates);
          }

          // Clear local deletes if they were successful
          if (er.deleteResults && er.deleteResults.length > 0) {
            const successfulDeleteIds = er.deleteResults
              .filter((r: any) => r.success)
              .map((r: any) => r.objectId || r.globalId);

            if (successfulDeleteIds.length > 0) {
              let deleteTableName = '';
              if (dbTable === db.plotVisits) deleteTableName = 'visit';
              else if (dbTable === db.plotTrees) deleteTableName = 'tree';
              else if (dbTable === db.treeMeasurements) deleteTableName = 'measurement';

              if (deleteTableName) {
                const deletedRecords = await db.deletedRecords
                  .where('table_name')
                  .equals(deleteTableName)
                  .toArray();
                const toRemove = deletedRecords
                  .filter(d => (d.objectid && successfulDeleteIds.includes(d.objectid)) || (d.globalid && successfulDeleteIds.includes(d.globalid)))
                  .map(d => d.guid);
                if (toRemove.length > 0) {
                  await db.deletedRecords.bulkDelete(toRemove);
                }
              }
            }
          }
        }

        // 2. Process remote download edits
        const re = remoteEdits.find(e => (e.id !== undefined ? e.id : e.layerId) === layerId);
        if (re && re.features) {
          const features = re.features;
          if (features.adds && features.adds.length > 0) {
            await applyRemoteFeatures(layerId, features.adds);
          }
          if (features.updates && features.updates.length > 0) {
            await applyRemoteFeatures(layerId, features.updates);
          }
          const deletes = features.deletes ?? features.deleteIds ?? [];
          if (deletes.length > 0) {
            await applyRemoteDeletes(layerId, deletes);
       }
        }

        if (onProgress) {
          onProgress({ step: stepName, status: 'completed' });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync] Sync failed:', message);
    errors['sync'] = message;

    await db.syncErrors.add({
      table_name: 'sync',
      record_guid: 'ALL',
      error_message: message,
      timestamp: Date.now()
    });

    if (onProgress) {
      for (const step of allSteps) {
        onProgress({ step, status: 'failed', message });
      }
    }
  }

  await state.checkSyncErrors();
  return { success: Object.keys(errors).length === 0, errors };
}

// /**
//  * Sync a single named layer / table.
//  * Since synchronization under the replica model is atomic, this syncs all tables.
//  */
// export async function syncTable(
//   table: keyof typeof LAYER,
//   state: ReturnType<typeof useAppStore>,
// ): Promise<void> {
//   const res = await syncAll(state);
//   if (!res.success) {
//     const msg = res.errors ? Object.values(res.errors).join(', ') : 'Unknown error';
//     throw new Error(`Sync table failed: ${msg}`);
//   }
// }