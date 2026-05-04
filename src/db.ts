import Dexie, { Table } from 'dexie';

export interface Unit {
  globalid: string;
  projectName: string;
  unitName: string;
  area: number;
}

export interface Plot {
  globalid: string;
  unitName: string;
  plotNumber: string;
}

export interface Tree {
  globalid: string;
  plotGlobalid: string;
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
  totalHeight: string;
}

export class TallypadDB extends Dexie {
  units!: Table<Unit>;
  plots!: Table<Plot>;
  trees!: Table<Tree>;

  constructor() {
    super('tallypad');
    this.version(3).stores({
      units: '&globalid, &projectName, unitName',
      unitPlots: '&globalid, unitName, plotNumber',
      treeRecords: '&globalid, plotGlobalid, &[plotGlobalid+treeNumber]'
    });

    this.version(4)
      .stores({
        units: '&globalid, &projectName, unitName',
        unitPlots: '&globalid, unitName, plotNumber',
        treeRecords: '&globalid, plotGlobalid, &[plotGlobalid+treeNumber]'
      });

    this.version(5)
      .stores({
        units: '&globalid, &projectName, unitName',
        plots: '&globalid, unitName, plotNumber',
        trees: '&globalid, plotGlobalid, &[plotGlobalid+treeNumber]',
        unitPlots: null, // Remove unitPlots table
        treeRecords: null // Remove treeRecords table
      })
      .upgrade(tx => {
        // Transfer unitPlots to plots and treeRecords to trees
        return Promise.all([
          tx.unitPlots.toArray().then(unitPlots => {
            const plots = unitPlots.map(up => ({
              globalid: up.globalid,
              unitName: up.unitName,
              plotNumber: up.plotNumber
            }));
            return tx.plots.bulkPut(plots);
          }),
          tx.treeRecords.toArray().then(treeRecords => {
            const trees = treeRecords.map(tr => ({
              globalid: tr.globalid,
              plotGlobalid: tr.plotGlobalid,
              treeNumber: tr.treeNumber,
              plotFactor: tr.plotFactor,
              species: tr.species,
              status: tr.status,
              tally: tr.tally,
              diameter: tr.diameter,
              formPoint: tr.formPoint,
              formFactor: tr.formFactor,
              topDiameter: tr.topDiameter,
              boleHeight: tr.boleHeight,
              totalHeight: tr.totalHeight
            }));
            return tx.trees.bulkPut(trees);
          }),
          tx.unitPlots.clear(),
          tx.treeRecords.clear()
        ]);
    });

    this.version(6)
      .stores({
        units: '&globalid, &projectName, unitName',
        plots: '&globalid, unitName, plotNumber',
        trees: '&globalid, plotGlobalid, &[plotGlobalid+treeNumber]',
        unitPlots: null, // Remove unitPlots table
        treeRecords: null // Remove treeRecords table
      })
  };
}

export const db = new TallypadDB();
