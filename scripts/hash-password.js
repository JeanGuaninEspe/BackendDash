const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.js "tu_clave"');
  process.exit(1);
}

bcrypt
  .hash(password, 10)
  .then(hash => {
    console.log(hash);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
