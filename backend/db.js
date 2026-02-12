import mysql from "mysql2";
import dotenv from "dotenv";

// load environment variables
dotenv.config({ path: "./.env" });

console.log("✅ Checking .env:", {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  pass: process.env.DB_PASS,
  db: process.env.DB_NAME
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL connection error:", err);
  } else {
    console.log("✅ Connected to MySQL!");
  }
});

export default db;