import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const secureSettings = sqliteTable("secure_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
