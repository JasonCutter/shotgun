import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourcePath = path.join(
  repoRoot,
  'docs/architecture/knowledge-flow/knowledge-flow-baseline-v1.0.json',
);
const outputPath = path.join(repoRoot, 'docs/SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const checkOnly = process.argv.includes('--check');

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const serialized = JSON.stringify(source).replaceAll('<', '\\u003c');
const phaseButtons = source.phases
  .map(
    (phase) =>
      `<button class="phase" type="button" data-phase="${phase.id}" aria-pressed="false"><span>Phase ${phase.id}</span><strong>${escapeHtml(phase.name)}</strong></button>`,
  )
  .join('');

const safeguardCards = source.sharedSafeguards
  .map(
    (item) =>
      `<article><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.description)}</p></article>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="scripts/render-knowledge-flow-baseline.mjs">
<meta name="canonical-source" content="docs/architecture/knowledge-flow/knowledge-flow-baseline-v1.0.json">
<title>${escapeHtml(source.title)}</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.55;background:#f5f5f4;color:#1c1917}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 20px 64px}header{border-bottom:1px solid #d6d3d1;padding-bottom:22px;margin-bottom:24px}h1{font-size:clamp(1.8rem,4vw,3rem);margin:.2rem 0}h2{margin-top:34px}.meta,.principles,.loops{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1px solid #a8a29e;border-radius:999px;padding:4px 10px;background:#fff}.phases{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.phase{min-height:82px;text-align:left;border:1px solid #a8a29e;border-radius:12px;background:#fff;padding:12px;cursor:pointer}.phase span{display:block;color:#78716c;font-size:.8rem}.phase[aria-pressed="true"]{background:#1c1917;color:#fff}.phase[aria-pressed="true"] span{color:#d6d3d1}.focus{margin-top:16px;border:1px solid #d6d3d1;border-radius:16px;background:#fff;padding:20px}.route{color:#57534e}.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:14px}.step{border:1px solid #d6d3d1;border-radius:12px;background:#fafaf9;padding:14px;text-align:left;cursor:pointer}.step[aria-pressed="true"]{outline:3px solid #78716c}.step .top{display:flex;justify-content:space-between;gap:8px}.step .num{font-weight:700}.tag{font-size:.75rem;border:1px solid #a8a29e;border-radius:999px;padding:2px 7px}.detail{margin-top:14px;border-left:4px solid #44403c;padding:8px 14px}.detail h3{margin:0}.shared{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.shared article{border:1px solid #d6d3d1;border-radius:12px;background:#fff;padding:14px}.shared p{margin:.4rem 0 0;color:#57534e}.notice{margin-top:32px;color:#57534e;font-size:.85rem}@media(max-width:850px){.phases{grid-template-columns:repeat(3,1fr)}}@media(max-width:520px){main{padding:20px 14px 48px}.phases{grid-template-columns:1fr}.phase{min-height:62px}}@media(prefers-color-scheme:dark){:root{background:#0c0a09;color:#fafaf9}.pill,.phase,.focus,.shared article{background:#1c1917;border-color:#57534e}.phase[aria-pressed="true"]{background:#fafaf9;color:#1c1917}.step{background:#292524;border-color:#57534e}.route,.shared p,.notice{color:#d6d3d1}}
</style>
</head>
<body>
<main>
<header>
<div class="meta"><span class="pill">전략회의용 기준본 · v${escapeHtml(source.version)}</span><span class="pill">구조화 원본에서 생성됨</span></div>
<h1>${escapeHtml(source.title)}</h1>
<div class="principles">${source.principles.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}</div>
</header>
<nav class="phases" aria-label="Shotgun 6개 처리 단계">${phaseButtons}</nav>
<section class="focus" aria-live="polite">
<h2 id="phase-title"></h2><p id="phase-summary"></p><p id="phase-route" class="route"></p>
<div id="steps" class="steps"></div>
<div class="detail"><h3 id="detail-title"></h3><p id="detail-description"></p><p id="detail-owner" class="route"></p></div>
</section>
<h2>순환 경로</h2><div class="loops">${source.loops.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}</div>
<h2>전체 단계 공통 안전장치</h2><div class="shared">${safeguardCards}</div>
<p class="notice">Canonical structured source: <code>docs/architecture/knowledge-flow/knowledge-flow-baseline-v1.0.json</code><br>Generator: <code>scripts/render-knowledge-flow-baseline.mjs</code></p>
</main>
<script id="knowledge-flow-data" type="application/json">${serialized}</script>
<script>
const data=JSON.parse(document.getElementById('knowledge-flow-data').textContent);const phaseTitle=document.getElementById('phase-title');const phaseSummary=document.getElementById('phase-summary');const phaseRoute=document.getElementById('phase-route');const steps=document.getElementById('steps');const detailTitle=document.getElementById('detail-title');const detailDescription=document.getElementById('detail-description');const detailOwner=document.getElementById('detail-owner');
function showStep(step){document.querySelectorAll('.step').forEach((node)=>node.setAttribute('aria-pressed',String(Number(node.dataset.step)===step.number)));detailTitle.textContent=step.number+'. '+step.title;detailDescription.textContent=step.description;detailOwner.textContent='담당: '+step.owner;}
function showPhase(id){const phase=data.phases.find((item)=>item.id===id);document.querySelectorAll('.phase').forEach((node)=>node.setAttribute('aria-pressed',String(Number(node.dataset.phase)===id)));phaseTitle.textContent='Phase '+phase.id+'. '+phase.name;phaseSummary.textContent=phase.summary;phaseRoute.textContent=phase.route||'';steps.replaceChildren();phase.steps.forEach((step)=>{const button=document.createElement('button');button.type='button';button.className='step';button.dataset.step=String(step.number);button.setAttribute('aria-pressed','false');button.innerHTML='<span class="top"><span class="num">'+step.number+'</span><span class="tag">'+step.tag+'</span></span><strong>'+step.title+'</strong>';button.addEventListener('click',()=>showStep(step));steps.appendChild(button);});showStep(phase.steps[0]);}
document.querySelectorAll('.phase').forEach((button)=>button.addEventListener('click',()=>showPhase(Number(button.dataset.phase))));showPhase(1);
</script>
</body>
</html>
`;

if (checkOnly) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== html) {
    console.error(
      `Generated Knowledge Flow baseline is stale. Run: node ${path.relative(repoRoot, import.meta.filename)}.`,
    );
    process.exit(1);
  }
  console.log(
    `PASS: ${path.relative(repoRoot, outputPath)} matches ${path.relative(repoRoot, sourcePath)}`,
  );
} else {
  writeFileSync(outputPath, html, 'utf8');
  console.log(
    `Wrote ${path.relative(repoRoot, outputPath)} from ${path.relative(repoRoot, sourcePath)}`,
  );
}
