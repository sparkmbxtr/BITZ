// Supplemental monitor access uses the existing private ContextLog object.
// Immutable enrollment never replaces the original secret or session key.
export class MonitorPasswordStorage {
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS nucleosome_extra_access (enrollment TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  }
  read(enrollment) {
    return this.sql.exec("SELECT payload FROM nucleosome_extra_access WHERE enrollment = ?", enrollment).toArray()[0]?.payload ?? null;
  }
  put(enrollment, payload) {
    const prior = this.read(enrollment);
    if (prior !== null && prior !== payload) return false;
    this.sql.exec("INSERT OR IGNORE INTO nucleosome_extra_access (enrollment, payload) VALUES (?, ?)", enrollment, payload);
    return this.read(enrollment) === payload;
  }
}
