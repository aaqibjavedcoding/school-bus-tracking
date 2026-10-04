const fs=require('fs'), path=require('path');
const src=path.join(__dirname,'src/../..','web/public/map-styles/kidbus-day.json');
// build output is consumed by web's public directory; keep a canonical generated copy.
fs.mkdirSync(path.join(__dirname,'../../web/public/map-styles'),{recursive:true});
fs.copyFileSync(src,path.join(__dirname,'../../web/public/map-styles/kidbus-day.json'));
