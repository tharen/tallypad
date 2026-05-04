import Dexie, { Table } from 'dexie';

export interface UnitPlot {
  id?: number;
  unitName: string;
  plotNumber: string;
}

export interface TreeRecord {
  id?: number;
  treeNumber: string;
  plotFactor: string;
  species: string;
  status: string;
  tally: string;
  diameter: string;
  formPoint: string;
  formFactor: string;
  topDiameter: string;
  boleHeight: string;
  topHeight: string;
  plotNumber: string;
  unitName: string;
}

export class TallypadDB extends Dexie {
  unitPlots!: Table<UnitPlot>;
  treeRecords!: Table<TreeRecord>;

  constructor() {
    super('tallypad');
    this.version(1).stores({
      unitPlots: '++id, unitName, plotNumber',
      treeRecords: '++id, [unitName+plotNumber], [unitName+plotNumber+treeNumber]'
    });
  }
}

export const db = new TallypadDB();
