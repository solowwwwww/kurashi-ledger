import {categories,methods,initial,today,cycle,shift,budget,summarize,weeks,yen,validDate,sections,sectionTotal,livingBreakdown,weeklyAllocation,updateWeeklyBudget} from './ledger.mjs'
import {openLedger,access} from './storage.mjs'
import {exportCSV,previewCSV,exportBackup,mergeBackup,readBackup} from './interchange.mjs'

const app=document.querySelector('#app')
const nav=document.querySelector('#nav')
const dialog=document.querySelector('#editor')
const notice=document.querySelector('#notice')
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;")
const button=(label,action,id='',style='',aria='')=>`<button type="button" class="${style}" ${aria?`aria-label="${esc(aria)}"`:''} data-action="${action}" data-id="${esc(id)}">${label}</button>`
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`
const select=(name,values,selected)=>`<select name="${name}">${values.map(([value,label])=>option(value,label,selected)).join('')}</select>`
const opts=values=>values.map(value=>[value,value])
const dateLabel=d=>d.slice(5).replace('-','月')+'日'
const dateRange=(start,end)=>`${dateLabel(start)} – ${dateLabel(end)}`
const plannedStatus={planned:'待付款',partial:'部分付款',paid:'已付清',cancelled:'已取消'}
const fmtDate=d=>d.replaceAll('-','.')
const getBudget=(data,start)=>data.budgets.find(b=>b.startDate===start)
let db,data,tab='home',selected=cycle(today())
let weekStart=''
let route={ledger:true,tab:'home',weekStart:'',depth:0,key:crypto.randomUUID()}
let movingBack=false
const scrollPositions=new Map()
const opened=new Map()
const disclosure=(id,heading,body,defaultOpen=false)=> {
  const key=JSON.stringify([selected,id])
  return `<details class="ledger-disclosure" data-disclosure="${esc(key)}" ${(opened.get(key)??defaultOpen)?'open':''}><summary>${heading}</summary>${body}</details>`
}
let filters={from:'',to:'',category:'',paymentMethod:''}
let submitHandler
let busy=false
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('kurashi-ledger'):null

function message(text='',error=false) {
  notice.textContent=text
  notice.hidden=!text
  notice.dataset.error=String(error)
}
function selectedBudget() {return getBudget(data,selected)}
function ordered(rows) {
  return [...rows].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt??'').localeCompare(a.createdAt??'')||b.id.localeCompare(a.id))
}
function transactionRows(rows) {
  return rows.length?rows.map(t=>`<div class="row"><div><strong>${esc(t.description|| (t.type==='transfer'?'转账':t.category))}</strong><small>${fmtDate(t.date)} · ${esc(t.paymentMethod)} · ${t.type==='transfer'?'转账':esc(t.category)}</small></div>
    ${button((t.type==='expense'?'−':'')+yen(t.amount),'transaction',t.id,'money')}</div>`).join(''):'<p class="empty">暂无交易</p>'
}
function period() {
  const b=budget(selected)
  return `<div class="period">
    ${button('上一期','period',-1)}
    <div><strong>${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}</strong><small style="display:block">工资账期</small></div>
    ${button('下一期','period',1)}
  </div>`
}
function progress(label,actual,target,description) {
  const percent=target>0?Math.round(actual/target*100):null
  return `<div class="progress-status"><span>${description} <strong>${yen(actual)}</strong>${target===undefined?'':' / '+yen(target)}</span><strong>${percent===null?'—':percent.toLocaleString('zh-CN')+'%'}</strong></div>
  ${percent===null?'<p class="muted">未设置目标</p>':`<progress aria-label="${label}" max="100" value="${Math.min(100,percent)}"></progress>`}`
}
const spendingColors = {
  餐饮:'#22A06B', 交通:'#4B8AE8', 娱乐:'#9564D4', 家居:'#E8A44B',
  购物:'#E879A5', 健身:'#36B8B0', 其他:'#64748B'
}
const reservedOutline = '<svg class="reserve-outline" aria-hidden="true"><path fill="none" stroke="#8B949E" stroke-width="2" stroke-dasharray="6 4"/></svg>'
const outlineObserver = new ResizeObserver(entries=>{
  for(const {target,contentRect:{width:w,height:h}} of entries) {
    const path=target.querySelector('path')
    if(w<4) {
      path.setAttribute('stroke-width',Math.min(2,w))
      path.setAttribute('d',`M ${w/2} 1 V ${h-1}`)
      continue
    }
    const r=Math.min(7,w-2,(h-2)/2)
    path.setAttribute('stroke-width','2')
    path.setAttribute('d',`M 1 1 H ${w-1-r} Q ${w-1} 1 ${w-1} ${1+r} V ${h-1-r} Q ${w-1} ${h-1} ${w-1-r} ${h-1} H 1 Z`)
  }
})
function livingProgress(b,totals) {
  const {items,over}=livingBreakdown(b.totalAmount,totals)
  const label=item=>item.kind==='spent'?(item.category==='家居'?'日用品':item.category):item.kind==='available'?'未分配可用':'未支付预留'
  const color=item=>item.kind==='spent'?`--segment-color:${spendingColors[item.category]};`:''
  return `<div class="living-progress">
    <div class="living-track ${b.totalAmount?'':'living-track-empty'}" aria-hidden="true">
      ${items.filter(item=>item.width>0).map(item=>`<span class="segment ${item.kind}" style="${color(item)}width:${item.width}%">${item.kind==='reserved'?reservedOutline:''}</span>`).join('')}
    </div>
    <ul class="living-legend" aria-label="生活费预算构成">
      ${items.map(item=>`<li><span class="legend-mark ${item.kind}" style="${color(item)}" aria-hidden="true">${item.kind==='reserved'?reservedOutline:''}</span>
      <span>${label(item)}</span><strong>${yen(item.amount)}</strong><span class="legend-percent">${item.percent===null?'—':item.percent.toFixed(2)+'%'}</span></li>`).join('')}
    </ul>
    ${over?`<p class="error">超支 ${yen(over)}</p>`:''}
  </div>`
}
function overviewCard(id,label,content) {
  return `<article class="panel overview-card"><h3>${label}</h3>${content}
    <button type="button" class="card-target" aria-label="打开${label}详情" data-action="tab" data-id="${id}"></button></article>`
}
function sectionsOverview(b,totals) {
  return `<section class="section"><h2>账期总览</h2><div class="overview">
    ${overviewCard('budget','生活费',`<p class="muted">本期预算 ${yen(b.totalAmount)}</p>${livingProgress(b,totals)}`)}
    ${Object.entries(sections).map(([id,section])=>{
      const {actual,goal}=sectionTotal(b,id,data)
      return overviewCard(id,section.label,progress(section.label,actual,goal?.amount,section.actual))
    }).join('')}</div></section>`
}
function sectionPage(b,id) {
  const section=sections[id]
  const {actual,goal,records}=sectionTotal(b,id,data)
  return `<h1>${section.label}</h1><div class="panel overview-card">
    ${progress(section.label,actual,goal?.amount,section.actual)}
    <div class="actions">${button(goal?'修改'+section.target:'设置'+section.target,'section-goal',id)}</div>
  </div><section class="section"><div class="sectionhead"><h2>本期记录</h2>${button('记一笔','section-record','','primary')}</div>
  <div class="panel">${ordered(records).map(row=>`<div class="row"><div><strong>${esc(row.description)}</strong><small>${fmtDate(row.date)}</small></div>${button(yen(row.amount),'section-record',row.id,'money')}</div>`).join('')||'<p class="empty">暂无记录</p>'}</div></section>`
}
function home(b) {
  const totals=summarize(b,data)
  return `<section class="hero"><h1>可用生活费</h1><div class="big">${yen(totals.available)}</div><p class="muted">本期预算 ${yen(b.totalAmount)}</p>
  <div class="figures"><div><span class="muted">实际支出</span><strong>${yen(totals.actual)}</strong></div><div><span class="muted">待付预留</span><strong>${yen(totals.outstanding)}</strong></div></div></section>
  ${sectionsOverview(b,totals)}
  <section class="section"><div class="sectionhead"><h2>最近交易</h2>${button('全部明细','tab','records')}</div><div class="panel">${transactionRows(ordered(data.transactions.filter(t=>t.budgetId===b.id)).slice(0,5))}</div></section>`
}
function records(b) {
  const rows=ordered(data.transactions.filter(t=>t.budgetId===b.id&&
    (!filters.from||t.date>=filters.from)&&(!filters.to||t.date<=filters.to)&&
    (!filters.category||t.category===filters.category)&&(!filters.paymentMethod||t.paymentMethod===filters.paymentMethod)))
  const totals=summarize(b,{...data,transactions:rows,reservations:[]})
  return `<h1>交易明细</h1><div class="panel filters" id="filters"><label>起始日期<input type="date" name="from" value="${esc(filters.from)}"></label>
    <label>结束日期<input type="date" name="to" value="${esc(filters.to)}"></label>
    <label>类别${select('category',[['','全部类别'],...opts(categories)],filters.category)}</label>
    <label>付款方式${select('paymentMethod',[['','全部方式'],...opts(methods)],filters.paymentMethod)}</label></div>
    <section class="section"><div class="sectionhead"><h2>实际支出</h2><strong class="money">${yen(totals.actual)}</strong></div>
    <div class="panel">${transactionRows(rows)}</div></section>
    <section class="section"><h2>分类支出</h2><div class="panel">${categories.map(c=>`<div class="row"><span>${c}</span><strong class="money">${yen(totals.expenses.filter(t=>t.category===c).reduce((n,t)=>n+t.amount,0))}</strong></div>`).join('')}</div></section>`
}
function reservationsPanel(totals) {
  return totals.reservations.map(r=>{
    const payments=totals.expenses.filter(t=>t.reservationId===r.id)
    return disclosure('reservation:'+r.id,`<strong>${esc(r.name)}</strong><small>${plannedStatus[r.status]} · 待付 ${yen(r.outstanding)}</small>`,`
      <dl class="budget-facts"><div><dt>原始预留</dt><dd>${yen(r.plannedAmount)}</dd></div>
      <div><dt>已实际支付</dt><dd>${yen(r.paid)}</dd></div><div><dt>尚未支付</dt><dd>${yen(r.outstanding)}</dd></div></dl>
      <h3>关联消费记录</h3>${transactionRows(ordered(payments))}
      <div class="actions">${r.status==='cancelled'?'':button('＋ 添加相关消费','payment',r.id,'primary')}${button('管理预留','reservation',r.id)}</div>`)
  }).join('')||'<p class="empty">暂无预留</p>'
}
function weekFacts(w) {
  const known=w.planned!==undefined
  const percent=w.planned>0?(w.actual/w.planned*100).toFixed(1)+'%':w.planned===0&&w.actual===0?'0%':'—'
  return `<dl class="budget-facts"><div><dt>周预算</dt><dd>${known?yen(w.planned):'未设置'}</dd></div>
    <div><dt>实际支出</dt><dd>${yen(w.actual)}</dd></div>
    <div><dt>${known&&w.remaining<0?'超支':'剩余'}</dt><dd class="${known&&w.remaining<0?'error':''}">${known?yen(Math.abs(w.remaining)):'—'}</dd></div>
    <div><dt>使用比例</dt><dd>${percent}</dd></div></dl>`
}
function weeklyPanel(b) {
  const plan=weeklyAllocation(b,data)
  return `<p class="line muted">已分配 ${yen(plan.planned)} / 可分配 ${yen(plan.limit)}（总预算扣除待付预留）</p>
    ${plan.over?`<p class="error" role="status">周预算超出可分配金额 ${yen(plan.over)}，请调低周预算。</p>`:''}
    <div class="weekly-cards">${weeks(b,data).map((w,i)=>`<article class="panel overview-card week-card">
      <h3>第 ${i+1} 周 · ${dateRange(w.start,w.end)}</h3>${weekFacts(w)}
      <p class="muted">${Object.entries(w.categories).filter(([,n])=>n>0).map(([name,n])=>name+' '+yen(n)).join(' · ')||'暂无分类支出'}</p>
      ${button('','week-details',w.start,'card-target','打开第 '+(i+1)+' 周消费记录')}
      <div class="actions">${button(w.planned===undefined?'设置预算':'修改预算','week-budget',w.start)}
      ${button('＋ 记一笔','week-expense',w.start)}</div></article>`).join('')}</div>`
}
function weekPage(b) {
  const w=weeks(b,data).find(row=>row.start===weekStart)
  if(!w) return '<p class="panel empty">当前账期没有这一周。</p>'
  const rows=summarize(b,data).expenses.filter(t=>t.date>=w.start&&t.date<=w.end)
  return `<h1>每周消费 · ${dateRange(w.start,w.end)}</h1><div class="panel">${weekFacts(w)}
    <div class="actions">${button('＋ 记一笔','week-expense',w.start,'primary')}${button(w.planned===undefined?'设置预算':'修改预算','week-budget',w.start)}</div>
    </div><section class="section"><h2>消费记录</h2><div class="panel">${transactionRows(ordered(rows))}</div></section>`
}
function budgetPage(b) {
  const totals=summarize(b,data)
  return `<h1>生活费预算</h1>
  ${disclosure('living-summary','生活费总览',`<div class="row"><div>预算总额 <strong class="money">${yen(b.totalAmount)}</strong></div>${button('修改','edit-budget')}</div>
    <div class="row"><div>实际支出</div><strong class="money">${yen(totals.actual)}</strong></div>
    <div class="row"><div>预留后预算</div><strong class="money">${yen(b.totalAmount-totals.outstanding)}</strong></div>
    <div class="row"><div>扣除支出后的可用金额</div><strong class="money">${yen(totals.available)}</strong></div>
    ${livingProgress(b,totals)}`,true)}
  <div class="actions">${button('＋ 记一笔','living-expense','','primary')}${button('＋ 添加预留','reservation')}</div>
  ${disclosure('reservations','预留项目',reservationsPanel(totals),true)}
  ${disclosure('weekly','每周支出',weeklyPanel(b),true)}
  ${b.startDate===initial?`<section class="section"><h2>初始资金计划</h2><div class="panel line">
  <p>计划取现 ¥44,500，热海活动预留现金 ¥13,000，剩余日用现金 ¥31,500。</p>
  <p>蛋白粉计划线上支付 ¥5,500，银行另留生活费 ¥4,305。</p>
  <p>台湾旅行预算 ¥40,000，单独列示。</p></div></section>`:''}`
}
function settings() {
  return `<h1>设置</h1><section class="panel"><h2>备份与恢复</h2><p class="line muted">账本保存在当前浏览器。清除网站数据可能删除记录，请定期保存完整备份。</p>
  <div class="actions">${button('下载完整备份','backup','','primary')}${button('恢复备份','restore')}</div></section>
  <section class="panel"><h2>交易 CSV</h2><p class="line muted">导出全部账期的交易。导入时会预览有效交易并跳过重复 ID。</p><div class="actions">${button('导出 CSV','export')}${button('导入 CSV','import')}</div></section>
  <section class="panel"><h2>添加到主屏幕</h2><p class="line muted">使用 iPhone Safari 打开网页，点按共享，再选择「添加到主屏幕」。首次在线打开并加载完成后，即可离线记账。</p><p id="offline" class="line muted"></p></section>`
}
function render() {
  outlineObserver.disconnect()
  for(const item of nav.querySelectorAll('[data-action=tab]')) {
    if(item.dataset.id===tab) item.setAttribute('aria-current','page')
    else item.removeAttribute('aria-current')
  }
  if(tab==='settings') {app.innerHTML=settings();updateOffline();return}
  const b=selectedBudget()
  app.innerHTML=(tab==='week'?'':period())+(!b?`<section class="panel empty"><h1>本期尚未建立预算</h1><div class="actions" style="justify-content:center">${button('建立本期预算','edit-budget','','primary')}${getBudget(data,initial)?button('查看初始账期','initial'):''}</div></section>`:
    tab==='home'?home(b):tab==='records'?records(b):tab==='week'?weekPage(b):Object.hasOwn(sections,tab)?sectionPage(b,tab):budgetPage(b))
  for(const svg of app.querySelectorAll('.reserve-outline')) outlineObserver.observe(svg.parentElement)
}

function applyRoute(next,scrollY=0) {
  route=next
  tab=next.tab
  weekStart=next.weekStart
  if(dialog.open) dialog.close()
  render()
  app.focus({preventScroll:true})
  window.scrollTo(0,scrollY)
}
function navigate(destination,start='') {
  if(movingBack||(tab===destination&&weekStart===start)) return
  if(destination==='home'&&route.depth) {
    movingBack=true
    history.go(-route.depth)
    return
  }
  scrollPositions.set(route.key,window.scrollY)
  const next={ledger:true,tab:destination,weekStart:start,depth:route.depth+1,key:crypto.randomUUID()}
  history.pushState(next,'')
  applyRoute(next)
}
window.addEventListener('popstate',event=>{
  movingBack=false
  if(!data||!event.state?.ledger||event.state.key===route.key) return
  scrollPositions.set(route.key,window.scrollY)
  applyRoute(event.state,scrollPositions.get(event.state.key)??0)
})
app.addEventListener('toggle',event=>{
  const item=event.target
  if(item.isConnected&&item.dataset.disclosure) opened.set(item.dataset.disclosure,item.open)
},true)

const appleMobile=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches
if(!appleMobile||standalone) {
  let gesture
  const passive={passive:true}
  window.addEventListener('touchstart',event=>{
    gesture=null
    if(!route.depth||movingBack||dialog.open||event.touches.length!==1) return
    const {clientX:x,clientY:y}=event.touches[0]
    if(x>30) return
    for(let node=event.target;node instanceof Element;node=node.parentElement) {
      if(node.matches('input,select,textarea,[role="slider"],[contenteditable]')) return
      if(node.scrollWidth>node.clientWidth+1&&/auto|scroll/.test(getComputedStyle(node).overflowX)) return
    }
    gesture={x,y,key:route.key}
  },passive)
  window.addEventListener('touchmove',event=>{
    if(!gesture) return
    const touch=event.touches[0]
    if(event.touches.length!==1||Math.abs(touch.clientY-gesture.y)>Math.max(12,(touch.clientX-gesture.x)*0.65)) gesture=null
  },passive)
  window.addEventListener('touchcancel',()=>{gesture=null},passive)
  window.addEventListener('touchend',event=>{
    const start=gesture
    gesture=null
    if(!start||movingBack||start.key!==route.key||!route.depth||dialog.open) return
    const touch=event.changedTouches[0]
    const dx=touch.clientX-start.x
    if(dx>=80&&dx>Math.abs(touch.clientY-start.y)*1.5) {
      movingBack=true
      history.back()
    }
  },passive)
}

function show(title,fields,handler) {
  submitHandler=handler
  dialog.innerHTML=`<h2 id="dialog-title">${title}</h2><form>${fields}<p class="error" role="alert" hidden></p><div class="actions"><button class="primary" type="submit">确认</button>${button('关闭','close')}</div></form>`
  if(!dialog.open) dialog.showModal()
}
function errorInDialog(error) {
  const p=dialog.querySelector('.error')
  if(!p) {message(error.message,true);return}
  p.hidden=false
  p.textContent=error.message
}
async function save(edit,text) {
  data=await access(db,edit)
  channel?.postMessage('changed')
  if(dialog.open) dialog.close()
  render()
  message(text)
}
const upsert=(rows,row)=>[...rows.filter(x=>x.id!==row.id),row]
const stamp=()=>new Date().toISOString()
function sectionGoal(id) {
  const b=selectedBudget()
  const {goal}=sectionTotal(b,id,data)
  show(sections[id].target,`<label>金额（日元）<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${goal?.amount??''}" required></label>
    ${goal?button('移除目标','delete-allocation',goal.id,'danger'):''}`,form=>
    save(current=>{
      const latest=sectionTotal(b,id,current).goal
      const row={id:latest?.id||crypto.randomUUID(),kind:'goal',budgetId:b.id,section:id,amount:Number(form.get('amount'))}
      return {...current,allocations:upsert(current.allocations,row)}
    },'目标已保存'))
}
function sectionRecord(id) {
  const b=selectedBudget()
  const section=tab
  const row=data.allocations.find(x=>x.id===id)
  const now=today()
  const date=row?.date||(now>=b.startDate&&now<=b.endDate?now:b.startDate)
  show(row?'编辑记录':'记录'+sections[section].label,`<label>说明<input name="description" maxlength="140" value="${esc(row?.description)}" required></label>
    <div class="fields"><label>金额（日元）<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${row?.amount??''}" required></label>
    <label>日期<input name="date" type="date" min="${b.startDate}" max="${b.endDate}" value="${date}" required></label></div>
    ${row?button('删除记录','delete-allocation',row.id,'danger'):''}`,form=>
    save(current=>{
      if(id&&!current.allocations.some(x=>x.id===id)) throw Error('此记录已在其他窗口删除')
      const entry={id:id||crypto.randomUUID(),kind:'record',budgetId:b.id,section,amount:Number(form.get('amount')),
        description:String(form.get('description')).trim(),date:form.get('date'),createdAt:row?.createdAt||stamp()}
      return {...current,allocations:upsert(current.allocations,entry)}
    },'记录已保存'))
}
function budgetEditor() {
  const existing=selectedBudget()
  const start=selected
  show(existing?'修改预算':'建立预算',`<label>预算总额（日元）<input name="total" type="number" inputmode="numeric" min="0" step="1" value="${existing?.totalAmount??''}" required></label>`,form=>
    save(current=>{
      const old=getBudget(current,start)
      const row={...(old||budget(start)),totalAmount:Number(form.get('total')),updatedAt:stamp()}
      return {...current,budgets:upsert(current.budgets,row)}
    },'预算已保存'))
}
function reservationEditor(id) {
  const b=selectedBudget()
  const r=data.reservations.find(x=>x.id===id)
  show(r?'管理预留':'添加预留',`<label>项目名称<input name="name" value="${esc(r?.name)}" required maxlength="120"></label>
    <label>计划金额（日元）<input type="number" name="amount" min="1" step="1" inputmode="numeric" value="${r?.plannedAmount??''}" required></label>
    <label>预留状态${select('status',[['planned','有效（付款后自动更新）'],['cancelled','已取消']],r?.status==='cancelled'?'cancelled':'planned')}</label>
    ${r?`<div class="actions">${button('删除预留','delete-reservation',r.id,'danger')}</div>`:''}`,form=>
    save(current=>{
      const old=current.reservations.find(x=>x.id===id)
      if(id&&!old) throw Error('预留已在其他窗口删除')
      const now=stamp()
      const row={...old,id:id||crypto.randomUUID(),budgetId:b.id,name:String(form.get('name')).trim(),plannedAmount:Number(form.get('amount')),status:form.get('status'),createdAt:old?.createdAt||now,updatedAt:now}
      return {...current,reservations:upsert(current.reservations,row)}
    },'预留已保存'))
}
function weekBudgetEditor(start) {
  const b=selectedBudget()
  const w=weeks(b,data).find(row=>row.start===start)
  if(!w) return
  show('周预算 · '+dateRange(w.start,w.end),`<label>预算（日元，留空为未设置）<input name="amount" type="number" min="0" step="1" inputmode="numeric" value="${w.planned??''}"></label>`,form=>{
    const value=form.get('amount')
    return save(current=>{
      const latest=current.budgets.find(row=>row.id===b.id)
      if(!latest) throw Error('此账期已变更，请重试')
      return updateWeeklyBudget(latest,current,w,value===''?undefined:Number(value))
    },'周预算已保存')
  })
}
function transactionEditor(id,linked='',week=null) {
  const old=data.transactions.find(t=>t.id===id)
  const reservation=data.reservations.find(r=>r.id===linked)
  if(linked&&(!reservation||reservation.status==='cancelled')) throw Error('此预留无法添加关联消费')
  const b=linked?data.budgets.find(row=>row.id===reservation.budgetId):budget(selected)
  const from=week?.start??b.startDate
  const to=week?.end??b.endDate
  const defaultDate=today()>=from&&today()<=to?today():from
  const date=old?.date||defaultDate
  const link=old?.reservationId||linked
  show(old?'编辑交易':linked?'记录预留付款':'记一笔',`<div class="fields"><label>交易类型${select('type',[['expense','支出'],['transfer','转账']],old?.type||'expense')}</label>
    <label>金额（日元）<input name="amount" type="number" step="1" min="1" inputmode="numeric" required value="${old?.amount??''}"></label>
    <label>日期<input name="date" type="date" value="${date}" ${linked||week?`min="${from}" max="${to}"`: ''} required></label>
    <label>付款方式${select('paymentMethod',opts(methods),old?.paymentMethod)}</label>
    <label id="category-field">类别${select('category',opts(categories),old?.category)}</label>
    <label id="link-field">关联预留<select name="reservationId"></select></label></div>
    <p id="entry-hint" class="muted"></p>
    <label>说明<input name="description" maxlength="140" value="${esc(old?.description)}"></label>
    <label>备注<textarea name="note" rows="2">${esc(old?.note)}</textarea></label>
    ${old?button('删除交易','delete-transaction',old.id,'danger'):''}`,async form=>{
      const d=String(form.get('date'))
      if(!validDate(d)) throw Error('请选择有效日期')
      const start=cycle(d)
      if((linked||week)&&(d<from||d>to)) throw Error('日期必须在所选范围内')
      const type=linked?'expense':form.get('type')
      const reservationId=type==='expense'?(linked||form.get('reservationId')||''):''
      await save(current=>{
        if(linked&&!current.reservations.some(r=>r.id===linked&&r.status!=='cancelled')) throw Error('此预留无法添加关联消费')
        const target=getBudget(current,start)
        if(!target) throw Error('该日期所在账期尚无预算，请先建立预算')
        const latest=current.transactions.find(t=>t.id===id)
        if(id&&!latest) throw Error('交易已在其他窗口删除')
        const now=stamp()
        const row={...latest,id:id||crypto.randomUUID(),date:d,amount:Number(form.get('amount')),type,category:type==='expense'?form.get('category'):'',
          paymentMethod:form.get('paymentMethod'),description:form.get('description'),note:form.get('note'),budgetId:target.id,reservationId,
          createdAt:latest?.createdAt||now,updatedAt:now}
        return {...current,transactions:upsert(current.transactions,row)}
      },'交易已保存')
      if(tab!=='week') selected=start
      render()
    })
  const f=dialog.querySelector('form')
  const refresh=(chosen)=>{
    const transfer=f.elements.type.value==='transfer'
    const d=f.elements.date.value
    const target=validDate(d)?getBudget(data,cycle(d)):null
    const list=data.reservations.filter(r=>r.budgetId===target?.id&&(r.status!=='cancelled'||r.id===old?.reservationId))
    f.querySelector('#category-field').hidden=transfer
    f.querySelector('#link-field').hidden=transfer
    f.elements.reservationId.innerHTML=option('','无关联',chosen)+list.map(r=>option(r.id,r.name,chosen)).join('')
    f.querySelector('#entry-hint').textContent=!target?'该日期尚未建立预算。':transfer?'转账不计入生活费支出。':''
  }
  refresh(link)
  if(linked) {
    f.elements.type.disabled=true
    f.elements.reservationId.disabled=true
  }
  for(const field of ['type','date']) f.elements[field].onchange=()=>refresh(f.elements.reservationId.value)
}
function download(name,contents,type) {
  const url=URL.createObjectURL(new Blob([contents],{type}))
  const a=document.createElement('a')
  a.href=url
  a.download=name
  a.click()
  setTimeout(()=>URL.revokeObjectURL(url),30000)
}
function importEditor(restore) {
  const mode=restore?'JSON':'CSV'
  show(restore?'选择完整备份':'选择交易 CSV',`<label>${mode} 文件<input type="file" name="file" accept=".${mode.toLowerCase()}" required></label>`,async form=>{
    const file=form.get('file')
    const source=await file.text()
    const latest=await access(db)
    if(restore) {
      const incoming=readBackup(source)
      let merge
      let conflict
      try {merge=mergeBackup(source,latest)} catch(error) {conflict=error.message}
      show('预览备份恢复',`<p>备份包含 ${incoming.budgets.length} 个账期、${incoming.transactions.length} 笔交易、${incoming.reservations.length} 项预留、${incoming.allocations.length} 项总账数据。</p>
      <p>${merge?`合并将新增 ${merge.added} 条记录，保留本地同 ID 的 ${merge.skipped} 条记录。`:'无法合并：'+esc(conflict)}</p>
      <label>恢复方式${select('mode',[['merge','合并并保留现有记录'],['replace','替换整个本地账本']], 'merge')}</label>`,params=>{
        if(params.get('mode')==='replace') {
          if(!confirm('替换整个账本会移除备份中没有的本地记录。确定替换吗？')) return
          return save(()=>readBackup(source),'账本已恢复')
        }
        return save(current=>mergeBackup(source,current).data,'备份已合并')
      })
      return
    }
    const preview=previewCSV(source,latest)
    show('预览交易导入',`<p>可导入 ${preview.accepted.length} 笔，跳过 ${preview.rejected.length} 笔。</p>
    ${preview.accepted.length?`<ul>${preview.accepted.slice(0,6).map(t=>`<li>${t.date} · ${t.type==='transfer'?'转账':'支出'} · ${yen(t.amount)} · ${esc(t.description||t.category||t.paymentMethod)}</li>`).join('')}</ul>`:''}
    ${preview.rejected.length?`<details open><summary>查看跳过原因</summary><ul>${preview.rejected.map(r=>`<li>第 ${r.row} 条记录：${esc(r.reason)}</li>`).join('')}</ul></details>`:''}`,()=>{
      let count=0
      return save(current=>{
        const previewIds=new Set(preview.accepted.map(t=>t.id))
        const accepted=previewCSV(source,current).accepted.filter(t=>previewIds.has(t.id))
        count=accepted.length
        return {...current,transactions:[...current.transactions,...accepted]}
      },'CSV 导入已完成').then(()=>message(`已导入 ${count} 笔交易`))
    })
    if(!preview.accepted.length) dialog.querySelector('[type=submit]').disabled=true
  })
}
dialog.addEventListener('submit',async event=>{
  event.preventDefault()
  if(busy) return
  const f=event.target
  busy=true
  const submit=f.querySelector('[type=submit]')
  submit.disabled=true
  try {await submitHandler(new FormData(f))} catch(error) {errorInDialog(error)}
  finally {busy=false;submit.disabled=false}
})
dialog.addEventListener('cancel',event=>{if(busy) event.preventDefault()})
app.addEventListener('change',event=>{
  if(event.target.closest('#filters')) {
    const {name,value}=event.target
    filters[name]=value
    render()
    app.querySelector(`[name="${name}"]`)?.focus()
  }
})
document.addEventListener('click',async event=>{
  const item=event.target.closest('button[data-action]')
  if(!item||!data||busy) return
  const {action,id}=item.dataset
  message()
  try {
    switch(action) {
      case 'tab': navigate(id);break
      case 'week-details': navigate('week',id);break
      case 'week-budget': weekBudgetEditor(id);break
      case 'week-expense': {
        const w=weeks(selectedBudget(),data).find(row=>row.start===id)
        if(w) transactionEditor('','',w)
        break
      }
      case 'period': selected=shift(selected,Number(id));filters={from:'',to:'',category:'',paymentMethod:''};render();break
      case 'initial': selected=initial;render();break
      case 'section-goal': sectionGoal(id);break
      case 'section-record': sectionRecord(id);break
      case 'delete-allocation':
        if(confirm('确定删除这项总账数据吗？')) {
          busy=true
          await save(current=>({...current,allocations:current.allocations.filter(row=>row.id!==id)}),'已删除')
        }
        break
      case 'edit-budget': budgetEditor();break
      case 'living-expense': transactionEditor('');break
      case 'transaction':
        if(!id&&selectedBudget()&&Object.hasOwn(sections,tab)) sectionRecord('')
        else transactionEditor(id)
        break
      case 'reservation': reservationEditor(id);break
      case 'payment': transactionEditor('',id);break
      case 'close': dialog.close();break
      case 'delete-transaction':
        if(confirm('确定删除这笔交易吗？关联预留会重新计算。')) {
          busy=true
          await save(current=>({...current,transactions:current.transactions.filter(t=>t.id!==id)}),'交易已删除')
        }
        break
      case 'delete-reservation':
        if(confirm('确定删除这项预留吗？已经记录的付款会保留。')) {
          busy=true
          await save(current=>({...current,reservations:current.reservations.filter(r=>r.id!==id),
            transactions:current.transactions.map(t=>t.reservationId===id?{...t,reservationId:'',updatedAt:stamp()}:t)}),'预留已删除')
        }
        break
      case 'backup': download(`生活账本-${today()}.json`,exportBackup(await access(db)),'application/json');break
      case 'export': download(`交易-${today()}.csv`,exportCSV(ordered((await access(db)).transactions)),'text/csv;charset=utf-8');break
      case 'restore': importEditor(true);break
      case 'import': importEditor(false);break
    }
  } catch(error) {
    const text='操作未完成。'+error.message
    if(dialog.open) errorInDialog(Error(text))
    else message(text,true)
  } finally {busy=false}
})
let offlineState='正在准备离线功能…'
function updateOffline() {
  const indicator=document.querySelector('#offline')
  if(indicator) indicator.textContent=offlineState
}
async function prepareOffline() {
  if(!('serviceWorker' in navigator)) {
    offlineState='当前地址无法启用离线，请使用 HTTPS 或本机 localhost。'
    updateOffline()
    return
  }
  try {
    const registration=await navigator.serviceWorker.register('./service-worker.js')
    const worker=registration.installing
    worker?.addEventListener('statechange',()=>{
      if(worker.state==='redundant'&&!registration.active) {
        offlineState='离线资源安装失败，请联网后刷新。'
        updateOffline()
      }
    })
    await navigator.serviceWorker.ready
    offlineState='离线资源已准备好。'
  } catch {
    offlineState='离线资源准备失败，请联网后重试。'
  }
  updateOffline()
}
try {
  db=await openLedger()
  data=await access(db)
  if(!getBudget(data,selected)&&getBudget(data,initial)&&today()<initial) selected=initial
  history.scrollRestoration='manual'
  const previousRoute=history.state
  if(previousRoute?.ledger) {
    route=previousRoute
    tab=route.tab
    weekStart=route.weekStart
  }
  history.replaceState(route,'')
  render()
  channel?.addEventListener('message',async ()=>{
    try {data=await access(db);render()} catch(error) {message(error.message,true)}
  })
  void prepareOffline()
} catch(error) {
  app.textContent='账本暂时无法打开。请确认浏览器允许在此网站保存数据，然后重新加载。'
  message(error.message,true)
}
