// db.js
const mysql = require('mysql2/promise');

// Create a MySQL connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',     
    password: 'Republic_C207',    
    database: 'fyp_ga_2025',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Simple test to verify connection on startup
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log("✅ Connected to MySQL (fyp_ga_2025)!");
        conn.release();
    } catch (err) {
        console.error("❌ MySQL connection failed:", err);
    }
}

testConnection();

module.exports = pool;
