// Run before committing a release. Hash all runtime files, including templates.
const fs = require('node:fs');
const crypto = require('node:crypto');
const files = ['style.css', ...fs.readdirSync('js').filter(f => f.endsWith('.js') && !f.endsWith('.spec.js')).map(f => 'js/' + f), ...fs.readdirSync('view').filter(f => f.endsWith('.html')).map(f => 'view/' + f)].sort();
if (fs.existsSync('models/planner.json')) files.push('models/planner.json');
const digest = crypto.createHash('sha256');
for (const file of files) { digest.update(file); digest.update(fs.readFileSync(file)); }
// Include the document itself, neutralizing only generated release tokens.
const sourceIndex = fs.readFileSync('index.html', 'utf8');
digest.update(sourceIndex.replace(/(<meta name="quran-release" content=")[^"]+/, '$1BUILD')
    .replace(/((?:src|href)="(?:js\/[^"?]+\.js|style\.css))(?:\?v=[^"]*)?"/g, '$1?v=BUILD"'));
const build = digest.digest('hex').slice(0, 12);
const index = fs.readFileSync('index.html', 'utf8')
    .replace(/(<meta name="quran-release" content=")[^"]+/, '$1' + build)
    .replace(/((?:src|href)="(?:js\/[^"?]+\.js|style\.css))(?:\?v=[^"]*)?"/g, '$1?v=' + build + '"');
if (process.argv.includes('--check')) {
    if (JSON.parse(fs.readFileSync('version.json')).build !== build || fs.readFileSync('index.html', 'utf8') !== index) {
        throw new Error('Release assets changed. Run npm run release before committing.');
    }
} else {
    fs.writeFileSync('index.html', index);
    fs.writeFileSync('version.json', JSON.stringify({build}) + '\n');
}
console.log('Release ' + build);
