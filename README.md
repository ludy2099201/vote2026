# vote2026

## Candidate data

`data/candidates-2026.json` is the source of truth for the initial candidate
dataset, county order, official bulletin URLs, and six policy dimensions.
The page keeps its existing reviewed corrections and post-processing separately.

After `npm ci`, edit JSON, run `npm run build:data`, then run
`npm run validate:data -- --check-inline` and `npm run test:data`.
Commit both the JSON and generated `index.html` block. Do not edit the generated
block directly. The embedded data works over HTTP and `file://` without fetching
JSON.

`data/candidates-2026.schema.json` defines the strict draft 2020-12 schema.
The validator also checks city/URL consistency, identifiers, ballot numbers,
and policy-axis order. Optional `npm run validate:data -- --online` checks the
bulletin URLs with HEAD requests; it is not part of CI.

The durable equivalence test compares the initial data and untouched HTML against
Git commit `777a00f`; a full Git checkout is needed to run it.