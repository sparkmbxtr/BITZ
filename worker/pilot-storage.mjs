// Immutable historical display bytes in the existing ContextLog namespace.
// These tables are separate from progress, sessions and all scientific state.
export class PilotStorage {
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS pilot_manifests (revision TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS pilot_chunks (revision TEXT NOT NULL, asset TEXT NOT NULL, part INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (revision, asset, part))");
  }
  manifest(revision) {
    return this.sql.exec("SELECT payload FROM pilot_manifests WHERE revision = ?", revision).toArray()[0]?.payload ?? null;
  }
  putManifest(revision, payload) {
    const prior = this.manifest(revision);
    if (prior !== null && prior !== payload) throw new Error("Immutable pilot manifest conflict");
    this.sql.exec("INSERT OR IGNORE INTO pilot_manifests (revision, payload) VALUES (?, ?)", revision, payload);
    return this.manifest(revision) === payload;
  }
  chunk(revision, asset, part) {
    return this.sql.exec("SELECT payload FROM pilot_chunks WHERE revision = ? AND asset = ? AND part = ?", revision, asset, part).toArray()[0]?.payload ?? null;
  }
  putChunk(revision, asset, part, payload) {
    const prior = this.chunk(revision, asset, part);
    if (prior !== null) {
      const a = new Uint8Array(prior), b = new Uint8Array(payload);
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error("Immutable pilot chunk conflict");
      return true;
    }
    this.sql.exec("INSERT INTO pilot_chunks (revision, asset, part, payload) VALUES (?, ?, ?, ?)", revision, asset, part, payload);
    return this.chunk(revision, asset, part) !== null;
  }
  status(revision, asset) {
    return this.sql.exec("SELECT COUNT(*) AS parts, COALESCE(SUM(length(payload)), 0) AS bytes FROM pilot_chunks WHERE revision = ? AND asset = ?", revision, asset).toArray()[0];
  }
}
