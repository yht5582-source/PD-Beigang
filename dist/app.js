'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let stage='initial',assessment=null,rx=null,snapshot=null,validation=null,isDemo=false,adjust=null,history=[],unsaved=false;
const stageNames={initial:'初始處方（無 PET）',follow:'治療中調整',pet:'PET 後最佳化'};
const option=(v,label,selected)=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(label)}</option>`;
function data(){const d={stage};document.querySelectorAll('.inputs input,.inputs select').forEach(el=>{if(el.id)d[el.id]=el.type==='checkbox'?el.checked:el.value;});d.symptoms=[...document.querySelectorAll('[data-symptom]:checked')].map(el=>el.dataset.symptom);d.symptom=d.symptoms.length?(d.symptoms.some(x=>x!=='none')?'yes':'none'):'';if(!d.symptoms.some(x=>x!=='none')){d.symptomSeverity='';d.symptomAttribution='';}if(stage==='initial')d.infection=false;return d;}
function callouts(items,kind='warning'){return items.map(x=>`<div class="callout ${kind}">${esc(x)}</div>`).join('');}
function invalidate(){assessment=null;rx=null;snapshot=null;validation=null;$('prescriptionPanel').hidden=true;$('resultStatus').textContent='待重新評估';$('assessment').innerHTML='<div class="empty"><h3>資料已更新</h3><p>按「評估方式與產生草案」以更新建議。</p></div>'; $('reviewed').checked=false;adjust=null;$('compare').innerHTML='';}
function timing(){const start=$('start').value;if(!start){$('petTiming').textContent='初始處方不要求 PET；首次 PET 建議於開始 PD 後 6–12 週安排。';return;}const date=new Date(start+'T00:00:00+08:00');const display=days=>new Date(date.getTime()+days*86400000).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'});$('petTiming').textContent=`首次 PET 建議安排：${display(42)}–${display(84)}（開始 PD 後 6–12 週）；依臨床需要調整。`;}
function symptomControls(){const present=[...document.querySelectorAll('[data-symptom]:checked')].some(el=>el.dataset.symptom!=='none');$('symptomDetails').hidden=!present;}
function setStage(value){stage=value;document.querySelectorAll('[data-stage]').forEach(el=>el.setAttribute('aria-selected',el.dataset.stage===stage));document.querySelectorAll('.follow-panel').forEach(el=>el.hidden=stage==='initial');document.querySelectorAll('.pet-panel').forEach(el=>el.hidden=stage!=='pet');invalidate();if(stage==='pet')renderPet();progress();}
// 區段導覽與必要資料進度
function fieldOf(key){return key==='symptoms'||key==='symptom'?document.querySelector('.symptom-menu'):$(key);}
function filled(key){if(key==='symptom')return !!document.querySelector('[data-symptom]:checked');const el=$(key);return !!el&&(el.type==='checkbox'?el.checked:el.value!=='');}
function progress(){
  const req=Object.keys(PD.requiredFields(stage));let done=0;const per=new Map();
  for(const key of req){const panel=fieldOf(key)?.closest('[data-nav]');if(!panel)continue;const x=per.get(panel)||{n:0,ok:0};x.n++;if(filled(key)){x.ok++;done++;}per.set(panel,x);}
  $('sectionNav').innerHTML=[...document.querySelectorAll('[data-nav]')].filter(el=>!el.hidden).map(el=>{const x=per.get(el);const complete=!x||x.ok===x.n;return `<a href="#${el.id}" class="${complete?'ok':''}">${esc(el.dataset.nav)}${x?`<small>${x.ok}/${x.n}</small>`:''}</a>`;}).join('');
  $('progress').innerHTML=`必要資料 <b>${done}/${req.length}</b><span class="bar"><i style="width:${req.length?done/req.length*100:0}%"></i></span>`;
}
function markMissing(keys){document.querySelectorAll('.is-missing').forEach(el=>el.classList.remove('is-missing'));for(const k of keys||[]){const el=fieldOf(k);(el?.tagName==='FIELDSET'?el:el?.closest('label'))?.classList.add('is-missing');}}
function focusField(key){const el=fieldOf(key);if(!el)return;const panel=el.closest('[hidden]');if(panel)return;const box=el.closest('details');if(box)box.open=true;el.scrollIntoView({behavior:'smooth',block:'center'});(el.tagName==='FIELDSET'?el.querySelector('input'):el).focus({preventScroll:true});}
function renderPet(){const p=PD.pet(data());$('petResults').innerHTML=p.ratio!==null?`<div class="metrics"><div class="metric">運輸型態<b>${esc(p.label)}</b></div><div class="metric">D/P Cr<b>${p.ratio.toFixed(3)}</b></div><div class="metric">淨超濾<b>${p.uf===null?'—':p.uf+' mL'}</b></div></div>${p.glucose!==null?`<p>D/D₀ glucose：${p.glucose.toFixed(3)}</p>`:''}${p.dip!==null?`<p>1 小時 sodium dip：${p.dip.toFixed(1)} mmol/L</p>`:''}${p.lowUf?callouts(['標準 2 L PET 超濾低於 '+p.threshold+' mL，需再評估。']):''}`:'<p class="hint">輸入 D/P Cr 或原始 Cr 數值後計算。</p>';}
function evaluate(){
  for(const el of document.querySelectorAll('.inputs input[type=number]')){if(el.closest('[hidden]')||!el.value)continue;if(!el.checkValidity()){el.reportValidity();return;}}
  snapshot=data();assessment=PD.assess(snapshot);rx=null;validation=null;$('prescriptionPanel').hidden=true;
  const a=assessment;
  markMissing(a.missingKeys);
  if(a.missing.length||a.blocks.length){$('resultStatus').textContent=a.blocks.length?'需先處理':'資料不足';$('assessment').innerHTML=callouts(a.blocks,'danger')+(a.missing.length?`<h3>請補齊以下資料</h3><ul class="missing-list">${a.missing.map((x,i)=>{const k=a.missingKeys?.[i];return `<li>${k?`<button type="button" class="link" data-focus="${esc(k)}">${esc(x)}</button>`:esc(x)}</li>`;}).join('')}</ul><p class="hint">點選項目可跳至該欄位；左側紅框為待補欄位。</p>`:'');showResult();return;}
  $('resultStatus').textContent='已產生建議';
  $('assessment').innerHTML=(isDemo?'<div class="demo-banner">示範個案，非真實病人</div>':'')+`<div class="recommendation">優先考慮 ${a.mode}</div><p>${a.alternate?`可接受替代方式：${a.alternate}，需依留置與生活需求調整。`:'目前另一方式的執行條件不足，需先建立支持。'}</p>${scoreCard(a)}<h3>判定理由</h3><ul>${a.reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`+(a.pet?`<div class="callout">PET：${esc(a.pet.label)}；D/P Cr ${a.pet.ratio.toFixed(3)}；淨超濾 ${a.pet.uf} mL</div>`:'')+`<div class="metrics"><div class="metric">BSA<b>${a.bsa.toFixed(2)} m²</b></div><div class="metric">每日尿量<b>${snapshot.urine} mL</b></div><div class="metric">${stage==='initial'?'初始腎功能':'總 weekly Kt/V'}<b>${stage==='initial'?(a.kidney.mean!==null?a.kidney.mean.toFixed(2)+' mL/min':a.kidney.egfr!==null?'eGFR '+a.kidney.egfr:a.kidney.ccr!==null?'CCr '+a.kidney.ccr:a.kidney.kru!==null?'Kru '+a.kidney.kru:'Cr '+a.kidney.cr):(a.ktv===null?'未完整提供':a.ktv.toFixed(2))}</b></div></div>`+callouts(a.warnings)+`<h3>治療指導</h3><ul>${(a.adjustments.length?a.adjustments:['依目標體重、每日超濾、症狀與生化變化追蹤；維持病人可執行的最低有效治療負擔。']).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  if(stage==='initial'){adjust=null;rx=PD.initialRx(snapshot,a);}else{adjust=PD.adjustRx(snapshot,a,CATALOG);rx=adjust.rx;}
  $('prescriptionPanel').hidden=false;$('reviewed').checked=false;renderRx();refreshRx();showResult();
}
function showResult(){if(window.matchMedia('(max-width:980px)').matches)$('assessment').closest('.panel').scrollIntoView({behavior:'smooth',block:'start'});else $('assessment').closest('.output').scrollTo({top:0,behavior:'smooth'});}
function scoreCard(a){
  if(!a.factors)return '';const s=a.scores,max=Math.max(1,s.apd,s.capd);
  const row=(m,v,ok)=>`<div class="score-row ${a.mode===m?'win':''}"><span>${m}</span><span class="bar"><i style="width:${ok?Math.max(3,v/max*100):0}%"></i></span><b>${ok?v:'不可行'}</b></div>`;
  return `<div class="score">${row('APD',s.apd,s.apdOk)}${row('CAPD',s.capd,s.capdOk)}${a.factors.length?`<table class="factors"><thead><tr><th>排序因素</th><th>APD</th><th>CAPD</th></tr></thead><tbody>${a.factors.map(f=>`<tr><td>${esc(f.label)}</td><td>${f.apd?'+'+f.apd:''}</td><td>${f.capd?'+'+f.capd:''}</td></tr>`).join('')}</tbody></table>`:'<p class="hint">無偏好、PET 或生活因素時同分，預設 CAPD 作為起點。</p>'}<p class="hint">工作站透明排序規則，非經驗證預後分數；同分時以 CAPD 為起點。</p></div>`;
}
// 現行 vs 草案比較
const longNames={dry:'乾腹',glucose:'葡萄糖液',ico:'Icodextrin',aa:'Nutrineal'};
function diffRows(cur,next){
  const f=(k,v)=>v===null||v===undefined||v===''?'—':k==='fill'?v+' mL':k==='hours'?v+' h':k==='concentration'?v+'%':k==='long'?longNames[v]||v:k==='count'?v+' 次':v;
  return [['mode','方式'],['fill','灌注量'],['count','交換／循環次數'],['hours','APD 時數'],['concentration','主要葡萄糖濃度'],['long','長留置']].map(([k,label])=>({k,label,a:f(k,cur?.[k]),b:f(k,next?.[k]),changed:cur&&next&&String(cur[k]??'')!==String(next[k]??'')}));
}
function changeText(cur,next){return diffRows(cur,next).filter(x=>x.changed).map(x=>`${x.label} ${x.a}→${x.b}`);}
function renderCompare(){
  if(stage==='initial'||!adjust){$('compare').innerHTML='';return;}
  const cur=PD.currentSummary(snapshot),next=PD.rxSummary(rx);
  $('compare').innerHTML=`<h3>現行處方 → 本次草案</h3><div class="table-wrap"><table class="compare"><thead><tr><th>項目</th><th>現行</th><th>本次草案</th></tr></thead><tbody>${diffRows(cur,next).filter(x=>x.changed||x.a!=='—'||x.b!=='—').map(x=>`<tr class="${x.changed?'changed':''}"><td>${x.label}</td><td>${esc(x.a)}</td><td>${esc(x.b)}</td></tr>`).join('')}</tbody></table></div><div class="callout"><b>系統調整建議</b><ul>${adjust.changes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><p class="hint">一次只調整一項容量與一項清除相關設定，調整後依實測反應再評估。下方可繼續手動修改，比較表即時更新。</p>`;
}
function input(label,key,value,min,max,step=1){return `<label>${label}<input data-rx="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value??''}"></label>`;}
function select(label,key,value,opts){return `<label>${label}<select data-rx="${key}">${opts.map(x=>option(x[0],x[1],value)).join('')}</select></label>`;}
function renderRx(){
  const modeChooser=select('處方模式（可比較替代方案）','mode',rx.mode,[['CAPD','CAPD'],['APD','APD']]);
  let html=`<p class="hint">${snapshot.dose==='incremental'?'增量式':'一般'}草案模板；不是療效保證。用液濃度為容量導向的起點，須以實測超濾調整。修改下方處方會即時更新總量與醫令。</p><div class="grid">${modeChooser}</div>`;
  if(rx.mode==='CAPD'){
    html+=`<div class="grid">${input('交換次數','count',rx.rows.length,1,6)}</div>`;
    rx.rows.forEach((row,i)=>{const products=CATALOG.filter(x=>x.mode==='CAPD'&&x.bag>=row.volume);let product=PD.validateRx({...rx,rows:[row]},snapshot,assessment,CATALOG).bags[0]?.product;html+=`<div class="rx-row"><div class="rx-row-title">第 ${i+1} 次交換</div><div class="grid"><label>透析液<select data-row="${i}" data-field="product">${products.map(p=>option(p.code,p.name,product?.code)).join('')}</select></label><label>灌注量（mL）<input data-row="${i}" data-field="volume" type="number" min="500" max="${snapshot.fill}" step="100" value="${row.volume}"></label><label>留置時間（小時）<input data-row="${i}" data-field="dwell" type="number" min="0.5" max="16" step="0.1" value="${Number(row.dwell.toFixed(2))}"></label></div></div>`;});
  }else{
    html+=`<div class="grid">${input('夜間治療時間（小時）','hours',rx.hours,4,snapshot.sleep,0.5)}${input('每循環灌注量（mL）','fill',rx.fill,500,snapshot.fill,100)}${input('夜間循環次數','cycles',rx.cycles,1,12)}${select('夜間葡萄糖濃度','nightConcentration',rx.nightConcentration,[[1.5,'1.5%'],[2.5,'2.5%']])}${input('每循環灌入＋引流（分鐘）*','fillDrain',rx.fillDrain,1,90)}${input('初始引流時間（分鐘）*','initialDrain',rx.initialDrain,0,90)}${input('最後灌注時間（分鐘）*','lastFillTime',rx.lastFillTime,0,90)}${input('管路預充／額外準備量（mL）*','prime',rx.prime,0,2000,50)}${select('最後灌注／日間留置','lastKind',rx.lastKind,[['dry','日間乾腹'],['glucose','葡萄糖液'],['ico','Icodextrin 7.5%']])}${input('最後灌注量（mL）','lastVolume',rx.lastVolume,0,snapshot.fill,100)}${select('最後灌注葡萄糖濃度','lastConcentration',rx.lastConcentration,[[1.5,'1.5%'],[2.5,'2.5%']])}</div><p class="hint">時間欄位需依實際機器紀錄／院內設定輸入。循環數為規劃值；Claria 的實際顯示、四捨五入與特殊模式仍需核對。第一版提供常規完整引流循環；tidal 與額外日間手動交換需另行人工設計。</p>`;
  }
  $('prescription').innerHTML=html;
}
function refreshRx(){
  if(!rx)return;validation=PD.validateRx(rx,snapshot,assessment,CATALOG);const v=validation;$('reviewed').checked=false;
  $('rxWarnings').innerHTML=callouts(v.errors,'danger')+callouts(v.warnings);
  let dwell='',machine='';
  if(rx.mode==='CAPD')dwell=`<div class="timeline">${rx.rows.map((r,i)=>`<span style="flex:${r.dwell}">${i+1}</span>`).join('')}${v.dwell<24?`<span class="dry" style="flex:${24-v.dwell}">乾腹</span>`:''}</div><p class="hint">總留置 ${v.dwell.toFixed(1)} 小時／日；${v.dwell<24?`乾腹 ${(24-v.dwell).toFixed(1)} 小時。`:'涵蓋 24 小時。'}交換操作時間請在實際排程內核對。</p>`;
  else {const net=rx.hours*60-rx.cycles*rx.fillDrain-rx.initialDrain-rx.lastFillTime;machine=`<div class="callout">Claria 核對摘要：夜間循環灌入 ${rx.fill*rx.cycles} mL；最後灌注 ${rx.lastKind==='dry'?0:rx.lastVolume} mL；治療灌入總量 ${v.total} mL（不含預充）。${Number.isFinite(net)?`估算每循環留置 ${Math.round(net/rx.cycles)} 分鐘。`:''}日間${rx.lastKind==='dry'?'乾腹':'留置'} ${24-rx.hours} 小時。</div>`;}
  $('totals').innerHTML=`<div class="metric">每日灌入量<b>${(v.total/1000).toFixed(1)} L</b></div><div class="metric">灌入葡萄糖<b>${v.glucose.toFixed(0)} g</b></div><div class="metric">袋數合計<b>${v.bags.reduce((n,x)=>n+x.count,0)} 袋</b></div>`;
  $('bags').innerHTML=v.bags.map(x=>`<tr><td>${esc(x.product.name)}<small>${esc(x.product.code)}${x.product.lowCa?' · Ca 2.5 mEq/L':''}</small></td><td>${x.count}</td><td>${(x.used/1000).toFixed(1)} / ${(x.count*x.product.bag/1000).toFixed(1)} L</td></tr>`).join('');
  $('followup').innerHTML=dwell+machine+`<h3>追蹤與加量條件</h3><ul><li>每日記錄體重、血壓、尿量、PD 淨超濾與完成治療量。</li><li>處方變更後由團隊安排早期容量與生化追蹤；症狀或異常檢驗提前處理。</li><li>穩定後評估 24 小時尿液／透析液收集，確認實測清除。</li><li>殘餘清除下降、持續水腫、尿毒症症狀或生化控制不佳時，重新評估加量／方式調整。</li>${stage==='initial'?'<li>首次 PET 安排於開始 PD 後 6–12 週。</li>':''}</ul><p class="hint">灌入葡萄糖克數不等於吸收量或攝取熱量。Low Ca 不自動套用到 icodextrin／Nutrineal，該品項鈣濃度另核對。</p>`;
  const g=PD.goals(snapshot,assessment,rx,v.total);
  $('goalResults').innerHTML='<h3>處方量與達標檢核</h3><div class="table-wrap"><table><thead><tr><th>項目</th><th>目前結果</th><th>依據／下一步</th></tr></thead><tbody>'+g.checks.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.status)}</td><td>${esc(x.detail)}</td></tr>`).join('')+'</tbody></table></div>'+callouts(g.errors,'danger')+(g.ufGoal===null&&g.missing.length?callouts(['脫水估計需補齊：'+g.missing.join('、')]):'')+callouts(g.notes)+'<p class="hint">初始處方及新草案尚未實測，不能標示整體達標。以上實測值屬目前治療，處方改變後需再次測量。</p>';
  renderCompare();$('exportStatus').textContent='';
}
function report(){
  if(!rx||!validation)return null;
  if(validation.errors.length){$('exportStatus').textContent='處方尚有待補／不一致欄位，請先完成上方紅色提示。';return null;}
  const goalCheck=PD.goals(snapshot,assessment,rx,validation.total);if(goalCheck.errors.length){$('exportStatus').textContent='治療目標有不一致欄位，請先核對上方提示。';return null;}
  if(!$('reviewed').checked){$('exportStatus').textContent='請完成醫師核對勾選後再輸出。';return null;}
  const d=snapshot,a=assessment,v=validation,date=new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
  let lines=['腹膜透析方式評估與處方草案',`日期：${date}（台灣時間）`,isDemo?'【示範個案，非真實病人】':`個案代號：${d.patient||'未填'}`,`階段：${stageNames[stage]}`,`年齡 ${d.age} 歲；身高 ${d.height} cm；體重 ${d.weight} kg；目標體重 ${d.target||'未提供'} kg`, `尿量 ${d.urine} mL/day；容量 ${$('volume').selectedOptions[0].text}；K ${d.potassium}；HCO3 ${d.bicarb}`,`血壓 ${d.bp||'未提供'}；BUN ${d.bun||'未提供'}；Albumin ${d.albumin||'未提供'}；Ca ${d.ca||'未提供'}；P ${d.phos||'未提供'}`,`血清 Cr ${d.serumCr||'未提供'} mg/dL；eGFR ${d.egfr===''?'未提供':d.egfr} mL/min/1.73 m²；CCr ${d.ccr===''?'未提供':d.ccr} mL/min；Kru ${d.kru===''?'未提供':d.kru} mL/min`, `平均腎臟清除率：${a.kidney.mean===null?'未取得可靠完整資料':a.kidney.mean.toFixed(2)+' mL/min'}；收集品質：${d.collection}；腎功能狀態：${d.renalStability}`, stage==='initial'?'初始處方：尚無腹膜／總 Kt/V，未假定或預測此數值。':`實測總 weekly Kt/V：${a.ktv===null?'未完整提供':a.ktv.toFixed(2)}`,`症狀：${PD.symptoms(d).labels.join('、')}；嚴重度：${({mild:'輕度',moderate:'中度',severe:'重度'}[d.symptomSeverity]||'不適用')}；臨床歸因：${({likely:'可能與尿毒症相關',uncertain:'尚未確定',other:'主要為其他原因'}[d.symptomAttribution]||'不適用')}`,`優先模式：${a.mode}；草案選用：${rx.mode}`,`理由：${a.reasons.join('；')}`,a.pet?`PET ${d.petDate}；${d.petConcentration}%；D/P Cr ${a.pet.ratio.toFixed(3)}；${a.pet.label}；淨 UF ${a.pet.uf} mL`:'尚無 PET，未假定運輸型態。','', '處方：'];
  if(rx.mode==='CAPD')rx.rows.forEach((r,i)=>{const p=CATALOG.find(x=>x.code===PD.validateRx({...rx,rows:[r]},d,a,CATALOG).bags[0]?.product.code);lines.push(`第${i+1}次：${p?.name||r.kind}；灌注 ${r.volume} mL；留置 ${r.dwell.toFixed(1)} h`);});
  else {lines.push(`Baxter HomeChoice Claria：夜間 ${rx.hours} h；${rx.cycles} 循環；每循環 ${rx.fill} mL；夜間 dextrose ${rx.nightConcentration}%`,`每循環灌入＋引流 ${rx.fillDrain} min；初始引流 ${rx.initialDrain} min；最後灌注 ${rx.lastFillTime} min`,`估算每循環留置 ${Math.round((rx.hours*60-rx.cycles*rx.fillDrain-rx.initialDrain-rx.lastFillTime)/rx.cycles)} min`,`最後灌注：${rx.lastKind==='dry'?'乾腹':rx.lastKind==='ico'?'icodextrin 7.5%':`dextrose ${rx.lastConcentration}%`}；${rx.lastKind==='dry'?0:rx.lastVolume} mL；日間 ${24-rx.hours} h`,`夜間循環灌入 ${rx.fill*rx.cycles} mL；含最後灌注之治療灌入總量 ${v.total} mL；預充／額外準備 ${rx.prime} mL`);}
  if(stage!=='initial'&&adjust){lines.push('','與現行處方比較：',...diffRows(PD.currentSummary(d),PD.rxSummary(rx)).filter(x=>x.changed).map(x=>`${x.label}：${x.a} → ${x.b}`),'系統調整建議：',...adjust.changes);}
  lines.push(`葡萄糖液鈣配方：${d.calcium==='low'?'Low Ca 2.5 mEq/L':'一般配方，實際鈣濃度另核對'}`,'','用液與醫令：',...v.bags.map(x=>`${x.product.code}｜${x.product.name}｜${x.count} 袋/day`),'',`每日灌入 ${v.total} mL；灌入葡萄糖 ${v.glucose.toFixed(0)} g（非吸收量）`,...a.adjustments,...a.warnings,...v.warnings,'','追蹤：每日體重、血壓、尿量、淨超濾及完成量；處方調整後容量／生化複評；穩定後實測清除。',stage==='initial'?'首次 PET：開始 PD 後 6–12 週。':'依臨床需要再評估 PET。',`醫師補充：${$('note').value||'無'}`,'已勾選醫師核對；本草案需依實際療效調整。');
  const g=PD.goals(d,a,rx,v.total);lines.push('','治療目標與達標追蹤：',...g.checks.map(x=>x.name+'：'+x.status+'；'+x.detail),g.calculated===null?'水分收支估計未完整提供。':'水分收支估計 '+Math.round(g.calculated)+' mL/day；攝取 '+d.intake+'、尿量 '+d.urine+'、腎外淨流失 '+d.otherLoss+' mL/day；多餘水分 '+d.excessFluid+' kg／'+(Number(d.excessFluid)>0?d.correctionDays:'不需矯正')+' 天',...g.errors,...g.notes,'新草案需治療後實測確認，未宣稱整體達標。');
  if(history.length)lines.push('','處置與處方調整紀錄（新→舊）：',...[...history].reverse().slice(0,10).map(h=>`${fmtTime(h.at)}｜${stageNames[h.stage]||h.stage}｜${h.summary}${h.changes?.length?'｜'+h.changes.join('；'):''}`));
  return lines.join('\n');
}
document.querySelectorAll('[data-stage]').forEach(el=>el.addEventListener('click',()=>setStage(el.dataset.stage)));
document.querySelector('.inputs').addEventListener('input',e=>{if(e.target.id!=='fluidGoalSafe')$('fluidGoalSafe').checked=false;if(e.target.dataset.symptom){if(e.target.checked){if(e.target.dataset.symptom==='none')document.querySelectorAll('[data-symptom]').forEach(el=>{if(el!==e.target)el.checked=false;});else $('sym-none').checked=false;}symptomControls();}if(e.target.id==='start')timing();if(e.target.id!=='calculatePet'&&assessment)invalidate();if(stage==='pet'&&['dp','petIn','petOut','petConcentration','petClass','g0','g4','na0','na1'].includes(e.target.id))renderPet();(e.target.closest('.is-missing'))?.classList.remove('is-missing');progress();});
$('assessment').addEventListener('click',e=>{const k=e.target.closest('[data-focus]')?.dataset.focus;if(k)focusField(k);});
$('sectionNav').addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();document.querySelector(a.getAttribute('href'))?.scrollIntoView({behavior:'smooth',block:'start'});});
$('calcClearance').addEventListener('click',()=>{const c=PD.clearance(data());const f=(x,n=2)=>x===null?'—':x.toFixed(n);
  if(c.errors.length&&c.kru===null&&c.ccr===null){$('clearanceResult').innerHTML=callouts(c.errors);return;}
  const set=(id,v)=>{if(v!==null&&!$(id).closest('[hidden]'))$(id).value=v.toFixed(2);};set('kru',c.kru);set('ccr',c.ccr);set('renalKtv',c.renalKtv);if(stage!=='initial')set('pdKtv',c.pdKtv);
  $('clearanceResult').innerHTML=`<div class="metrics"><div class="metric">Watson V<b>${f(c.V,1)} L</b></div><div class="metric">Kru／CCr<b>${f(c.kru)}／${f(c.ccr)}</b></div><div class="metric">Kt/V 腎＋腹膜<b>${f(c.renalKtv)}＋${stage==='initial'?'—':f(c.pdKtv)}</b></div></div>`+callouts(c.errors)+'<p class="hint">已帶入可計算的欄位；仍須於「尿液收集品質」及「透析液清除收集品質」確認完整收集。</p>';
  if(assessment)invalidate();progress();});
$('calculatePet').addEventListener('click',()=>{const d=Number($('dCr').value),p=Number($('pCr').value);if(!$('dCr').value||!$('pCr').value||p<=0){$('petResults').textContent='請填入兩個 Cr 原始值，血液 Cr 必須大於 0。';return;}$('dp').value=(d/p).toFixed(3);invalidate();renderPet();});
$('evaluate').addEventListener('click',evaluate);
$('prescription').addEventListener('change',e=>{const el=e.target;if(!rx)return;
  if(el.dataset.rx){const key=el.dataset.rx;if(key==='mode'){if(snapshot[key==='mode'&&el.value==='APD'?'apdReady':'capdReady']!=='yes'){el.value=rx.mode;$('exportStatus').textContent='該方式目前不具備執行條件。';return;}if(el.value==='APD'&&!snapshot.sleep){el.value=rx.mode;$('exportStatus').textContent='請先補齊可用夜間時間，重新評估。';return;}if(stage!=='initial'&&el.value===snapshot.currentMode){adjust=PD.adjustRx(snapshot,{...assessment,mode:el.value},CATALOG);rx=adjust.rx;}else{rx=PD.initialRx(snapshot,{...assessment,mode:el.value});if(stage!=='initial')adjust={rx,changes:[`方式由 ${snapshot.currentMode} 改為 ${el.value}：依新方式模板重設，須重新訓練並核對設定。`],switched:true};}renderRx();}else if(key==='count'){const n=Number(el.value);if(!Number.isInteger(n)||n<1||n>6){el.value=rx.rows.length;return;}while(rx.rows.length<n)rx.rows.push({volume:Number(snapshot.fill),dwell:24/n,kind:'glucose',concentration:1.5,lowCa:snapshot.calcium==='low'});rx.rows.length=n;rx.rows.forEach(r=>r.dwell=24/n);renderRx();}else{rx[key]=el.tagName==='SELECT'&&['lastKind'].includes(key)?el.value:PD.num(el.value);if(key==='lastKind'){if(el.value==='dry'){rx.lastVolume=0;rx.lastFillTime=0;}else if(!rx.lastVolume)rx.lastVolume=Number(snapshot.fill);renderRx();}}}
  if(el.dataset.row){const row=rx.rows[Number(el.dataset.row)],field=el.dataset.field;if(field==='product'){const p=CATALOG.find(x=>x.code===el.value);row.kind=p.kind;row.concentration=p.concentration;row.lowCa=p.lowCa;row.productCode=p.code;}else row[field]=Number(el.value);}
  refreshRx();
});
$('note').addEventListener('input',()=>{$('reviewed').checked=false;});
$('copy').addEventListener('click',async()=>{const text=report();if(!text)return;try{await navigator.clipboard.writeText(text);$('exportStatus').textContent='已複製會診文字。';}catch{$('exportStatus').textContent='瀏覽器未允許複製，請改用下載文字。';}});
$('download').addEventListener('click',()=>{const text=report();if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='PD-consultation.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('print').addEventListener('click',()=>{const text=report();if(!text)return;$('printReport').innerHTML=`<h1>腹膜透析處方評估</h1><pre>${esc(text)}</pre>`;window.print();});
function clear(){$('clearanceResult').innerHTML='';$('prevRecord').innerHTML='';markMissing([]);document.querySelectorAll('.inputs input').forEach(el=>{if(el.type==='checkbox')el.checked=false;else el.value='';});document.querySelectorAll('.inputs select').forEach(el=>el.selectedIndex=0);$('note').value='';isDemo=false;symptomControls();setStage('initial');timing();}
$('reset').addEventListener('click',()=>{if(unsaved&&!confirm('處置紀錄尚未儲存成檔案，清空後將遺失。確定清空？'))return;clear();history=[];unsaved=false;renderHistory();$('fileStatus').hidden=true;});
$('demo').addEventListener('click',()=>{clear();isDemo=true;const vals={patient:'DEMO-01',intake:1800,otherLoss:500,excessFluid:2,correctionDays:7,dialysateCollection:'valid',age:65,height:165,weight:62,serumCr:7.8,egfr:6.5,ccr:5,kru:3,collection:'valid',renalStability:'stable',target:60,urine:600,volume:'overload',access:'healed',preference:'APD',apdReady:'yes',capdReady:'yes',sleep:8,potassium:4.6,bicarb:23,bun:55,albumin:3.5,ca:9.2,phos:4.8,renalKtv:0.6,pdKtv:1.3,fill:2000,calcium:'low',currentMode:'CAPD',uf:400,currentFill:2000,currentCycles:4,adherence:'good',petDate:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),petConcentration:'2.5',petIn:2000,petOut:2080,dp:0.86,crCorrection:'yes',g0:2200,g4:450};for(const [key,value]of Object.entries(vals))$(key).value=value;$('sym-none').checked=true;symptomControls();$('icoSafe').checked=true;setStage('pet');evaluate();if(rx&&rx.mode==='APD'){rx.fillDrain=25;rx.initialDrain=15;rx.lastFillTime=10;rx.prime=500;renderRx();refreshRx();}});
$('catalog').innerHTML='<table><thead><tr><th>模式／品項</th><th>醫令碼</th></tr></thead><tbody>'+CATALOG.map(p=>`<tr><td>${p.mode} · ${esc(p.name)}${p.lowCa?' · Ca 2.5 mEq/L':''}</td><td>${p.code}</td></tr>`).join('')+'</tbody></table>';

// ===== 處置紀錄（含時間）與紀錄檔 =====
const pad=n=>String(n).padStart(2,'0');
function nowLocal(){const t=new Date(Date.now()+8*3600000);return `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;}
function fmtTime(iso){const t=new Date(iso);return Number.isNaN(t.getTime())?String(iso):t.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderHistory(){
  $('historyCount').textContent=history.length+' 筆'+(unsaved?'・未儲存':'');
  if(!history.length){$('history').innerHTML='<p class="empty-note">尚無紀錄。處方核對後按「記錄本次處置」，即依時間保存每次處置與處方調整。</p>';return;}
  $('history').innerHTML='<ol class="timeline-list">'+history.map((h,i)=>({h,i})).reverse().map(({h,i})=>`<li><div class="tl-head"><time datetime="${esc(h.at)}">${esc(fmtTime(h.at))}</time><span class="tag">${esc(stageNames[h.stage]||h.stage)}</span>${h.demo?'<span class="tag amber">示範</span>':''}<button type="button" class="link small" data-del="${i}">刪除</button></div><div class="tl-rx">${esc(h.summary)}</div>${h.changes?.length?`<ul>${h.changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:''}<div class="tl-meta">${[h.weight&&`體重 ${h.weight} kg`,h.uf!==''&&h.uf!=null&&`淨 UF ${h.uf} mL/d`,h.ufGoal!=null&&`UF 目標 ${Math.round(h.ufGoal)}`,h.ktv!=null&&`Kt/V ${Number(h.ktv).toFixed(2)}`,h.dp&&`D/P Cr ${h.dp}${h.pet?'（'+h.pet+'）':''}`,h.volume&&({euvolemic:'容量穩定',overload:'容量過多',depleted:'容量不足'}[h.volume])].filter(Boolean).map(esc).join(' · ')}</div>${h.note?`<p class="tl-note">${esc(h.note)}</p>`:''}</li>`).join('')+'</ol>';
}
$('history').addEventListener('click',e=>{const i=e.target.closest('[data-del]')?.dataset.del;if(i===undefined)return;if(!confirm('刪除此筆紀錄？'))return;history.splice(Number(i),1);unsaved=true;renderHistory();});
$('record').addEventListener('click',()=>{
  if(!rx||!validation)return;
  if(validation.errors.length){$('exportStatus').textContent='處方尚有紅色提示未完成，無法記錄。';return;}
  if(!$('reviewed').checked){$('exportStatus').textContent='請先完成醫師核對勾選，再記錄本次處置。';return;}
  const when=$('recordTime').value||nowLocal();const at=new Date(when+':00+08:00');
  if(Number.isNaN(at.getTime())){$('exportStatus').textContent='處置時間格式不正確。';return;}
  const d=snapshot,a=assessment,g=PD.goals(d,a,rx,validation.total),summary=PD.rxSummary(rx);
  let changes=stage==='initial'?['建立初始處方（'+a.mode+' 優先）']:changeText(PD.currentSummary(d),summary);
  if(stage!=='initial'&&!changes.length)changes=['維持現行處方'];
  history.push({at:at.toISOString(),stage,mode:a.mode,summary:summary.text,rx:JSON.parse(JSON.stringify(rx)),changes,weight:d.weight,volume:d.volume,uf:stage==='initial'?null:d.uf,ufGoal:g.ufGoal,ktv:a.ktv,dp:a.pet?a.pet.ratio.toFixed(3):null,pet:a.pet?a.pet.label:null,note:$('note').value,demo:isDemo});
  history.sort((x,y)=>x.at.localeCompare(y.at));unsaved=true;renderHistory();
  $('exportStatus').textContent=`已記錄 ${fmtTime(at.toISOString())} 的處置。記得「儲存紀錄檔」。`;$('recordTime').value='';
});
function inputValues(){const v={};document.querySelectorAll('.inputs input,.inputs select').forEach(el=>{if(el.id&&el.type!=='file')v[el.id]=el.type==='checkbox'?el.checked:el.value;});return v;}
$('saveFile').addEventListener('click',()=>{
  const file={schema:'pd-workstation-record/1',app:'v1.4',savedAt:new Date().toISOString(),demo:isDemo,stage,inputs:inputValues(),history};
  const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,1)],{type:'application/json'}));const link=document.createElement('a');
  const code=($('patient').value||'record').replace(/[^\w\-]+/g,'_').slice(0,40);link.href=url;link.download=`PD-${code}-${nowLocal().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  unsaved=false;renderHistory();fileMsg(`已下載紀錄檔（${history.length} 筆處置紀錄）。檔案含臨床資料，請依院內規範保存。`);
});
function fileMsg(text,kind=''){const el=$('fileStatus');el.className='callout '+kind;el.textContent=text;el.hidden=false;}
$('loadFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  if(unsaved&&!confirm('目前有未儲存的處置紀錄，載入後將被取代。繼續？'))return;
  let file;try{file=JSON.parse(await f.text());}catch{fileMsg('無法讀取：不是有效的 JSON 紀錄檔。','danger');return;}
  if(file?.schema!=='pd-workstation-record/1'||typeof file.inputs!=='object'||!Array.isArray(file.history)){fileMsg('檔案格式不符（需為本工作站儲存的紀錄檔）。','danger');return;}
  clear();isDemo=!!file.demo;
  for(const [id,value] of Object.entries(file.inputs)){const el=$(id);if(!el||!el.closest('.inputs')||el.type==='file')continue;if(el.type==='checkbox')el.checked=value===true;else if(typeof value==='string'||typeof value==='number')el.value=String(value);}
  history=file.history.filter(h=>h&&typeof h.at==='string'&&typeof h.summary==='string').map(h=>({...h,changes:Array.isArray(h.changes)?h.changes.map(String):[]})).sort((x,y)=>x.at.localeCompare(y.at));unsaved=false;
  symptomControls();timing();renderHistory();
  const last=[...history].reverse().find(h=>h.rx&&(h.rx.mode==='CAPD'||h.rx.mode==='APD'));
  if(last){
    const r=last.rx,sm=PD.rxSummary(r);
    $('currentMode').value=r.mode;$('currentFill').value=sm.fill??'';$('currentCycles').value=sm.count??'';$('currentHours').value=r.mode==='APD'?r.hours:'';
    $('currentLast').value=sm.long==='ico'?'ico':r.mode==='APD'&&r.lastKind==='dry'?'dry':'glucose';
    const c=[1.5,2.5,4.25].includes(Number(sm.concentration))?String(sm.concentration):'1.5';$('currentConcentration').value=c;
    for(const id of ['uf','adherence'])$(id).value='';for(const id of ['infection','acute','fluidGoalSafe','icoSafe','incrementalSafe'])$(id).checked=false;
    setStage('follow');
    $('prevRecord').innerHTML=`<div class="callout"><b>前次紀錄 ${esc(fmtTime(last.at))}</b><br>${esc(last.summary)}<br><small>已帶入下方「現有處方」。檢驗與量測沿用前次數值（收集／檢驗日期：${esc($('labDate').value||'未填')}），請更新本次資料；各項確認勾選已清除。</small></div>`;
    fileMsg(`已載入紀錄檔：${history.length} 筆處置紀錄，前次處方已帶入「治療中調整」。`);
  }else{setStage(['initial','follow','pet'].includes(file.stage)?file.stage:'initial');fileMsg(`已載入紀錄檔（${history.length} 筆處置紀錄）。`);}
  progress();
});
window.addEventListener('beforeunload',e=>{if(unsaved){e.preventDefault();e.returnValue='';}});
renderHistory();progress();
