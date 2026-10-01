'use strict';
const PD = (() => {
  const types={low:'低運輸',lowAvg:'較低運輸',highAvg:'較高運輸',high:'高運輸'};
  const num=x=>x===''||x==null?null:Number(x);
  const symptomLabels={none:'無明顯症狀',appetite:'食慾下降',nausea:'噁心',vomiting:'嘔吐',fatigue:'疲倦／無力',itch:'持續或難治性搔癢',sleep:'睡眠障礙／不寧腿',cognition:'注意力／認知下降',nutrition:'非預期體重下降／營養惡化',encephalopathy:'疑似尿毒性腦病',pericarditis:'疑似尿毒性心包膜炎'};
  function symptoms(d){
    const list=Array.isArray(d.symptoms)?d.symptoms:null;
    const present=list?list.some(x=>x!=='none'):d.symptom==='yes';
    return {list:list||[],present,related:present&&d.symptomAttribution!=='other',urgent:!!list&&list.some(x=>['encephalopathy','pericarditis'].includes(x)),labels:list?list.map(x=>symptomLabels[x]||x):[present?'有症狀（未細分）':'無明顯症狀']};
  }
  function renal(d){
    const cr=num(d.serumCr),egfr=num(d.egfr),ccr=num(d.ccr),kru=num(d.kru),rktv=num(d.renalKtv);
    const valid=d.collection==='valid',stable=d.renalStability!=='changing';
    return {cr,egfr,ccr,kru,rktv,valid,stable,mean:valid&&ccr!==null&&kru!==null?(ccr+kru)/2:null,hasData:[cr,egfr,ccr,kru,rktv].some(x=>x!==null),hasBaseline:[cr,egfr,ccr,kru].some(x=>x!==null),incrementalEvidence:valid&&stable&&((kru!==null&&kru>0)||(rktv!==null&&rktv>0))};
  }
  function pet(d){
    const ratio=num(d.dp), input=num(d.petIn), output=num(d.petOut);
    const transport=ratio===null?null:ratio<0.5?'low':ratio<0.65?'lowAvg':ratio<0.82?'highAvg':'high';
    const chosen=d.petClass&&d.petClass!=='auto'?d.petClass:transport;
    const uf=input!==null&&output!==null?output-input:null;
    const standard=input===2000;
    const threshold=d.petConcentration==='4.25'?400:d.petConcentration==='2.5'?100:null;
    const g0=num(d.g0),g4=num(d.g4),na0=num(d.na0),na1=num(d.na1);
    const dip=d.petConcentration==='4.25'&&na0!==null&&na1!==null?na0-na1:null;
    return {ratio,transport:chosen,label:types[chosen]||'未判讀',uf,threshold,standard,lowUf:standard&&uf!==null&&threshold!==null&&uf<threshold,glucose:g0>0&&g4!==null?g4/g0:null,dip,lowDip:dip!==null&&dip<=5,outside:ratio!==null&&(ratio<0.34||ratio>1.03)};
  }
  function requiredFields(stage){
    const required={age:'年齡',height:'身高',weight:'體重',urine:'每日尿量',volume:'容量狀態',symptom:'尿毒症症狀',access:'導管／起始狀態',apdReady:'APD 可行性',capdReady:'CAPD 可行性',potassium:'K',bicarb:'HCO₃⁻',fill:'醫師確認可耐受灌注量',calcium:'葡萄糖液鈣配方'};
    if(stage!=='initial')Object.assign(required,{currentMode:'目前方式',uf:'每日 PD 淨超濾',currentFill:'目前灌注量',currentCycles:'目前交換／循環次數',adherence:'執行狀態'});
    if(stage==='pet')Object.assign(required,{petDate:'PET 日期',petConcentration:'PET 濃度',petIn:'PET 灌入量',petOut:'PET 引流量',dp:'4 小時 D/P Cr',crCorrection:'Cr 校正確認'});
    return required;
  }
  // Watson total body water；24 小時尿液／透析液尿素清除。尿素以 BUN（mg/dL）表示，分子分母單位一致。
  function clearance(d){
    const age=num(d.age),h=num(d.height),w=num(d.weight),bun=num(d.bun),scr=num(d.serumCr),uvol=num(d.urine),uun=num(d.uun),ucr=num(d.ucr),dvol=num(d.dialVol),dun=num(d.dun);
    const errors=[];let V=null;
    if(h===null||w===null||!['male','female'].includes(d.sex)||(d.sex==='male'&&age===null))errors.push('計算 Watson V 需性別、身高、體重（男性另需年齡）。');
    else V=d.sex==='male'?2.447-0.09516*age+0.1074*h+0.3362*w:-2.097+0.1069*h+0.2466*w;
    const pos=x=>x!==null&&Number.isFinite(x)&&x>0;
    const kru=pos(bun)&&uun!==null&&uvol!==null?uun*uvol/(bun*1440):null;
    const ccr=pos(scr)&&ucr!==null&&uvol!==null?ucr*uvol/(scr*1440):null;
    const renalKtv=V&&pos(bun)&&uun!==null&&uvol!==null?uun/bun*uvol/1000*7/V:null;
    const pdKtv=V&&pos(bun)&&dun!==null&&dvol!==null?dun/bun*dvol/1000*7/V:null;
    if(!pos(bun))errors.push('需血中 BUN（同一時段）。');
    return {V,kru,ccr,renalKtv,pdKtv,total:renalKtv!==null&&pdKtv!==null?renalKtv+pdKtv:null,errors};
  }
  function assess(d){
    let missing=[],missingKeys=[],blocks=[],warnings=[],reasons=[],adjustments=[],factors=[];
    const need=(label,key)=>{missing.push(label);if(key)missingKeys.push(key);};
    const required=requiredFields(d.stage);
    for(const [key,label] of Object.entries(required))if((d[key]===''||d[key]==null)&&!(key==='symptom'&&Array.isArray(d.symptoms)))need(label,key==='symptom'?'symptoms':key);
    const kidney=renal(d),sx=symptoms(d);
    if(Array.isArray(d.symptoms)){
      if(!d.symptoms.length)need('尿毒症症狀（可複選，無症狀請明確勾選）','symptoms');
      if(d.symptoms.includes('none')&&sx.present)blocks.push('無明顯症狀不能與其他症狀同時勾選。');
      if(d.symptoms.some(x=>!Object.hasOwn(symptomLabels,x)))blocks.push('症狀選項無效，請重新選擇。');
      if(sx.present&&!['mild','moderate','severe'].includes(d.symptomSeverity))need('整體症狀嚴重度','symptomSeverity');
      if(sx.present&&!['likely','uncertain','other'].includes(d.symptomAttribution))need('症狀臨床歸因評估','symptomAttribution');
    }
    if(sx.urgent)blocks.push('疑似尿毒性腦病或心包膜炎：需即時評估與適當透析支持，暫停常規 CAPD／APD 草案。');
    if(d.stage==='initial'&&!kidney.hasBaseline)need('初始腎功能資料：血清 Cr／eGFR／實測 CCr／Kru 至少一項','serumCr');
    if(missing.length)return {missing,missingKeys,blocks,warnings,reasons,adjustments};
    const age=num(d.age),fill=num(d.fill),k=num(d.potassium),hco=num(d.bicarb);
    if(age<18||age>120)blocks.push('本版僅適用成人慢性 PD，年齡須介於 18–120 歲。');
    if(fill<500||fill>2500)blocks.push('灌注量超出本版可用範圍 500–2500 mL，需人工處方。');
    if(d.acute||k>=6.5||hco<10)blocks.push('需即時評估的急性狀況：暫停例行慢性 PD 草案，評估急性處置與適當透析支持。');
    if(d.stage!=='initial'&&d.infection)blocks.push('疑似腹膜炎：先評估透析液、感染與治療，暫停例行處方最佳化。');
    if(d.access==='urgent')blocks.push('新置管／急起始 PD 需專屬低灌注量、仰臥與漏液監測流程；本版不自動套用常規維持處方。');
    if(d.access==='problem'||d.adherence==='drain')blocks.push('先處理導管、引流、漏液或疝氣問題，不能以增加濃度／劑量直接取代評估。');
    if(d.apdReady==='no'&&d.capdReady==='no')blocks.push('兩種模式目前皆無法執行，需建立輔助 PD／照護支持或討論其他方式。');
    if(d.stage==='pet'&&(d.crCorrection!=='yes'||d.petIssue==='yes'))blocks.push('PET 校正或試驗條件尚未確認，請先核對／重測，或切換治療中調整流程。');
    const p=d.stage==='pet'?pet(d):null;
    if(p&&(p.ratio<=0||p.ratio>1.2))blocks.push('D/P Cr 超出有效輸入範圍。');
    if(d.dose==='incremental'){
      if(!d.incrementalSafe||!kidney.incrementalEvidence)need('增量式 PD：完整定時尿實測 Kru 或腎臟 Kt/V、腎功能穩定與醫師評估確認',!kidney.incrementalEvidence?'kru':'incrementalSafe');
      if(d.volume!=='euvolemic'||symptoms(d).related||k>5.5||hco<22)blocks.push('存在容量／清除或生化控制問題，暫不產生增量式低劑量模板。');
    }
    if(blocks.length||missing.length)return {missing,missingKeys,blocks,warnings,reasons,adjustments,pet:p};
    let apd=0,capd=0;
    const factor=(label,a,c)=>{apd+=a;capd+=c;factors.push({label,apd:a,capd:c});};
    if(p){
      if(['high','highAvg'].includes(p.transport)){factor('PET '+p.label,3,0);reasons.push('PET 運輸較快：APD 較短留置可降低葡萄糖長留置後的水分再吸收風險。');}
      else {factor('PET '+p.label,0,3);reasons.push('PET 運輸較慢：優先保留較長留置以利溶質平衡；CAPD 較容易提供長留置。');}
      if(p.lowUf)warnings.push('標準 PET 淨超濾低於濃度對應閾值。先檢查機械原因、漏液、容量與膜功能；不等同必須轉 HD。');
      if(!p.standard)warnings.push('PET 灌入量非 2 L，本版不套用標準淨超濾閾值。');
      if(p.lowDip)warnings.push('4.25% PET 的 1 小時 sodium dip ≤5 mmol/L：需進一步評估低葡萄糖滲透導水能力，不能單憑此結果確診。');
      if(p.outside)warnings.push('D/P Cr 超出原始參考族群範圍，請核對檢驗與試驗流程。');
    }else reasons.push('尚無有效 PET：模式先依治療負擔、可行性、病人偏好與實測反應決定，不假設運輸型態。');
    if(d.preference==='APD'){factor('病人偏好 APD',4,0);reasons.push('病人偏好夜間 APD，以保留白天活動時間。');}
    if(d.preference==='CAPD'){factor('病人偏好 CAPD',0,4);reasons.push('病人偏好手動交換，將其納入方式選擇。');}
    if(d.lifeWork){factor('日間工作／就學／照顧需求',2,0);reasons.push('白天需工作、就學或照顧家人：APD 可減少日間交換。');}
    if(d.lifeAssisted){factor('需他人協助執行',2,0);reasons.push('需家人／照護者協助：APD 每日集中一次上下機，較易安排輔助 PD。');}
    if(d.lifeIap){factor('腹壓考量（疝氣史、多囊腎或腹壁手術）',1,0);reasons.push('有腹壓相關考量：APD 臥位留置腹壓較低，仍需個別評估。');}
    if(d.lifeNight){factor('夜間睡眠易受干擾／不宜使用機器',0,2);reasons.push('夜間睡眠或居家環境不適合機器治療，納入 CAPD 考量。');}
    if(d.currentMode==='APD')factor('延續目前 APD',1,0);
    if(d.currentMode==='CAPD')factor('延續目前 CAPD',0,1);
    const hours=num(d.sleep),fast=p&&['high','highAvg'].includes(p.transport),slow=p&&['low','lowAvg'].includes(p.transport);
    if(hours!==null&&hours<8){factor('夜間可用時間 <8 小時',0,2);warnings.push('夜間可用時間少於 8 小時：APD 留置與清除需個別設計，勿以增加循環次數取代評估。');}
    const scores={apd,capd,apdOk:d.apdReady!=='no',capdOk:d.capdReady!=='no'};
    if(d.apdReady==='no')apd=-100;
    if(d.capdReady==='no')capd=-100;
    let mode=apd>capd?'APD':'CAPD';
    if(d.apdReady==='no')mode='CAPD';if(d.capdReady==='no')mode='APD';
    if(mode==='APD'&&(hours===null||hours<4||hours>14))need('APD 可用夜間時間（4–14 小時）','sleep');
    if(sx.present){
      reasons.push('症狀：'+sx.labels.join('、')+'；嚴重度 '+({mild:'輕度',moderate:'中度',severe:'重度'}[d.symptomSeverity]||'未細分')+'。症狀不單獨決定 CAPD／APD。');
      if(d.stage==='initial')adjustments.push(sx.related?'初始有可能與尿毒症相關的症狀：整合起始時機、腎功能、容量與生化資料評估清除需求；起始後早期複評症狀與攝食，不先假定 Kt/V 或自動增加循環。':'症狀已評估主要為其他原因：處理該病因，並追蹤透析後症狀變化。');
      if(d.symptomAttribution==='uncertain')warnings.push('症狀歸因尚未確定：評估貧血、藥物、感染、睡眠與營養等其他原因，不直接視為透析清除不足。');
    }else if(d.stage==='initial')reasons.push('已確認無明顯尿毒症症狀；起始需求仍整合容量、生化、腎功能與病人偏好。');
    if(d.adherence==='missed')adjustments.push('先改善漏做／中斷原因與實際完成量，再決定是否增加處方。');
    if(d.volume==='overload')adjustments.push('容量過多：核對鹽水攝取、目標體重、尿量與每日淨超濾；評估短留置／長留置用液，避免只靠長期提高葡萄糖濃度。');
    if(d.volume==='depleted'){warnings.push('疑似容量不足：先重新評估目標體重、攝取及用藥，不自動提高滲透濃度。');adjustments.push('液體濃度以 1.5% 起點，醫師核對是否須減少超濾。');}
    if(symptoms(d).related||k>5.5||hco<22)adjustments.push(d.stage==='initial'?'依症狀與生化狀態確認足夠的起始清除需求；常規模板須依起始後療效調整。':'清除／生化控制需改善：核對執行、收集、營養與用藥，評估增加交換量或時間。');
    const r=num(d.renalKtv),q=num(d.pdKtv),ktv=d.stage!=='initial'&&r!==null&&q!==null?r+q:null;
    if(kidney.mean!==null)reasons.push(`完整定時尿平均腎臟清除率（CCr＋Kru）/2＝${kidney.mean.toFixed(2)} mL/min，納入殘餘腎功能與劑量評估。`);
    else if(kidney.hasData)reasons.push('已納入腎功能資料；Cr／eGFR 作為初始背景，實測尿液清除率用於殘餘清除評估。腎功能數值本身不決定 CAPD 或 APD。');
    if(kidney.egfr!==null)warnings.push('eGFR 為估計且依 1.73 m² 校正，不當作實測 Kru／CCr，也不直接換算腎臟 Kt/V。透析病人或非穩定腎功能時需審慎解讀。');
    if(kidney.ccr!==null&&kidney.kru===null)warnings.push('單獨 CCr 可能因肌酐小管分泌高估殘餘腎功能，建議補齊尿素清除率；不能僅據此減少 PD 劑量。');
    if((kidney.ccr!==null||kidney.kru!==null||kidney.rktv!==null)&&!kidney.valid)warnings.push('定時尿液收集品質未確認，實測清除資料暫不作增量式 PD 依據。');
    if(!kidney.stable)warnings.push('腎功能處於變動中：先評估急性因素與趨勢，不依單次 Cr／eGFR 降低透析劑量。');
    if(ktv!==null&&ktv<1.7)warnings.push('實測總 weekly Kt/V <1.7：需再評估清除及收集品質；不以此單一數字決定加量。');
    if(d.dose==='standard'&&num(d.urine)>=500&&d.volume==='euvolemic'&&!sx.present)warnings.push('仍有尿量且臨床穩定，可評估增量式 PD；需先取得殘餘清除率，尿量本身不夠。');
    if(d.calcium==='low')warnings.push('Low Ca 已設定 2.5 mEq/L；須整合 Ca、P、PTH、鈣劑與維生素 D，低鈣血症時重新評估配方。');
    const alternate=mode==='APD'?'CAPD':'APD', altReady=d[alternate==='APD'?'apdReady':'capdReady']==='yes';
    reasons.push(mode==='APD'?'APD 可行，依 PET 與偏好排列為優先方式；具體劑量需以實測療效調整。':'CAPD 可行，依較長留置、偏好或既有模式排列為優先方式。');
    if(mode==='APD'&&slow)warnings.push('較慢運輸者採 APD：避免過多短循環，保留足夠夜間留置並評估日間交換。');
    if(mode==='CAPD'&&fast)warnings.push('較快運輸者採 CAPD：避免葡萄糖液過長留置，考慮縮短交換或以 icodextrin 作長留置。');
    return {missing,missingKeys,blocks,warnings,reasons,adjustments,factors,scores,pet:p,kidney,mode,alternate:altReady?alternate:null,ktv,bsa:Math.sqrt(num(d.height)*num(d.weight)/3600),fast,slow};
  }
  function initialRx(d,a){
    const incremental=d.dose==='incremental',fill=num(d.fill),hours=num(d.sleep)||8;
    const concentration=d.volume==='overload'?2.5:1.5;
    const long=d.longSolution==='auto'?((a.fast||d.volume==='overload')?'ico':'glucose'):d.longSolution;
    const rx={mode:a.mode,fill,calcium:d.calcium,hours:Math.min(hours,a.slow?10:8),cycles:incremental?3:a.fast?5:a.slow?3:4,lastVolume:incremental&&long!=='ico'?0:fill,lastKind:incremental&&long!=='ico'?'dry':long,lastConcentration:concentration,nightConcentration:concentration,prime:null,rows:[]};
    if(a.mode==='CAPD'){
      const n=incremental?3:a.fast?5:4;
      const useIco=long==='ico';
      for(let i=0;i<n;i++)rx.rows.push({volume:fill,dwell:useIco?(i===n-1?8:16/(n-1)):incremental?6:24/n,kind:i===n-1&&useIco?'ico':'glucose',concentration,lowCa:d.calcium==='low'});
    } else if(long==='dry'){rx.lastVolume=0;rx.lastKind='dry';}
    return rx;
  }
  // 治療中：以現行處方為起點，一次只調整一個主要項目（容量一項、清除一項）。
  function adjustRx(d,a,catalog){
    const mode=d.currentMode,tol=num(d.fill),changes=[],lowCa=d.calcium==='low';
    if(a.mode!==mode){const rx=initialRx(d,a);changes.push(`方式由 ${mode} 改為 ${a.mode}：依新方式模板重設，須重新訓練並核對設定。`);return {rx,changes,switched:true};}
    const curFill=num(d.currentFill),n=Math.round(num(d.currentCycles)),curConc=Number(d.currentConcentration)||1.5,last=d.currentLast||'dry';
    let fill=Math.min(curFill,tol);
    if(curFill>tol)changes.push(`灌注量 ${curFill}→${tol} mL：不超過本次確認可耐受量。`);
    const has=(conc,vol)=>catalog.some(x=>x.mode===mode&&x.kind==='glucose'&&x.concentration===conc&&x.lowCa===lowCa&&x.bag>=vol);
    let conc=curConc;
    if(!has(conc,fill)){conc=has(2.5,fill)?2.5:1.5;changes.push(`目前 ${curConc}% 在所選鈣配方／容量無院內對應品項，草案暫以 ${conc}%，請人工核對。`);}
    const sleep=num(d.sleep),curHours=num(d.currentHours);
    let rx;
    if(mode==='CAPD'){
      const count=Math.min(Math.max(n,1),6);
      rx={mode,fill,calcium:d.calcium,rows:Array.from({length:count},()=>({volume:fill,dwell:24/count,kind:'glucose',concentration:conc,lowCa})),hours:null,cycles:null,lastKind:null};
      if(last==='ico'&&count>1)setCapdIco(rx);
    }else{
      let hours=curHours??Math.min(sleep||8,8);
      if(sleep!==null&&hours>sleep){changes.push(`APD 時數 ${hours}→${sleep} 小時：不超過病人可用夜間時間。`);hours=sleep;}
      rx={mode,fill,calcium:d.calcium,hours,cycles:Math.min(Math.max(n,1),12),nightConcentration:conc,lastKind:last,lastVolume:last==='dry'?0:fill,lastConcentration:conc,prime:null,rows:[]};
    }
    const g=goals(d,a,{mode,rows:rx.rows,cycles:rx.cycles,hours:rx.hours},0);
    const ufShort=g.confirmed&&g.actual!==null&&g.actual<g.ufGoal;
    const ufProblem=d.volume==='overload'||ufShort;
    const clearProblem=(g.ktvReliable&&g.measured<g.target)||symptoms(d).related||num(d.potassium)>5.5||num(d.bicarb)<22;
    const usesIco=mode==='CAPD'?rx.rows.some(r=>r.kind==='ico'):rx.lastKind==='ico';
    if(d.adherence==='missed'){changes.push('有漏做／中斷：先改善實際執行與完成量，本草案不自動加量。');return {rx,changes,switched:false};}
    if(d.volume==='depleted'){
      if(conc>1.5){setConc(rx,1.5);changes.push(`疑似容量不足：葡萄糖濃度 ${conc}%→1.5%，並重新評估目標體重。`);}
      else changes.push('疑似容量不足：不增加超濾，先重新評估目標體重、攝取與用藥。');
    }else if(ufProblem||(a.fast&&!usesIco&&(mode==='CAPD'||rx.lastKind==='glucose'))){
      const why=ufShort?`淨 UF 低於目標 ${Math.round(g.ufGoal-g.actual)} mL/day`:ufProblem?'容量過多':'較快運輸且長留置為葡萄糖液';
      const canIco=!usesIco&&(mode==='CAPD'?rx.rows.length>1:true);
      if(canIco&&d.icoSafe){
        if(mode==='CAPD'){setCapdIco(rx);changes.push(`${why}：夜間長留置改為 icodextrin 7.5%（每日一次）。`);}
        else {const from=rx.lastKind==='dry'?'日間乾腹':'日間葡萄糖液';rx.lastKind='ico';rx.lastVolume=fill;changes.push(`${why}：${from}改為 icodextrin 7.5% 日間長留置。`);}
      }else if(canIco){changes.push(`${why}：建議評估 icodextrin 長留置；尚未勾選適用性確認，草案未自動帶入。`);}
      else if(conc<2.5&&has(2.5,fill)){
        if(mode==='CAPD'){const r=rx.rows.find(x=>x.kind==='glucose');r.concentration=2.5;changes.push(`${why}：第 1 次交換 ${conc}%→2.5%，其餘維持；追蹤葡萄糖暴露。`);}
        else {rx.nightConcentration=2.5;if(rx.lastKind==='glucose')rx.lastConcentration=2.5;changes.push(`${why}：夜間濃度 ${conc}%→2.5%；追蹤葡萄糖暴露。`);}
      }else changes.push(`${why}：已使用 icodextrin／較高濃度，先核對鹽水攝取、殘餘腎功能、導管引流與膜功能，不再自動提高濃度。`);
    }
    if(clearProblem&&d.volume!=='depleted'){
      const why=g.ktvReliable&&g.measured<g.target?`實測總 Kt/V ${g.measured.toFixed(2)} 低於 ${g.target}`:'症狀／生化顯示清除可能不足';
      if(fill<tol){const old=fill;setFill(rx,tol);changes.push(`${why}：灌注量 ${old}→${tol} mL（醫師確認可耐受量）。`);}
      else if(mode==='CAPD'&&rx.rows.length<5){const ico=rx.rows.some(r=>r.kind==='ico');rx.rows.push({volume:fill,dwell:0,kind:'glucose',concentration:conc,lowCa});if(ico)setCapdIco(rx);else rx.rows.forEach(r=>r.dwell=24/rx.rows.length);changes.push(`${why}：CAPD 交換 ${rx.rows.length-1}→${rx.rows.length} 次／日。`);}
      else if(mode==='APD'&&rx.lastKind==='dry'){rx.lastKind='glucose';rx.lastVolume=fill;rx.lastConcentration=rx.nightConcentration;changes.push(`${why}：日間乾腹改為葡萄糖液日間留置（wet day）。`);}
      else if(mode==='APD'&&sleep!==null&&rx.hours<sleep){const old=rx.hours;rx.hours=Math.min(sleep,old+1);changes.push(`${why}：APD 時數 ${old}→${rx.hours} 小時。`);}
      else if(mode==='APD'&&rx.cycles<8&&!a.slow){rx.cycles+=1;changes.push(`${why}：夜間循環 ${rx.cycles-1}→${rx.cycles} 次；核對每循環留置時間。`);}
      else changes.push(`${why}：現行可耐受劑量已達本版上限，需人工評估加日間交換、改變方式或其他治療。`);
    }
    if(!changes.length)changes.push('目前資料未顯示需調整：維持現行處方，持續追蹤容量、症狀與實測清除。');
    return {rx,changes,switched:false};
  }
  function setConc(rx,c){if(rx.mode==='CAPD')rx.rows.forEach(r=>{if(r.kind==='glucose')r.concentration=c;});else{rx.nightConcentration=c;if(rx.lastKind==='glucose')rx.lastConcentration=c;}}
  function setFill(rx,v){rx.fill=v;if(rx.mode==='CAPD')rx.rows.forEach(r=>r.volume=v);else if(rx.lastKind!=='dry')rx.lastVolume=v;}
  function setCapdIco(rx){const n=rx.rows.length;rx.rows.forEach((r,i)=>{if(i===n-1){r.kind='ico';r.concentration=7.5;r.dwell=8;delete r.productCode;}else{if(r.kind==='ico'){r.kind='glucose';r.concentration=1.5;}r.dwell=16/(n-1);}});}
  // 處方摘要：供紀錄與比較，不含醫令碼。
  function rxSummary(rx){
    if(!rx)return null;
    if(rx.mode==='CAPD'){const g=rx.rows.filter(r=>r.kind==='glucose').map(r=>r.concentration);return {mode:'CAPD',fill:rx.rows[0]?.volume??null,count:rx.rows.length,hours:null,concentration:g.length?Math.max(...g):null,long:rx.rows.some(r=>r.kind==='ico')?'ico':rx.rows.some(r=>r.kind==='aa')?'aa':'glucose',text:`CAPD ${rx.rows.length} 次／日：`+rx.rows.map(r=>`${r.volume}mL ${r.kind==='ico'?'Icodextrin':r.kind==='aa'?'Nutrineal':r.concentration+'%'} ${Number(r.dwell.toFixed(1))}h`).join('、')};}
    return {mode:'APD',fill:rx.fill,count:rx.cycles,hours:rx.hours,concentration:rx.nightConcentration,long:rx.lastKind,text:`APD ${rx.hours}h × ${rx.cycles} 循環 × ${rx.fill}mL ${rx.nightConcentration}%；日間${rx.lastKind==='dry'?'乾腹':rx.lastKind==='ico'?` Icodextrin ${rx.lastVolume}mL`:` ${rx.lastConcentration}% ${rx.lastVolume}mL`}`};
  }
  function currentSummary(d){
    if(!d.currentMode)return null;const fill=num(d.currentFill),n=num(d.currentCycles),c=Number(d.currentConcentration)||null;
    return {mode:d.currentMode,fill,count:n,hours:d.currentMode==='APD'?num(d.currentHours):null,concentration:c,long:d.currentMode==='CAPD'&&d.currentLast!=='ico'?'glucose':d.currentLast||'dry'};
  }
  function goals(d,a,rx,total){
    const intake=num(d.intake),urine=num(d.urine),loss=num(d.otherLoss),excess=num(d.excessFluid),days=num(d.correctionDays),manual=num(d.manualUfGoal);
    const errors=[],missing=[];
    for(const [value,limit,label] of [[intake,10000,'液體攝取'],[urine,10000,'尿量'],[loss,5000,'腎外淨流失'],[excess,20,'多餘水分'],[manual,6000,'指定 UF 目標']])if(value!==null&&(!Number.isFinite(value)||value<0||value>limit))errors.push(label+'超出有效範圍。');
    if(excess!==null&&excess>0&&(days===null||!Number.isInteger(days)||days<1||days>60))missing.push('容量矯正天數（1–60 天整數）');
    if(excess!==null&&excess>0&&d.volume!=='overload')errors.push('多餘水分大於 0 與容量評估不一致，請先重新核對。');
    if(intake===null)missing.push('每日總液體攝取');if(loss===null)missing.push('腎外淨水分流失估計');if(excess===null)missing.push('醫師確認多餘水分（無則填 0）');
    const calculated=errors.length===0&&missing.length===0&&urine!==null?intake-urine-loss+(excess>0?excess*1000/days:0):null;
    let ufGoal=errors.length?null:manual!==null?manual:calculated===null?null:Math.max(0,calculated);
    if(ufGoal!==null&&ufGoal>6000){ufGoal=null;errors.push('估計 UF 超出本工具 6000 mL/day 範圍，需人工評估，勿自動採用。');}

    if(d.volume==='depleted'){ufGoal=null;errors.push('容量不足：暫不提供自動脫水目標，先評估補液、目標體重及用藥。');}
    const confirmed=ufGoal!==null&&!!d.fluidGoalSafe,actual=d.stage==='initial'?null:num(d.uf);
    const target=num(d.ktvGoal)||1.7,measured=a.ktv,ktvReliable=d.stage!=='initial'&&measured!==null&&d.collection==='valid'&&d.dialysateCollection==='valid';
    const notes=['目標不是此處方的預測效果，需用實測資料確認。'];
    if(calculated!==null&&calculated<0)notes.push('水分收支估計為負值：先評估容量不足或攝取需求；0 mL 並非可自動採用的乾腹處方。');
    if(manual!==null&&calculated!==null&&Math.abs(manual-Math.max(0,calculated))>100)notes.push('醫師指定目標與收支估計不同，請於醫師補充記錄理由。');
    if(actual!==null&&confirmed&&actual<ufGoal)notes.push('淨 UF 低於本次目標 '+Math.round(ufGoal-actual)+' mL/day：核對實際完成量、攝取與鹽分、引流／漏液；依 PET 與實測反應調整留置、用液或日間交換。');
    if(actual!==null&&confirmed&&actual>=ufGoal&&d.volume!=='euvolemic')notes.push('UF 數值達目標，但容量尚未穩定，不能判為整體達標。');
    if(ktvReliable&&measured<target)notes.push('實測總 Kt/V 低於檢核參考：先核對完整收集與執行，再評估增加可耐受總交換量、有效留置或日間交換；不按 Kt/V 比例直接放大劑量。');
    if(symptoms(d).related)notes.push('仍有可能與尿毒症相關的症狀：即使 Kt/V 達參考值仍需評估，症狀改善才是臨床追蹤目標之一。');
    return {total,calculated,ufGoal,confirmed,actual,target,measured,ktvReliable,errors,missing,notes,checks:[
      {name:'每日透析液處方量',status:(total/1000).toFixed(1)+' L/day',detail:rx.mode==='CAPD'?rx.rows.length+' 次交換／日':rx.cycles+' 循環／夜，'+rx.hours+' 小時；含最後灌注'},
      {name:'淨 UF 目標',status:ufGoal===null?'待補齊／重新評估':Math.round(ufGoal)+' mL/day'+(confirmed?'（已確認目標）':'（待醫師確認）'),detail:manual!==null?'醫師指定':calculated!==null?'水分收支估計':'請補資料或指定個別目標'},
      {name:'實測淨 UF 檢核',status:actual===null?'治療後才能確認':!confirmed?'待確認追蹤目標':actual>=ufGoal?'數值達目標':'未達目標',detail:actual===null?'初始不預測 UF':actual+' mL/day；容量狀態另核對'},
      {name:'實測總 weekly Kt/V',status:d.stage==='initial'?'治療後才能確認':!ktvReliable?'待可靠完整收集':measured>=target?'達清除參考':'低於清除參考',detail:'參考 '+target+'；'+(measured===null?'未提供實測值':'實測 '+measured.toFixed(2))+'；不是唯一充分性標準'},
      {name:'容量狀態',status:d.volume==='euvolemic'?'目前穩定':'需改善／重新評估',detail:'依水腫、體重與血壓持續追蹤'},
      {name:'症狀',status:symptoms(d).related?'需鑑別與改善':symptoms(d).present?'追蹤其他原因':'無明顯症狀',detail:'追蹤攝食、活動能力與營養'},
      {name:'生化檢核',status:Number(d.potassium)>=3.5&&Number(d.potassium)<=5.5&&Number(d.bicarb)>=22&&Number(d.bicarb)<=29?'K／HCO₃⁻ 參考範圍內':'K／HCO₃⁻ 需評估',detail:'K 3.5–5.5、HCO₃⁻ 22–29 為本工具追蹤參考；P、營養及其他因素另評估'}
    ]};
  }
  function chooseProduct(catalog,mode,row){
    const selected=catalog.find(x=>x.code===row.productCode&&x.mode===mode&&x.kind===row.kind&&x.bag>=row.volume&&(row.kind!=='glucose'||(x.concentration===Number(row.concentration)&&x.lowCa===row.lowCa)));
    if(selected)return selected;
    return catalog.filter(x=>x.mode===mode&&x.kind===row.kind&&(row.kind!=='glucose'||(x.concentration===Number(row.concentration)&&x.lowCa===row.lowCa))&&x.bag>=row.volume).sort((a,b)=>a.bag-b.bag)[0];
  }
  function validateRx(rx,d,a,catalog){
    const errors=[],warnings=[],bags=new Map(); let total=0,glucose=0,aa=0,dwell=0,icoCount=0;
    function add(product,count,used){if(!product){errors.push('處方中有院內沒有的配方／容量組合。');return;}const prev=bags.get(product.code)||{product,count:0,used:0};prev.count+=count;prev.used+=used;bags.set(product.code,prev);}
    const limit=Number(d.fill);
    function volume(v){if(!Number.isFinite(v)||v<500||v>limit)errors.push('每次灌注量須為 500 mL 以上，且不得超過醫師確認可耐受量。');}
    function solution(kind,vol,conc){if(kind==='glucose')glucose+=vol*conc/100;if(kind==='aa')aa+=vol*0.011;}
    if(rx.mode==='CAPD'){
      if(rx.rows.length<1||rx.rows.length>6)errors.push('CAPD 交換次數超出本版範圍。');
      for(const row of rx.rows){volume(row.volume);if(!Number.isFinite(row.dwell)||row.dwell<=0)errors.push('留置時間須大於 0。');dwell+=row.dwell;total+=row.volume;solution(row.kind,row.volume,row.concentration);const product=chooseProduct(catalog,'CAPD',row);add(product,1,row.volume);if(row.kind==='ico'){icoCount++;if(row.dwell<6||row.dwell>12)errors.push('CAPD icodextrin 長留置請設定 6–12 小時。');}if(row.kind==='aa'&&(Number(d.bicarb)<22||Number(d.potassium)<3||symptoms(d).related||num(d.bun)===null||Number(d.bun)>106.4))errors.push('Nutrineal 須核對 BUN、代謝性酸中毒、尿毒症症狀及低血鉀；目前資料不適合產生此草案。');if(row.kind==='aa')warnings.push('Nutrineal：2 L 內含 22 g 胺基酸，非等同全數吸收。確認營養需求、餐食熱量、肝功能、過敏及胺基酸代謝禁忌；本版不自動加入。');}
      if(dwell>24.01)errors.push('CAPD 各次留置時間合計超過 24 小時。');
      if(dwell<23.99&&d.dose!=='incremental')errors.push('常規 CAPD 留置合計須為 24 小時；有計畫乾腹時請採增量式並完成確認。');
      if(rx.rows.filter(x=>x.kind==='aa').length>1)errors.push('本版 Nutrineal 僅允許每日一次，額外使用需人工評估。');
    }else{
      volume(rx.fill);if(!Number.isInteger(rx.cycles)||rx.cycles<1||rx.cycles>12)errors.push('APD 循環次數須為 1–12 的整數。');
      if(!Number.isFinite(rx.hours)||rx.hours<4||rx.hours>Number(d.sleep))errors.push('APD 時數須介於 4 小時與病人可用夜間時間之間。');
      if(!Number.isFinite(rx.prime)||rx.prime<0||rx.prime>2000)errors.push('請填入管路預充／額外準備量（mL），依實際機器耗材確認。');
      if(!Number.isFinite(rx.fillDrain)||rx.fillDrain<=0||rx.fillDrain>90)errors.push('請填入每循環灌入＋引流時間（分鐘）。');
      if(!Number.isFinite(rx.initialDrain)||rx.initialDrain<0||rx.initialDrain>90||!Number.isFinite(rx.lastFillTime)||rx.lastFillTime<0||rx.lastFillTime>90)errors.push('請填入初始引流與最後灌注時間（分鐘）；無最後灌注時填 0。');
      const netMinutes=rx.hours*60-rx.cycles*rx.fillDrain-rx.initialDrain-rx.lastFillTime;
      if(netMinutes<=0)errors.push('灌入／引流與初始／最後灌注占滿治療時間，無有效留置。');
      else if(netMinutes/rx.cycles<60)warnings.push('估算每循環留置少於 60 分鐘，需核對溶質清除、鈉移除與實際機器紀錄。');
      const night=rx.fill*rx.cycles; total=night;solution('glucose',night,rx.nightConcentration);
      const sharedLast=rx.lastKind==='glucose'&&Number(rx.lastConcentration)===Number(rx.nightConcentration);
      const planned=night+(sharedLast?rx.lastVolume:0);
      const products=catalog.filter(x=>x.mode==='APD'&&x.kind==='glucose'&&x.concentration===Number(rx.nightConcentration)&&x.lowCa===(d.calcium==='low')).sort((a,b)=>b.bag-a.bag);
      if(products.length){const needed=planned+(Number.isFinite(rx.prime)?rx.prime:0);let best=null;const small=products.find(x=>x.bag===2500),big=products.find(x=>x.bag===5000);for(let b=0;b<=Math.ceil(needed/5000)+1;b++)for(let s=0;s<=(small?Math.ceil(needed/2500)+1:0);s++){const supply=(big?b*5000:0)+(small?s*2500:0);if(supply>=needed&&(!best||supply<best.supply||(supply===best.supply&&b+s<best.b+best.s)))best={b,s,supply};}if(best){if(best.b)add(big,best.b,Math.min(planned,best.b*5000));if(best.s)add(small,best.s,Math.max(0,planned-best.b*5000));}else errors.push('無可用 APD 夜間袋裝組合。');}else errors.push('院內沒有選定 APD 夜間濃度／鈣配方。');
      if(rx.lastKind!=='dry'){
        volume(rx.lastVolume);total+=rx.lastVolume;solution(rx.lastKind,rx.lastVolume,rx.lastConcentration);
        if(!sharedLast){const product=chooseProduct(catalog,'APD',{kind:rx.lastKind,volume:rx.lastVolume,concentration:rx.lastConcentration,lowCa:d.calcium==='low'});add(product,1,rx.lastVolume);}
        else warnings.push('最後灌注與夜間液相同：袋數按合併供應量估算，實機須確認最後灌注可使用該來源。');
        if(rx.lastKind==='ico'){icoCount++;if(24-rx.hours<14||24-rx.hours>16)errors.push('本版 APD icodextrin 日間長留置以 14–16 小時安排；超出時需另設日間交換／人工處方。');}
        if(rx.lastKind==='glucose'&&a.fast)warnings.push('較快運輸者日間長留置葡萄糖液可能造成再吸收，需評估 icodextrin 或日間交換。');
      }
    }
    if(icoCount>1)errors.push('Icodextrin 本版限每 24 小時一次長留置。');
    if(icoCount&&!d.icoSafe)errors.push('請確認 icodextrin 適用性與血糖機相容性後再完成處方。');
    if(icoCount)warnings.push('Icodextrin：使用葡萄糖專一且相容的血糖檢測方法；避免 maltose 干擾造成假性高血糖與錯誤胰島素治療。');
    if(a.fast&&rx.mode==='CAPD'&&rx.rows.some(x=>x.kind==='glucose'&&x.dwell>6))warnings.push('較快運輸者有 >6 小時葡萄糖留置，需以實測超濾評估再吸收。');
    if(d.volume==='depleted'&&((rx.mode==='APD'&&rx.nightConcentration>1.5)||rx.rows.some(x=>x.kind==='glucose'&&x.concentration>1.5)))warnings.push('容量不足狀態仍使用較高葡萄糖濃度，需重新評估。');
    return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],bags:[...bags.values()],total,glucose,aa,dwell,icoCount};
  }
  return {num,goals,symptoms,symptomLabels,renal,pet,assess,initialRx,adjustRx,rxSummary,currentSummary,validateRx,chooseProduct,types,requiredFields,clearance};
})();
if(typeof module!=='undefined')module.exports=PD;
