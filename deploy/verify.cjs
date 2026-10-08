const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {transformSync}=require('esbuild');
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','.migration','.superpowers','__pycache__'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else files.push(p);}}
walk('.');let parsed=0;const failures=[];
for(const file of files){
 const text=fs.readFileSync(file,'utf8');
 if(/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(text))failures.push(file+': credential material');
 if(/\.(ts|js|cjs)$/.test(file)){
  if(/process\.env\.[A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|PASS|SECRET)[A-Z0-9_]*\s*\|\|\s*(['"])[^'"]+\1/.test(text))failures.push(file+': literal credential fallback');
  try{transformSync(text,{loader:file.endsWith('.ts')?'ts':'js',target:'es2022',logLevel:'silent'});parsed++;}catch(error){failures.push(file+': '+error.errors.map(x=>x.text).join('; '));}
 }
}
// Resolve the actual entry-point dependency closure. Never import it or execute live workers in CI.
const checked=new Set(),pending=['webhook-listener.js','src/hydra-sync/agent_dispatcher_cli.ts','src/hydra-sync/mcp_server.ts','src/hydra-sync/deep-crawler.ts','src/hydra-sync/hourly_finance_worker.ts'];
while(pending.length){const file=pending.pop();if(checked.has(file))continue;checked.add(file);const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/(?:from\s+|require\(|import\()(['"])(\.[^'"]+)\1/g)){
 const p=path.normalize(path.join(path.dirname(file),m[2]));const options=[p,p.replace(/\.js$/,'.ts'),p+'.ts',p+'.js',path.join(p,'index.ts')];const found=options.find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());if(!found)failures.push(file+': missing local module '+m[2]);else pending.push(found);
}}
const py=cp.spawnSync('python3',['-c',"import ast,pathlib; [ast.parse(p.read_text(),filename=str(p)) for p in pathlib.Path('deploy').rglob('*.py')]"],{encoding:'utf8'});
if(py.status!==0)failures.push('Deploy Python syntax: '+py.stderr);
if(!failures.length){const probe=cp.spawnSync('python3',['deploy/sync.py','--probe-functional'],{encoding:'utf8',timeout:30000});if(probe.status!==0)failures.push('Controlled functional probe: '+(probe.stderr||probe.error?.message||'failed'));}
if(failures.length){for(const failure of failures)console.error(failure);process.exit(1);}
console.log(`Verified ${parsed} JS/TS files and ${checked.size} runtime modules; no live integrations executed.`);
