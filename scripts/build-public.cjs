const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '../nyhlen-allum');
const destination = path.join(app, 'public');
const files = ['index.html','familiekalender-hub.html','family-access.js','family-access.css','manifest.json','sw.js','icon-180.png','icon-512.png','icon.png'];
fs.mkdirSync(destination, {recursive:true});
for(const file of files) {
  const source=path.join(app,file);
  if(!fs.existsSync(source)) throw new Error('Missing web asset: '+file);
  fs.copyFileSync(source,path.join(destination,file));
}
for (const file of fs.readdirSync(destination)) {
  if (!files.includes(file)) throw new Error('Unexpected public asset: '+file);
}
console.log('Public bundle: '+files.length+' explicit web assets. Server sources excluded.');
