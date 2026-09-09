import { numeric, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").defaultRandom().primaryKey();
export const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).$type<string>();
export const quantity = (name: string) => numeric(name, { precision: 18, scale: 3 }).$type<string>();
