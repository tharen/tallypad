import Dexie, { Table } from 'dexie';

const objectidFieldName = 'OBJECTID';
const globalidFieldName = 'GlobalID';
const localGuidFieldName = 'guid';

// --- Editor Tracking Interface ---
export interface EsriTableBase {
  // Fields managed by AGOL/Portal
  OBJECTID?: number;
  GlobalID?: string;
  created_user?: string;
  created_date?: number;
  last_edited_user?: string;
  last_edited_date?: number;
}

// NOTE: Using local GUIDs because geoprocessing and bulk edits will often overwrite the ESRI GlobalID
// --- Plots Interface ---
export interface IPlot extends EsriTableBase {
  Shape: any; // GeoJSON
  guid: string;  // Local GUID
  plotid: string;
  established?: number;       // Timestamp
  planned_latitude?: number;
  planned_longitude?: number;
  remarks?: string;
}

// --- Collected Plot GPS Points ---
export interface IGpsPoint extends EsriTableBase {
  guid: string; // Local GUID
  plot_guid: string;   // Foreign Key -> IPlots.plot_guid
  latitude: number;
  longitude: number;
  time: number;
  model: string;
  fix: number;
  sat: number;
  hdop: number;
  vdop: number;
  pdop: number;
  ageofdgpsd: number;
  remarks: string;
}

// --- Plot Visits Interface ---
export interface IPlotVisit extends EsriTableBase {
  guid: string;     // Local GUID
  plot_guid: string;     // Foreign Key -> Plots.globalid
  measurement_date: number;  // Timestamp
  visit_number: number;
  status?: string;
  crew?: string;
  remarks?: string;
}

// --- Trees Interface ---
export interface ITree extends EsriTableBase {
  guid: string;      // Local GUID
  plot_guid: string;     // Foreign Key -> Plots.globalid
  tree_num: number;
  sp: string;
  az?: number;
  hd?: number;
  ref?: string;
  sd?: number;
  remarks?: string;
}

// --- Tree Measurements Interface ---
export interface ITreeMeasurement extends EsriTableBase {
  guid: string; // Local GUID
  tree_guid: string;     // Foreign Key -> Trees.globalid
  visit_guid: string;    // Foreign Key -> Plot_Visits.globalid
  gp: string;
  gt: number;
  dbh: number;
  s: string;
  fc?: number;
  ht?: number;
  age?: number;
  cr?: number;
  cc?: number;
  d1?: number;
  s1?: number;
  d2?: number;
  s2?: number;
  d3?: number;
  s3?: number;
  def1?: number;
  def2?: number;
  def3?: number;
  c?: number;
  bt?: number;
  upstht?: number;
  upstd?: number;
  fiveyr?: number;
  tenyr?: number;
  remarks?: string;
}

// --- Edits Tracking ---
export interface IEdit extends EsriTableBase {
  guid: string; // Local GUID
  table_name: string;
  record_guid: string; // Typically the tree.guid
  field_name: string;
  old_value: string;
  new_value: string;
  reason: string;
  edit_date: number;
}

// --- Lookup Values ---
export interface ILookups extends EsriTableBase {
  guid: string;
  feature: string;
  code: string;
  value: string;
  description: string;
}

export class TallypadDB extends Dexie {
  // Define Table types using the interfaces
  plots!: Table<IPlot, string>; // string denotes the type of the Primary Key (globalid)
  plotVisits!: Table<IPlotVisit, string>;
  plotGpsPoints!: Table<IGpsPoint, string>;
  plotTrees!: Table<ITree, string>;
  treeMeasurements!: Table<ITreeMeasurement, string>;
  lookups!: Table<ILookups, string>;
  edits!: Table<IEdit, string>;

  constructor() {
    super('tallypad');

    // Define tables and indexes
    // Syntax: 'primaryKey, index1, index2, ...'
    this.version(1).stores({
      plots: `${localGuidFieldName}, plotid`,
      plotVisits: `${localGuidFieldName}, plot_guid, measurement_date`,
      plotGpsPoints: `${localGuidFieldName}, plot_guid, time`,
      plotTrees: `${localGuidFieldName}, plot_guid, tree_num`,
      treeMeasurements: `${localGuidFieldName}, tree_guid, visit_guid`,
      lookups: `${localGuidFieldName}, feature, code`,
      edits: `${localGuidFieldName}, record_guid, edit_date`
    });
  }
}

// Export a single instance to use across your application
export const db = new TallypadDB();

export const renewDatabase = () => {
  db.delete({ disableAutoOpen: false });
  window.location.reload();
};

/**
 * Exports all tables in the database to a JSON file and triggers a browser download.
 */
export const exportDatabase = async () => {
  try {
    const exportData: Record<string, any[]> = {};
    for (const table of db.tables) {
      exportData[table.name] = await table.toArray();
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tallypad_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed:', error);
    alert('An error occurred during database export.');
  }
};

/**
 * Prompts the user to select a JSON file and imports its contents into the database.
 * Replaces existing data in matching tables.
 */
export const importDatabase = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        await db.transaction('rw', db.tables, async () => {
          for (const tableName in json) {
            const table = db.table(tableName);
            if (table) {
              await table.clear();
              await table.bulkAdd(json[tableName]);
            }
          }
        });
        alert('Import successful.');
        window.location.reload();
      } catch (error) {
        console.error('Import failed:', error);
        alert('Failed to import JSON file. Please ensure it is a valid export.');
      }
    };
    reader.readAsText(file);
  };
  input.click();

};