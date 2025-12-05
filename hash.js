const bcrypt = require('bcrypt');

(async () => {
  const password = 'MatchMove@123'; 
  const hash = await bcrypt.hash(password, 10);
  console.log('Hash:', hash);
})();
