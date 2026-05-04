import Dexie from 'dexie';

export interface Unit {
  globalid: string;
  project_name: string;
  name: string;
  area: string;
  status: string;
}

export interface Plot {
  globalid: string;
  unit_globalid: string;
  plot_number: string;
  cruiser: string;
  status: string;
  slope: string;
  aspect: string;
  elevation: string;
  planned_latitude: string;
  planned_longitude: string;
  gps_latitude: string;
  gps_longitude: string;
  gps_error: string;
  gps_time: string;
}

export interface Tree {
  globalid: string;
  plot_globalid: string;
  tree_number: string;
  plot_factor: string;
  species: string;
  status: string;
  tally: string;
  diameter: string;
  form_point: string;
  form_factor: string;
  top_diameter: string;
  bole_height: string;
  top_height: string;
  plot_number: string;
  unit_name: string;
}

export const createGlobalId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

export class TallyPadDB extends Dexie {
  units!: Dexie.Table<Unit, string>;
  plots!: Dexie.Table<Plot, string>;
  trees!: Dexie.Table<Tree, string>;

  constructor() {
    super('tallypad');

    this.version(1).stores({
      units: 'globalid,project_name,name,area,status',
      plots: 'globalid,unit_globalid,plot_number,cruiser,status,slope,aspect,elevation,planned_latitude,planned_longitude,gps_latitude,gps_longitude,gps_error,gps_time',
      trees: 'globalid,plot_globalid,tree_number,plot_factor,species,status,tally,diameter,form_point,form_factor,top_diameter,bole_height,top_height,plot_number,unit_name',
    });
  }
}

export const db = new TallyPadDB();

export async function addUnit(partial: Partial<Unit> = {}): Promise<Unit> {
  const unit: Unit = {
    globalid: createGlobalId(),
    project_name: partial.project_name ?? 'New Project',
    name: partial.name ?? 'New Unit',
    area: partial.area ?? '',
    status: partial.status ?? 'active',
  };
  await db.units.add(unit);
  return unit;
}

export async function addPlot(partial: Partial<Plot>): Promise<Plot> {
  if (!partial.unit_globalid) {
    throw new Error('Plot must reference a unit_globalid');
  }
  const unitExists = await db.units.get(partial.unit_globalid);
  if (!unitExists) {
    throw new Error('Referenced unit does not exist');
  }
  const plot: Plot = {
    globalid: createGlobalId(),
    unit_globalid: partial.unit_globalid,
    plot_number: partial.plot_number ?? '',
    cruiser: partial.cruiser ?? '',
    status: partial.status ?? 'active',
    slope: partial.slope ?? '',
    aspect: partial.aspect ?? '',
    elevation: partial.elevation ?? '',
    planned_latitude: partial.planned_latitude ?? '',
    planned_longitude: partial.planned_longitude ?? '',
    gps_latitude: partial.gps_latitude ?? '',
    gps_longitude: partial.gps_longitude ?? '',
    gps_error: partial.gps_error ?? '',
    gps_time: partial.gps_time ?? '',
  };
  await db.plots.add(plot);
  return plot;
}

export async function addTree(partial: Partial<Tree>): Promise<Tree> {
  if (!partial.plot_globalid) {
    throw new Error('Tree must reference a plot_globalid');
  }
  const plot = await db.plots.get(partial.plot_globalid);
  if (!plot) {
    throw new Error('Referenced plot does not exist');
  }
  const tree: Tree = {
    globalid: createGlobalId(),
    plot_globalid: partial.plot_globalid,
    tree_number: partial.tree_number ?? '',
    plot_factor: partial.plot_factor ?? '1',
    species: partial.species ?? '',
    status: partial.status ?? 'L',
    tally: partial.tally ?? '1',
    diameter: partial.diameter ?? '',
    form_point: partial.form_point ?? '',
    form_factor: partial.form_factor ?? '',
    top_diameter: partial.top_diameter ?? '',
    bole_height: partial.bole_height ?? '',
    top_height: partial.top_height ?? '',
    plot_number: plot.plot_number,
    unit_name: '',
  };
  const unit = await db.units.get(plot.unit_globalid);
  tree.unit_name = unit?.name ?? '';
  await db.trees.add(tree);
  return tree;
}

export async function deletePlotAndChildren(plotGlobalId: string): Promise<void> {
  await db.transaction('rw', db.plots, db.trees, async () => {
    await db.trees.where('plot_globalid').equals(plotGlobalId).delete();
    await db.plots.delete(plotGlobalId);
  });
}

export async function deleteUnitAndChildren(unitGlobalId: string): Promise<void> {
  await db.transaction('rw', db.units, db.plots, db.trees, async () => {
    const plots = await db.plots.where('unit_globalid').equals(unitGlobalId).toArray();
    const plotIds = plots.map((plot) => plot.globalid);
    if (plotIds.length > 0) {
      await db.trees.where('plot_globalid').anyOf(plotIds).delete();
    }
    await db.plots.where('unit_globalid').equals(unitGlobalId).delete();
    await db.units.delete(unitGlobalId);
  });
}
