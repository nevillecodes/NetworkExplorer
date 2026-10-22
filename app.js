'use strict';
// Network Explorer: plain JavaScript, Cytoscape.js, and three JSON files.
const $ = id => document.getElementById(id);
let hosts = [], communications = [], relationships = [], cy, filters = [], selectedId = null, selectedEdgeId = null;
let visibleIds = new Set(), matchedIds = new Set(), visibleComms = [];
const stored = { positions: {} };
const DEFAULTS = ['data/hosts.json', 'data/communications.json', 'data/relationships.json'];

function error(message) {
  const el = $('toast'); el.textContent = message; el.style.display = 'block';
  clearTimeout(error.timer); error.timer = setTimeout(() => el.style.display = 'none', 6000);
}
function safeValues(host, key) {
  const v = host.attributes?.[key];
  return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
}
function validate(hostList, commList, relList) {
  if (!Array.isArray(relList)) throw Error("Relationships JSON must contain an array.");
  if (!Array.isArray(hostList) || !Array.isArray(commList)) throw Error('Both JSON files must contain arrays.');
  const ids = new Set();
  hostList.forEach((h, i) => {
    if (!h || typeof h.id !== 'string' || !h.id || typeof h.name !== 'string' || !h.name || !h.attributes || typeof h.attributes !== 'object' || Array.isArray(h.attributes)) throw Error(`Invalid host at index ${i}: id, name and attributes are required.`);
    if (ids.has(h.id)) throw Error(`Duplicate host ID: ${h.id}`);
    ids.add(h.id);
  });
  const edgeIds = new Set();
  commList.forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || !c.id || edgeIds.has(c.id) || !ids.has(c.source) || !ids.has(c.target) || !['TCP','UDP'].includes(c.protocol) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw Error(`Invalid communication at index ${i}. Check unique id, source/target, protocol and port.`);
    edgeIds.add(c.id);
  });
  const relIds = new Set();
  relList.forEach((r,i) => {
    if(!r || typeof r.id !== 'string' || !r.id || relIds.has(r.id) || edgeIds.has(r.id) || !ids.has(r.source) || !ids.has(r.target) || r.source === r.target || r.type !== 'member') throw Error(`Invalid relationship at index ${i}. Use unique id, existing source/target and type member.`);
    if((hostList.find(h=>h.id===r.source)?.type || 'server') !== 'load_balanced_service') throw Error(`Relationship ${r.id} must originate at a load_balanced_service.`);
    relIds.add(r.id);
  });
}
async function loadDefaults() {
  const results = await Promise.all(DEFAULTS.map(async url => {
    const response = await fetch(url, {cache:'no-store'});
    if (!response.ok) throw Error(`Could not load ${url} (${response.status})`);
    return response.json();
  }));
  setData(results[0], results[1], results[2], true);
}
function setData(h, c, r, resetFilters = false) {
  validate(h, c, r);
  hosts = h; communications = c; relationships = r;
  if (resetFilters) { filters = []; $('search').value = ''; }
  else filters = filters.filter(f => hosts.some(item => safeValues(item, f.key).includes(f.value)));
  rebuildSelectors(); renderChips(); buildGraph(); refresh();
  $('status').textContent = `${hosts.length.toLocaleString()} hosts loaded`;
}
function rebuildSelectors() {
  const current = $('attribute').value;
  const keys = [...new Set(hosts.flatMap(h => Object.keys(h.attributes || {})))].sort();
  $('attribute').replaceChildren(...keys.map(k => new Option(k.replaceAll('_',' '), k)));
  if (keys.includes(current)) $('attribute').value = current;
  rebuildValues();
}
function rebuildValues() {
  const vals = [...new Set(hosts.flatMap(h => safeValues(h, $('attribute').value)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  $('value').replaceChildren(...vals.map(v => new Option(v,v)));
  $('addFilter').disabled = !vals.length;
}
function renderChips() {
  const holder = $('chips'); holder.replaceChildren();
  filters.forEach((f,i) => {
    const chip = document.createElement('span'); chip.className = 'chip';
    chip.append(document.createTextNode(`${f.key}: ${f.value}`));
    const del = document.createElement('button'); del.textContent = '×'; del.title = 'Remove condition';
    del.addEventListener('click', () => {filters.splice(i,1);renderChips();refresh();});
    chip.append(del); holder.append(chip);
  });
}
function colorFor(host) {
  if(host.type === 'load_balanced_service') return '#cceadf';
  const env = safeValues(host,'environment').join(' ').toLowerCase();
  return env.includes('test') || env.includes('dev') ? '#eddcb4' : '#dce9fb';
}
function savedPosition(id) {
  const p = stored.positions[id];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : undefined;
}
function buildGraph() {
  if (cy) { cy.destroy(); cy = null; }
  // Include every item in the model; Cytoscape's hidden class controls visibility.
  cy = cytoscape({
    container: $('cy'),
    elements: [
      ...hosts.map(h => ({group:'nodes',data:{id:h.id,label:h.name,color:colorFor(h),kind:h.type||'server'}})),
      ...communications.map(c => ({group:'edges',data:{id:c.id,source:c.source,target:c.target,label:`${c.protocol} ${c.port}`,kind:'communication'}})),
      ...relationships.map(r => ({group:'edges',data:{id:r.id,source:r.source,target:r.target,label:'member',kind:'relationship'}}))
    ],
    style: [
      {selector:'node',style:{'background-color':'data(color)','label':'data(label)','color':'#203b5a','font-size':12,'font-weight':600,'text-valign':'center','text-halign':'center','text-wrap':'wrap','text-max-width':'108px','shape':'round-rectangle','width':136,'height':52,'border-width':1.5,'border-color':'#92adcd','overlay-opacity':0}},
      {selector:'node[kind = "load_balanced_service"]',style:{'shape':'round-diamond','width':164,'height':72,'border-color':'#548e79'}},
      {selector:'edge',style:{'width':2,'curve-style':'bezier','control-point-step-size':55,'line-color':'#7e9bb8','target-arrow-shape':'triangle','target-arrow-color':'#527da4','arrow-scale':1.1,'label':'data(label)','font-size':10,'color':'#36536d','text-background-color':'#ffffff','text-background-opacity':.95,'text-background-padding':'3px','text-rotation':'none','text-border-color':'#d8e1eb','text-border-opacity':1,'text-border-width':.5,'text-margin-y':-8,'overlay-opacity':0}},
      {selector:'edge[kind = "relationship"]',style:{'line-style':'dashed','line-color':'#98a4b2','target-arrow-shape':'none','label':'','width':1.6,'curve-style':'bezier'}},
      {selector:'.hidden',style:{'display':'none'}},
      {selector:'node:selected',style:{'border-width':4,'border-color':'#2874d0','background-color':'#c6dcfa'}},
      {selector:'edge:selected',style:{'width':4,'line-color':'#2364bc','target-arrow-color':'#2364bc'}},
      {selector:'.matched',style:{'border-color':'#3a8b70','border-width':3}},
      {selector:'.dimmed',style:{'opacity':.14}},
      {selector:'.highlightEdge',style:{'width':3.5,'line-color':'#2375c1','target-arrow-color':'#2375c1','opacity':1}},
      {selector:'.highlightNode',style:{'opacity':1}},
      {selector:'.found',style:{'border-width':5,'border-color':'#e59e30'}}
    ],
    minZoom:.12,maxZoom:3,wheelSensitivity:.22,
    layout:{name:'grid',padding:80,cols:Math.max(2,Math.ceil(Math.sqrt(hosts.length)))}
  });
  const saved = hosts.filter(h => savedPosition(h.id));
  if(saved.length === hosts.length) cy.nodes().positions(n => savedPosition(n.id()));
  cy.on('tap','node',e => { selectedId = e.target.id(); selectedEdgeId = null; if($('clusterMode').value==='isolated') refresh(); else inspect(); });
  cy.on('tap','edge',e => { selectedEdgeId = e.target.id(); selectedId = null; inspect(); });
  cy.on('tap',e => {if(e.target===cy){selectedId=null;selectedEdgeId=null;inspect();}});
  cy.on('dragfree','node', savePositions);
}
function savePositions() {
  // Stored only in this browser; export/import JSON remains the portable source of truth.
  try {
    cy.nodes().forEach(n => {const p=n.position();stored.positions[n.id()]={x:p.x,y:p.y};});
    localStorage.setItem('networkExplorerPositions',JSON.stringify(stored.positions));
  } catch(e) { /* Private browsing may disallow localStorage. */ }
}
function refresh() {
  if (!cy) return;
  const matched = hosts.filter(h => filters.every(f => safeValues(h,f.key).includes(f.value)));
  matchedIds = new Set(matched.map(h=>h.id));
  const protocol = $('protocol').value;
  const eligible = communications.filter(c => protocol === 'all' || c.protocol === protocol);
  const dir = $('direction').value;
  const adjacent = eligible.filter(c => (dir !== 'incoming' && matchedIds.has(c.source)) || (dir !== 'outgoing' && matchedIds.has(c.target)));
  visibleIds = new Set(matchedIds);
  if ($('neighbours').checked) adjacent.forEach(c => {visibleIds.add(c.source);visibleIds.add(c.target);});

  // The communication graph determines visibility. Membership never adds nodes
  // during normal filtering: expanding only reveals membership lines between
  // elements that are already visible for a real communication reason.
  const mode = $('clusterMode').value;
  const selectedCluster = selectedId && (hosts.find(h=>h.id===selectedId)?.type === 'load_balanced_service'
    ? selectedId : relationships.find(r=>r.target===selectedId)?.source);
  const isolating = mode === 'isolated' && Boolean(selectedCluster);
  if (isolating) {
    // Isolation is a deliberate request to inspect the whole logical family.
    const family = new Set([selectedCluster]);
    relationships.filter(r=>r.source===selectedCluster).forEach(r=>family.add(r.target));
    visibleIds = new Set(family);
    eligible.filter(c=>family.has(c.source)||family.has(c.target))
      .forEach(c=>{visibleIds.add(c.source);visibleIds.add(c.target);});
  }
  if ($('showAllVisibleEdges').checked || !filters.length || isolating) {
    visibleComms = eligible.filter(c => visibleIds.has(c.source) && visibleIds.has(c.target));
  } else {
    const adjacency = new Set(adjacent.map(c => c.id));
    visibleComms = eligible.filter(c => adjacency.has(c.id) && visibleIds.has(c.source) && visibleIds.has(c.target));
  }
  const visibleRel = mode === 'collapsed' ? [] : relationships.filter(r =>
    visibleIds.has(r.source) && visibleIds.has(r.target) && (!isolating || r.source === selectedCluster));
  const edgeSet = new Set([...visibleComms.map(c=>c.id),...visibleRel.map(r=>r.id)]);
  cy.batch(() => {
    cy.elements().removeClass('hidden matched found dimmed highlightEdge highlightNode');
    cy.nodes().forEach(n => {
      if(!visibleIds.has(n.id())) n.addClass('hidden');
      else if(filters.length && matchedIds.has(n.id())) n.addClass('matched');
    });
    cy.edges().forEach(e=>{if(!edgeSet.has(e.id())) e.addClass('hidden');});
    cy.edges('[kind = "communication"]').style('label', $('portLabels').checked ? 'data(label)' : '');
  });
  $('hostCount').textContent = `${visibleIds.size.toLocaleString()} elements shown`;
  $('linkCount').textContent = `${visibleComms.length.toLocaleString()} communications`;
  $('matchCount').textContent = `${visibleRel.length} memberships · ${matchedIds.size} matched`;
  $('empty').hidden = visibleIds.size > 0;
  if (selectedId && !visibleIds.has(selectedId)) selectedId = null;
  if (selectedEdgeId && !edgeSet.has(selectedEdgeId)) selectedEdgeId = null;
  findSearchMatches();inspect();
  if(cy.nodes(':visible').length) cy.fit(cy.elements(':visible'),55);
}
function findSearchMatches() {
  if(!cy) return;
  const q = $('search').value.trim().toLowerCase();
  cy.batch(() => {
    cy.nodes().removeClass('found');
    if(q) hosts.forEach(h => {
      const text = [h.name,h.id,...Object.values(h.attributes||{}).flat()].join(' ').toLowerCase();
      if(visibleIds.has(h.id) && text.includes(q)) cy.getElementById(h.id).addClass('found');
    });
  });
}
function el(tag, cls, text) {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function section(title,parent){const s=el('section','detailSection');s.append(el('h3','',title));parent.append(s);return s;}
function hostLink(id){const h=hosts.find(x=>x.id===id);const b=el('button','',h?.name||id);b.onclick=()=>{selectedId=id;selectedEdgeId=null;inspect();const node=cy.getElementById(id);if(node.length)cy.center(node);};return b;}
function inspect() {
  const panel=$('detailContent');panel.replaceChildren();
  cy.elements().removeClass('dimmed highlightEdge highlightNode'); cy.elements().unselect();
  if(selectedId){
    const h=hosts.find(x=>x.id===selectedId); if(!h)return;
    cy.getElementById(h.id).select();
    panel.append(el('div','detailName',h.name),el('div','detailId',`${h.type||'server'} · ${h.id}`));
    const group = relationships.filter(r=>r.source===h.id || r.target===h.id);
    if(group.length){const ms=section('Cluster relationships',panel);group.forEach(r=>{const line=el('div','comm');line.append(el('span','caption',r.source===h.id?'Member: ':'Member of: '));line.append(hostLink(r.source===h.id?r.target:r.source));ms.append(line);});}
    const attrs=section('Attributes',panel);
    Object.entries(h.attributes).sort(([a],[b])=>a.localeCompare(b)).forEach(([key,val])=>{
      const line=el('div','attr');line.append(el('b','',key.replaceAll('_',' ')));
      (Array.isArray(val)?val:[val]).forEach(v=>line.append(el('span','value',v)));
      attrs.append(line);
    });
    const incoming=visibleComms.filter(c=>c.target===h.id);
    const outgoing=visibleComms.filter(c=>c.source===h.id);
    for(const [title,items,isIncoming] of [['Outgoing',outgoing,false],['Incoming',incoming,true]]){
      const s=section(`${title} communications (${items.length})`,panel);
      if(!items.length)s.append(el('p','caption','None in the current view.'));
      items.forEach(c=>{const d=el('div','comm');d.append(hostLink(isIncoming?c.source:c.target));d.append(el('small','',` · ${c.protocol} ${c.port}${c.description?' — '+c.description:''}`));s.append(d);});
    }
    const connected=new Set([h.id]);const related=new Set();
    visibleComms.forEach(c=>{if(c.source===h.id||c.target===h.id){connected.add(c.source);connected.add(c.target);related.add(c.id);}});
    cy.batch(()=>{cy.elements(':visible').addClass('dimmed');connected.forEach(id=>cy.getElementById(id).removeClass('dimmed').addClass('highlightNode'));related.forEach(id=>cy.getElementById(id).removeClass('dimmed').addClass('highlightEdge'));});
  } else if(selectedEdgeId){
    const c=communications.find(x=>x.id===selectedEdgeId) || relationships.find(x=>x.id===selectedEdgeId);if(!c)return;
    if(c.type==='member'){panel.append(el('div','detailName','Cluster membership'));const ms=section('Relationship',panel);ms.append(hostLink(c.source),el('p','caption','Contains member'),hostLink(c.target));return;}
    cy.getElementById(c.id).select();
    panel.append(el('div','detailName',`${c.protocol} ${c.port}`),el('div','detailId',c.id));
    const s=section('Communication',panel);
    s.append(el('p','caption','Initiator'));s.append(hostLink(c.source));
    s.append(el('p','caption','Destination'));s.append(hostLink(c.target));
    if(c.description)s.append(el('p','',c.description));
  } else panel.append(el('p','help','Select a host or communication to inspect its attributes and connections.'));
}
function download(name, content, type='application/json') {
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importFile(file,kind){
  if(!file)return;
  try {const parsed=JSON.parse(await file.text());
    if(kind==='hosts')setData(parsed,communications,relationships,true);else if(kind==='comms')setData(hosts,parsed,relationships,true);else setData(hosts,communications,parsed,true);
  }catch(e){error(`Import failed: ${e.message}. Existing data was kept.`);}
}
function autoLayout(){
  if(!cy)return;
  const shown=cy.nodes(':visible');if(!shown.length)return;
  const visible = cy.elements(':visible');
  if(shown.length<=180){
    visible.layout({name:'cose',animate:false,randomize:true,nodeRepulsion:()=>180000,idealEdgeLength:()=>160,edgeElasticity:()=>80,gravity:.3,numIter:350,padding:60,fit:true}).run();
  } else {
    visible.layout({name:'grid',animate:false,padding:60,fit:true,sort:(a,b)=>a.data('label').localeCompare(b.data('label'))}).run();
  }
  savePositions();
}
function wire(){
  $('attribute').addEventListener('change',rebuildValues);
  $('addFilter').onclick=()=>{const key=$('attribute').value,value=$('value').value;if(!key||value==null)return;if(!filters.some(f=>f.key===key&&f.value===value))filters.push({key,value});renderChips();refresh();};
  $('clearFilters').onclick=()=>{filters=[];renderChips();refresh();};
  ['neighbours','showAllVisibleEdges','portLabels','protocol','direction','clusterMode'].forEach(id=>$(id).addEventListener('change',refresh));
  $('search').addEventListener('input',findSearchMatches);
  $('unselect').onclick=()=>{selectedId=null;selectedEdgeId=null;inspect();};
  $('fitBtn').onclick=()=>{if(cy.nodes(':visible').length)cy.fit(cy.elements(':visible'),55);};
  $('layoutBtn').onclick=autoLayout;
  $('importHosts').addEventListener('change',e=>{importFile(e.target.files[0],'hosts');e.target.value='';});
  $('importComms').addEventListener('change',e=>{importFile(e.target.files[0],'comms');e.target.value='';});
  $('exportHosts').onclick=()=>download('hosts.json',JSON.stringify(hosts,null,2));
  $('exportComms').onclick=()=>download('communications.json',JSON.stringify(communications,null,2));
  $('importRelationships').addEventListener('change',e=>{importFile(e.target.files[0],'relationships');e.target.value='';});
  $('exportRelationships').onclick=()=>download('relationships.json',JSON.stringify(relationships,null,2));
  $('resetData').onclick=()=>loadDefaults().catch(e=>error(e.message));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){selectedId=null;selectedEdgeId=null;inspect();}});
}
async function main(){
  wire();
  if(typeof cytoscape!=='function'){$('status').textContent='Library unavailable';error('Cytoscape.js could not load. Check your internet connection (the first version uses a CDN).');return;}
  try{const p=JSON.parse(localStorage.getItem('networkExplorerPositions')||'{}');if(p&&typeof p==='object')stored.positions=p;}catch(e){}
  try{await loadDefaults();}catch(e){$('status').textContent='Load failed';error(`${e.message}. Serve this folder using python -m http.server 4321.`);}
}
document.addEventListener('DOMContentLoaded',main);
