const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',          // <-- CHANGE if your MySQL username is different
    password: 'Republic_C207',          // <-- CHANGE if your MySQL has a password
    database: 'fyp_ga_2025',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log("Connected to MySQL fyp_ga_2025 #limboontiatzane");
        conn.release();
    } catch (err) {
        console.error("MySQL connection failed:", err);
    }
}

testConnection();

module.exports = pool;