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
  latitude?: number;
  longitude?: number;
  loc_src?: string;
  remarks?: string;
}

// --- Collected Plot GPS Locations ---
export interface ILocation extends EsriTableBase {
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
  tenyr?: string;
  remarks?: string;
}

// --- Edits Tracking ---
export interface IEdit extends EsriTableBase {
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
  attribute: string;
  code: string;
  value: string;
  description: string;
}

export class TallypadDB extends Dexie {
  // Define Table types using the interfaces
  plots!: Table<IPlot, string>; // string denotes the type of the Primary Key (globalid)
  plotVisits!: Table<IPlotVisit, string>;
  plotLocations!: Table<ILocation, string>;
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
      plotLocations: `${localGuidFieldName}, plot_guid, time`,
      plotTrees: `${localGuidFieldName}, plot_guid, tree_num`,
      treeMeasurements: `${localGuidFieldName}, tree_guid, visit_guid`,
      lookups: `${localGuidFieldName}, attribute, code`,
      edits: `${localGuidFieldName}, record_guid, edit_date`
    });
  }
}

// Export a single instance to use across your application
export const db = new TallypadDB();

export const renewDatabase = () => {
  db.delete({ disableAutoOpen: false });
};