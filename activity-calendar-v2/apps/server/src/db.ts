import postgres from "postgres";

const sql = postgres({
	host: process.env.DB_HOST || "localhost",
	port: Number(process.env.DB_PORT) || 5432,
	database: process.env.DB_NAME || "postgres",
	username: process.env.DB_USER || "postgres",
	password: process.env.DB_PASSWORD || "",
	max: 10,
	idle_timeout: 20,
});

export const SCHEMA = process.env.DB_SCHEMA || "public";

export default sql;
