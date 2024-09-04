import {
    Report
} from "c8";

let opts = {
    all: true,
    return: true,
    reporter: ['html'],
    deleteCoverage: false,
    tempDirectory: "./node_coverage",
    reportsDirectory: "./coverage_report",
    excludeNodeModules: true
};
let myrep = Report(opts);
await myrep.run();