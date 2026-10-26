'use strict';
// Network Explorer: plain JavaScript, Cytoscape.js, and three JSON files.
const $ = id => document.getElementById(id);
let hosts = [], communications = [], communicationDefinitions = [], relationships = [], relationshipDefinitions = [], cy, filters = [], selectedId = null, selectedEdgeId = null;
let visibleIds = new Set(), matchedIds = new Set(), visibleComms = [];
let displayGroups = new Map(), displayEdges = new Map(), expandedGroups = new Set();
const stored = { positions: {}, layouts: {}, namedViews: {} };
let activeViewKey = null;
const VIEW_SETTING_IDS = ['neighbours','showAllVisibleEdges','portLabels','protocol','direction','clusterMode','autoGrouping','bundlePorts','bundleMemberships'];
function viewSettings() {
  return Object.fromEntries(VIEW_SETTING_IDS.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));
}
function viewKey() {
  const conditions = filters.map(f=>[f.key,f.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const opts = viewSettings(); delete opts.portLabels;
  return JSON.stringify({conditions, opts, expanded:[...expandedGroups].sort(), isolated:opts.clusterMode==='isolated'?selectedId:null});
}
function persistLayouts(){
  try { localStorage.setItem('networkExplorerLayoutsV10', JSON.stringify({layouts:stored.layouts,namedViews:stored.namedViews})); }
  catch(e){ $('layoutInfo').textContent='Browser storage unavailable; export saved views to retain them.'; }
}
function capturePositions(key=activeViewKey) {
  if (!cy || !key) return;
  const positions={};cy.nodes().forEach(n=>{const p=n.position();if(Number.isFinite(p.x)&&Number.isFinite(p.y))positions[n.id()]={x:p.x,y:p.y};});
  if(Object.keys(positions).length){stored.layouts[key]=positions;persistLayouts();}
}
function currentSnapshot(name) {
  capturePositions();
  return {name, filters:filters.map(f=>({...f})), settings:viewSettings(), expandedGroups:[...expandedGroups], selectedId:$('clusterMode').value==='isolated'?selectedId:null, positions:structuredClone(stored.layouts[activeViewKey]||{})};
}
function renderSavedViews(selected='') {
  const names=Object.keys(stored.namedViews).sort((a,b)=>a.localeCompare(b));
  $('savedView').replaceChildren(new Option('Choose a saved view…',''),...names.map(n=>new Option(n,n)));
  if(names.includes(selected))$('savedView').value=selected;
}
function restoreSnapshot(snapshot){
  capturePositions();
  filters=snapshot.filters.map(f=>({...f}));
  VIEW_SETTING_IDS.forEach(id=>{if(!(id in snapshot.settings))return;const el=$(id); if(el.type==='checkbox')el.checked=Boolean(snapshot.settings[id]);else el.value=String(snapshot.settings[id]);});
  expandedGroups=new Set(snapshot.expandedGroups||[]);selectedId=snapshot.selectedId||null;selectedEdgeId=null;
  const key=viewKey();stored.layouts[key]=structuredClone(snapshot.positions);activeViewKey=null;
  renderChips();refresh();
}
function validateSnapshot(x){
  if(!x||typeof x!=='object'||!Array.isArray(x.filters)||!x.filters.every(f=>f&&typeof f.key==='string'&&typeof f.value==='string')||!x.settings||typeof x.settings!=='object'||!x.positions||typeof x.positions!=='object'||Array.isArray(x.positions))throw Error('Invalid saved view structure.');
  if(Object.keys(x.positions).length>20000)throw Error('Too many positions in saved view.');
  for(const p of Object.values(x.positions))if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('Invalid coordinates.');
}

const DEFAULTS = ['data/hosts.json', 'data/communications.json', 'data/relationships.json'];

function error(message) {
  const el = $('toast'); el.textContent = message; el.style.display = 'block';
  clearTimeout(error.timer); error.timer = setTimeout(() => el.style.display = 'none', 6000);
}
function safeValues(host, key) {
  const v = host.attributes?.[key];
  return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
}
function isBidirectional(c) { return c.bidirectional === 'yes'; }
function expandRelationships(definitions) {
  return definitions.flatMap(r => {
    const targets = Array.isArray(r.target) ? r.target : [r.target];
    return targets.map(target => ({...r, id: targets.length === 1 ? r.id : `${r.id}::${target}`, target}));
  });
}
// Array-valued endpoints are convenient authoring syntax. Each combination remains
// a distinct communication internally, with a deterministic, collision-safe ID.
function endpointIds(value, field, recordId) {
  const items = Array.isArray(value) ? value : [value];
  if (!items.length || items.some(id => typeof id !== 'string' || !id.trim()) || new Set(items).size !== items.length)
    throw Error(`Communication ${recordId} has invalid or duplicate ${field} IDs.`);
  return items;
}
function expandCommunications(definitions) {
  return definitions.flatMap(c => {
    const sources = endpointIds(c.source, 'source', c.id);
    const targets = endpointIds(c.target, 'target', c.id);
    const multiple = sources.length * targets.length > 1;
    return sources.flatMap((source, si) => targets.map((target, ti) => ({
      ...c, id: multiple ? `${c.id}::${si}:${ti}` : c.id, source, target,
      definitionId: c.id
    })));
  });
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
    if (!c || typeof c.id !== 'string' || !c.id || edgeIds.has(c.id) || !['TCP','UDP'].includes(c.protocol) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw Error(`Invalid communication at index ${i}. Check unique id, protocol and port.`);
    const sources = endpointIds(c.source, 'source', c.id);
    const targets = endpointIds(c.target, 'target', c.id);
    if (sources.some(id => !ids.has(id)) || targets.some(id => !ids.has(id))) throw Error(`Communication ${c.id} references an unknown source or target.`);
    if (c.bidirectional !== undefined && !['yes', 'no'].includes(c.bidirectional)) throw Error(`Invalid bidirectional on communication ${c.id}: use "yes" or "no".`);
    edgeIds.add(c.id);
  });
  const expandedIds = new Set();
  expandCommunications(commList).forEach(c => {
    if (expandedIds.has(c.id)) throw Error(`Duplicate expanded communication ID: ${c.id}`);
    expandedIds.add(c.id);
  });
  const definitionIds = new Set();
  relList.forEach((r, i) => {
    if (!r || typeof r.id !== 'string' || !r.id || definitionIds.has(r.id) || edgeIds.has(r.id)) throw Error(`Invalid/duplicate relationship definition at index ${i}.`);
    definitionIds.add(r.id);
    const targets = Array.isArray(r.target) ? r.target : [r.target];
    if (!targets.length || targets.some(t => typeof t !== 'string') || new Set(targets).size !== targets.length) throw Error(`Relationship ${r.id} has invalid or duplicate target IDs.`);
  });
  const relIds = new Set();
  expandRelationships(relList).forEach((r,i) => {
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
  capturePositions(); activeViewKey = null;
  hosts = h; communicationDefinitions = c; communications = expandCommunications(c); relationshipDefinitions = r; relationships = expandRelationships(r); expandedGroups.clear();
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
  if(host.type === 'user') return '#fae3c7';
  if(host.type === 'cloud') return '#dbe6f4';
  const env = safeValues(host,'environment').join(' ').toLowerCase();
  return env.includes('test') || env.includes('dev') ? '#eddcb4' : '#dce9fb';
}
function savedPosition(id) {
  const p = (stored.layouts[activeViewKey] || {})[id];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : undefined;
}
function buildGraph() {
  if (cy) { cy.destroy(); cy = null; }
  cy = cytoscape({
    container: $('cy'), elements: [],
    style: [
      {selector:'node',style:{'background-color':'data(color)','label':'data(label)','color':'#203b5a','font-size':12,'font-weight':600,'text-valign':'center','text-halign':'center','text-wrap':'wrap','text-max-width':'108px','shape':'round-rectangle','width':136,'height':52,'border-width':1.5,'border-color':'#92adcd','overlay-opacity':0}},
      {selector:'node[kind = "load_balanced_service"]',style:{'shape':'round-diamond','width':164,'height':72,'border-color':'#548e79'}},
      {selector:'node[kind = "cloud"]',style:{'shape':'round-rectangle','width':150,'height':76,'background-color':'#dbe6f4','border-color':'#6b89a8','border-style':'dashed','border-width':2,'font-size':12}},
      {selector:'node[kind = "user"]',style:{'shape':'ellipse','width':108,'height':88,'background-color':'#fae3c7','border-color':'#c58c45','text-max-width':'98px','font-size':12}},
      {selector:'node[kind = "auto_group"]',style:{'shape':'round-rectangle','width':174,'height':68,'background-color':'#d9e8f1','border-color':'#387da7','border-width':3,'font-size':13}},
      {selector:'edge',style:{'width':2,'curve-style':'bezier','control-point-step-size':55,'line-color':'#7e9bb8','target-arrow-shape':'triangle','target-arrow-color':'#527da4','arrow-scale':1.1,'label':'data(label)','font-size':10,'color':'#36536d','text-background-color':'#ffffff','text-background-opacity':.95,'text-background-padding':'3px','text-rotation':'none','text-border-color':'#d8e1eb','text-border-opacity':1,'text-border-width':.5,'text-margin-y':-8,'overlay-opacity':0}},
      {selector:'edge[bidirectional = "yes"]',style:{'source-arrow-shape':'triangle','source-arrow-color':'#527da4'}},
      {selector:'edge[kind = "relationship"]',style:{'line-style':'dashed','line-color':'#98a4b2','target-arrow-shape':'none','label':'data(label)','width':1.6}},
      {selector:'node:selected',style:{'border-width':4,'border-color':'#2874d0','background-color':'#c6dcfa'}},
      {selector:'edge:selected',style:{'width':4,'line-color':'#2364bc','target-arrow-color':'#2364bc','source-arrow-color':'#2364bc'}},
      {selector:'.matched',style:{'border-color':'#3a8b70','border-width':3}},
      {selector:'.dimmed',style:{'opacity':.14}},
      {selector:'.highlightEdge',style:{'width':3.5,'line-color':'#2375c1','target-arrow-color':'#2375c1','source-arrow-color':'#2375c1','opacity':1}},
      {selector:'.highlightNode',style:{'opacity':1}},
      {selector:'.found',style:{'border-width':5,'border-color':'#e59e30'}}
    ],
    minZoom:.12,maxZoom:3,wheelSensitivity:.22,layout:{name:'preset'}
  });
  cy.on('tap','node',e => {
    const id=e.target.id();
    if(displayGroups.has(id)) {selectedId=id;selectedEdgeId=null;inspect();return;}
    selectedId=id; selectedEdgeId=null;
    if($('clusterMode').value==='isolated') refresh(); else inspect();
  });
  cy.on('tap','edge',e => {selectedEdgeId=e.target.id();selectedId=null;inspect();});
  cy.on('tap',e => {if(e.target===cy){selectedId=null;selectedEdgeId=null;inspect();}});
  cy.on('dragfree','node', savePositions);
}
// Structural equivalence is computed from the complete dataset, not the current filter.
// A signature retains direction, protocol, port, exact remote endpoint, and complete cluster membership.
function communicationGroups() {
  const signatures = new Map();
  const clustersByMember = new Map();
  relationships.filter(r => r.type === 'member').forEach(r => {
    if (!clustersByMember.has(r.target)) clustersByMember.set(r.target, new Set());
    clustersByMember.get(r.target).add(r.source);
  });
  hosts.filter(h => (h.type || 'server') === 'server').forEach(h => {
    const tokens = communications.filter(c=>c.source===h.id || c.target===h.id)
      .map(c=>`${c.source===h.id?'OUT':'IN'}|${c.protocol}|${c.port}|${c.source===h.id?c.target:c.source}|${isBidirectional(c)?'BOTH':'ONE'}`)
      .sort();
    // Prevent empty-signature hosts being merged into unrelated sets.
    if (!tokens.length) return;
    const clusterIds = [...(clustersByMember.get(h.id) || [])].sort();
    const key=JSON.stringify([h.type||'server',safeValues(h,'service').sort(),safeValues(h,'site').sort(),clusterIds,tokens]);
    if(!signatures.has(key))signatures.set(key,[]);
    signatures.get(key).push(h.id);
  });
  return [...signatures.values()].filter(ids=>ids.length>1).map(ids=>ids.sort());
}
function drawGraph(visibleRel, retainPrior = true) {
  const candidates=$('autoGrouping').checked?communicationGroups():[];
  displayGroups=new Map();displayEdges=new Map();
  const representative=new Map([...visibleIds].map(id=>[id,id]));
  candidates.forEach(ids=>{
    const showing=ids.filter(id=>visibleIds.has(id));
    if(showing.length<2)return;
    const gid='auto:'+ids.join('|');
    if(expandedGroups.has(gid))return;
    displayGroups.set(gid, showing);
    showing.forEach(id=>representative.set(id,gid));
  });
  const displayed=new Set([...representative.values()]);
  const items=[...displayed].map(id=>{
    if(displayGroups.has(id)){
      const members=displayGroups.get(id);
      return {group:'nodes',data:{id,label:`${members.length} matching servers\n${members.map(x=>hosts.find(h=>h.id===x)?.name).slice(0,2).join(', ')}${members.length>2?'…':''}`,kind:'auto_group',color:'#d9e8f1'}};
    }
    const h=hosts.find(h=>h.id===id);
    return {group:'nodes',data:{id,label:h.type==='user'?`👤\n${h.name}`:h.type==='cloud'?`☁\n${h.name}`:h.name,kind:h.type||'server',color:colorFor(h)}};
  });
  const bundleMap=new Map();
  visibleComms.forEach(c=>{
    const from=representative.get(c.source),to=representative.get(c.target);
    if(from===to)return; // internal edges are inspectable in expanded view
    const key=$('bundlePorts').checked?JSON.stringify([from,to,isBidirectional(c)]):c.id;
    if(!bundleMap.has(key))bundleMap.set(key,{source:from,target:to,comms:[]});
    bundleMap.get(key).comms.push(c);
  });
  let index=0;
  bundleMap.forEach(record=>{
    const id='display-edge-'+index++;
    const labels=[...new Set(record.comms.map(c=>`${c.protocol} ${c.port}`))];
    const label=record.comms.length===1?labels[0]:labels.length===1?`${labels[0]} ×${record.comms.length}`:`${labels.length} ports · ${record.comms.length} links`;
    displayEdges.set(id,record.comms);
    items.push({group:'edges',data:{id,source:record.source,target:record.target,label,kind:'communication',bidirectional:isBidirectional(record.comms[0])?'yes':'no'}});
  });
  const membershipBundles = new Map();
  visibleRel.forEach(r => {
    const source = representative.get(r.source), target = representative.get(r.target);
    if (!source || !target || source === target) return;
    const key = $('bundleMemberships').checked ? JSON.stringify([source,target,r.type]) : r.id;
    if (!membershipBundles.has(key)) membershipBundles.set(key,{source,target,records:[]});
    membershipBundles.get(key).records.push(r);
  });
  let relIndex = 0;
  membershipBundles.forEach(({source,target,records}) => {
    const id = `relation:${relIndex++}`;
    displayEdges.set(id, records);
    items.push({group:'edges',data:{id,source,target,label:records.length>1?`${records.length} members`:'',kind:'relationship'}});
  });
  const prior=new Map();if(retainPrior)cy.nodes().forEach(n=>prior.set(n.id(),{...n.position()}));
  cy.elements().remove();cy.add(items);
  cy.nodes().forEach(n=>{
    const p=prior.get(n.id())||savedPosition(n.id());
    if(p)n.position(p);
  });
  cy.edges('[kind = "communication"]').style('label',$('portLabels').checked?'data(label)':'');
  cy.nodes().forEach(n=>{
    const members=displayGroups.get(n.id())||[n.id()];
    if(filters.length && members.some(id=>matchedIds.has(id)))n.addClass('matched');
  });
}
function savePositions(){capturePositions();}
function refresh() {
  if (!cy) return;
  const nextKey=viewKey();
  const switchedView=activeViewKey!==nextKey;
  if(switchedView){capturePositions();activeViewKey=nextKey;}
  const hasPositions=Object.keys(stored.layouts[nextKey]||{}).length>0;
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
  drawGraph(visibleRel, !switchedView);
  $('hostCount').textContent = `${visibleIds.size.toLocaleString()} elements shown`;
  $('linkCount').textContent = `${visibleComms.length.toLocaleString()} communications`;
  $('matchCount').textContent = `${visibleRel.length} memberships · ${matchedIds.size} matched`;
  $('empty').hidden = visibleIds.size > 0;
  if (selectedId && !cy.getElementById(selectedId).length) selectedId = null;
  if (selectedEdgeId && !cy.getElementById(selectedEdgeId).length) selectedEdgeId = null;
  findSearchMatches();inspect();
  if(cy.nodes().length){
    if(!hasPositions)autoLayout();
    else cy.fit(cy.elements(),55);
  }
}
function findSearchMatches() {
  if(!cy) return;
  const q = $('search').value.trim().toLowerCase();
  cy.batch(() => {
    cy.nodes().removeClass('found');
    if(q) hosts.forEach(h => {
      const text = [h.name,h.id,...Object.values(h.attributes||{}).flat()].join(' ').toLowerCase();
      if(visibleIds.has(h.id) && text.includes(q)) {const nid=[...displayGroups].find(([,members])=>members.includes(h.id))?.[0]||h.id;cy.getElementById(nid).addClass('found');}
    });
  });
}
function el(tag, cls, text) {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function section(title,parent){const s=el('section','detailSection');s.append(el('h3','',title));parent.append(s);return s;}
function hostLink(id){const h=hosts.find(x=>x.id===id);const b=el('button','',h?.name||id);b.onclick=()=>{const group=[...displayGroups].find(([,members])=>members.includes(id));if(group){expandedGroups.add(group[0]);selectedId=id;selectedEdgeId=null;refresh();}else{selectedId=id;selectedEdgeId=null;inspect();}const node=cy.getElementById(id);if(node.length)cy.center(node);};return b;}
function inspect() {
  const panel=$('detailContent');panel.replaceChildren();
  cy.elements().removeClass('dimmed highlightEdge highlightNode'); cy.elements().unselect();
  if(selectedId && displayGroups.has(selectedId)){
    const members=displayGroups.get(selectedId);
    panel.append(el('div','detailName',`Communication group (${members.length})`),el('p','help','These servers have identical full-dataset communication signatures. They are not a logical VIP or new infrastructure object.'));
    const b=el('button','primary stretch','Expand these servers');
    b.onclick=()=>{expandedGroups.add(selectedId);selectedId=null;refresh();};panel.append(b);
    const sec=section('Group members',panel);
    members.forEach(id=>{const host=hosts.find(h=>h.id===id);const div=el('div','comm');div.append(hostLink(id),el('small','',` · ${safeValues(host,'ip').join(', ')}`));sec.append(div);});
    return;
  }
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
      items.forEach(c=>{const d=el('div','comm');d.append(hostLink(isIncoming?c.source:c.target));d.append(el('small','',` · ${c.protocol} ${c.port}${isBidirectional(c)?' · bidirectional':''}${c.description?' — '+c.description:''}`));s.append(d);});
    }
    const connected=new Set([h.id]);const related=new Set();
    visibleComms.forEach(c=>{if(c.source===h.id||c.target===h.id){connected.add(c.source);connected.add(c.target);related.add(c.id);}});
    cy.batch(()=>{cy.elements().addClass('dimmed');connected.forEach(id=>{const rep=[...displayGroups].find(([,members])=>members.includes(id))?.[0]||id;cy.getElementById(rep).removeClass('dimmed').addClass('highlightNode');});displayEdges.forEach((items,eid)=>{if(items.some(c=>related.has(c.id)))cy.getElementById(eid).removeClass('dimmed').addClass('highlightEdge');});});
  } else if(selectedEdgeId){
    const records=displayEdges.get(selectedEdgeId);if(!records)return;
    cy.getElementById(selectedEdgeId).select();
    if(records[0].type==='member'){
      panel.append(el('div','detailName',records.length > 1 ? `${records.length} cluster memberships` : 'Cluster membership'));
      const ms=section('Relationship',panel);
      records.forEach(r=>{ms.append(hostLink(r.source),el('p','caption','Contains member'),hostLink(r.target));});
      return;
    }
    panel.append(el('div','detailName',records.length===1?`${records[0].protocol} ${records[0].port}`:`${records.length} individual communications`));
    const s=section('Underlying connections',panel);
    records.forEach(c=>{
      const line=el('div','comm');
      line.append(hostLink(c.source),el('span','caption',isBidirectional(c)?' ↔ ':' → '),hostLink(c.target),el('small','',` · ${c.protocol} ${c.port}${isBidirectional(c)?' · bidirectional':''}${c.description?' — '+c.description:''}`));s.append(line);
    });
  } else panel.append(el('p','help','Select a host or communication to inspect its attributes and connections.'));
}
function download(name, content, type='application/json') {
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importFile(file,kind){
  if(!file)return;
  try {const parsed=JSON.parse(await file.text());
    if(kind==='hosts')setData(parsed,communicationDefinitions,relationshipDefinitions,true);else if(kind==='comms')setData(hosts,parsed,relationshipDefinitions,true);else setData(hosts,communicationDefinitions,parsed,true);
  }catch(e){error(`Import failed: ${e.message}. Existing data was kept.`);}
}
function autoLayout(){
  if(!cy)return;
  const shown=cy.nodes();if(!shown.length)return;
  const visible = cy.elements();
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
  ['neighbours','showAllVisibleEdges','portLabels','protocol','direction','clusterMode','autoGrouping','bundlePorts','bundleMemberships'].forEach(id=>$(id).addEventListener('change',refresh));
  $('search').addEventListener('input',findSearchMatches);
  $('expandReset').onclick=()=>{expandedGroups.clear();selectedId=null;selectedEdgeId=null;refresh();};
  $('unselect').onclick=()=>{selectedId=null;selectedEdgeId=null;inspect();};
  $('fitBtn').onclick=()=>{if(cy.nodes(':visible').length)cy.fit(cy.elements(':visible'),55);};
  $('layoutBtn').onclick=autoLayout;
  $('saveView').onclick=()=>{
    const name=$('viewName').value.trim();if(!name){error('Enter a view name first.');return;}
    if(stored.namedViews[name]&&!confirm(`Overwrite saved view "${name}"?`))return;
    stored.namedViews[name]=currentSnapshot(name);persistLayouts();renderSavedViews(name);$('layoutInfo').textContent=`Saved "${name}" locally. Export JSON for a backup.`;
  };
  $('loadView').onclick=()=>{
    const name=$('savedView').value;if(!name||!stored.namedViews[name]){error('Choose a saved view.');return;}
    restoreSnapshot(stored.namedViews[name]);$('viewName').value=name; persistLayouts();
  };
  $('deleteView').onclick=()=>{
    const name=$('savedView').value;if(!name||!stored.namedViews[name])return;
    if(!confirm(`Delete saved view "${name}"?`))return;
    delete stored.namedViews[name];persistLayouts();renderSavedViews();
  };
  $('exportViews').onclick=()=>{capturePositions();download('network-explorer-views.json',JSON.stringify({format:'network-explorer-views',version:1,views:Object.values(stored.namedViews)},null,2));};
  $('importViews').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    try{const data=JSON.parse(await file.text());if(data.format!=='network-explorer-views'||data.version!==1||!Array.isArray(data.views))throw Error('Unsupported views file.');
      if(data.views.length>500)throw Error('Too many views.');
      const imports={};for(const view of data.views){validateSnapshot(view);if(typeof view.name!=='string'||!view.name.trim()||view.name.length>100)throw Error('Invalid view name.');imports[view.name]=view;}
      Object.assign(stored.namedViews,imports);persistLayouts();renderSavedViews();$('layoutInfo').textContent=`Imported ${data.views.length} views. Choose one and click Load view.`;
    }catch(ex){error(`View import failed: ${ex.message}`);}
  });
  $('importHosts').addEventListener('change',e=>{importFile(e.target.files[0],'hosts');e.target.value='';});
  $('importComms').addEventListener('change',e=>{importFile(e.target.files[0],'comms');e.target.value='';});
  $('exportHosts').onclick=()=>download('hosts.json',JSON.stringify(hosts,null,2));
  $('exportComms').onclick=()=>download('communications.json',JSON.stringify(communicationDefinitions,null,2));
  $('importRelationships').addEventListener('change',e=>{importFile(e.target.files[0],'relationships');e.target.value='';});
  $('exportRelationships').onclick=()=>download('relationships.json',JSON.stringify(relationshipDefinitions,null,2));
  $('resetData').onclick=()=>loadDefaults().catch(e=>error(e.message));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){selectedId=null;selectedEdgeId=null;inspect();}});
}
async function main(){
  wire();
  if(typeof cytoscape!=='function'){$('status').textContent='Library unavailable';error('Cytoscape.js could not load. Check your internet connection (the first version uses a CDN).');return;}
  try{const data=JSON.parse(localStorage.getItem('networkExplorerLayoutsV10')||'{}');if(data.layouts&&typeof data.layouts==='object')stored.layouts=data.layouts;if(data.namedViews&&typeof data.namedViews==='object')stored.namedViews=data.namedViews;}catch(e){}
  renderSavedViews();
  try{await loadDefaults();}catch(e){$('status').textContent='Load failed';error(`${e.message}. Serve this folder using python -m http.server 4321.`);}
}
document.addEventListener('DOMContentLoaded',main);
