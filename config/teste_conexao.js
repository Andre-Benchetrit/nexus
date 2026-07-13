const pool = require('../../config/db');

async function main() {
  try {
    const result = await pool.query('SELECT NOW() AS agora');
    console.log('Conexão OK:', result.rows[0]);
  } catch (error) {
    console.error('Erro na conexão:', error.message);
  } finally {
    await pool.end();
  }
}

main();