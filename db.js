const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'fyp_ga_2025',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log("Connected to MySQL fyp_ga_2025 u fucking black ass moneky nigger");
        conn.release();
    } catch (err) {
        console.error("MySQL connection failed:", err);
    }
}

testConnection();

module.exports = pool;