import Dexie, { Table } from 'dexie';

// --- Editor Tracking Interface ---
export interface EsriEditorTracking {
  created_user?: string;
  created_date?: number; // Stored as Unix epoch timestamp for easy sorting/syncing
  last_edited_user?: string;
  last_edited_date?: number;
}

// --- 1. Plots Interface ---
export interface IPlot extends EsriEditorTracking {
  objectid?: number;         // Optional because Dexie can auto-increment this on add
  globalid: string;          // Primary Key (UUID string)
  plotid: string;
  established?: number;       // Timestamp
  latitude?: number;
  longitude?: number;
  loc_src?: string;
  remarks?: string;
}

// --- 2. Plot Visits Interface ---
export interface IPlotVisit extends EsriEditorTracking {
  objectid?: number;
  globalid: string;          // Primary Key
  plot_globalid: string;     // Foreign Key -> Plots.globalid
  measurement_date: number;  // Timestamp
  visit_number: number;
  crew?: string;
  visit_remarks?: string;
}

// --- 3. Trees Interface ---
export interface ITree extends EsriEditorTracking {
  objectid?: number;
  globalid: string;          // Primary Key
  plot_globalid: string;     // Foreign Key -> Plots.globalid
  tree_num: number;
  species: string;
  az: number;
  hd: number;
  ref?: string;
  sd?: number;
}

// --- 4. Tree Measurements Interface ---
export interface ITreeMeasurement extends EsriEditorTracking {
  objectid?: number;
  globalid: string;          // Primary Key
  tree_globalid: string;     // Foreign Key -> Trees.globalid
  visit_globalid: string;    // Foreign Key -> Plot_Visits.globalid
  plot_code: string;
  condition: string;
  diameter: number;
  sample_type: string;
  height: number;
  form_point?: number;
  form_dob?: number;
  crown_base?: number;
  remarks?: string;
}

// --- 5. Edits Tracking ---
export interface IEdit extends EsriEditorTracking {
  globalid: string;
  table_name: string;
  record_globalid: string; // Typically the tree_globalid
  field_name: string;
  old_value: string;
  new_value: string;
  reason: string;
  edit_date: number;
}

export class TallypadDB extends Dexie {
  // Define Table types using the interfaces
  plots!: Table<IPlot, string>; // string denotes the type of the Primary Key (globalid)
  plotVisits!: Table<IPlotVisit, string>;
  trees!: Table<ITree, string>;
  treeMeasurements!: Table<ITreeMeasurement, string>;
  edits!: Table<IEdit, string>;

  constructor() {
    super('tallypad');

    // Define tables and indexes
    // Syntax: 'primaryKey, index1, index2, ...'
    // ++objectid can be used if you want Dexie to auto-increment, 
    // but since Esri relies on globalid, we use globalid as the primary key.
    this.version(2).stores({
      plots: 'globalid, plotid',
      plotVisits: 'globalid, plot_globalid, measurement_date',
      trees: 'globalid, plot_globalid, tree_num',
      treeMeasurements: 'globalid, tree_globalid, visit_globalid',
      edits: 'globalid, record_globalid'
    });

    this.version(3).stores({
      edits: 'globalid, created_user, created_date, last_edited_user, last_edited_date',
    });
  }
}

// Export a single instance to use across your application
export const db = new TallypadDB();