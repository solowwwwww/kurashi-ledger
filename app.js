import {categories,methods,initial,today,cycle,shift,budget,summarize,weeks,yen,validDate} from './ledger.mjs'
import {openLedger,access} from './storage.mjs'
import {exportCSV,previewCSV,exportBackup,mergeBackup,readBackup} from './interchange.mjs'

const app=document.querySelector('#app')
const nav=document.querySelector('#nav')
const dialog=document.querySelector('#editor')
const notice=document.querySelector('#notice')
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;")
const button=(label,action,id='',style='')=>`<button type="button" class="${style}" data-action="${action}" data-id="${esc(id)}">${label}</button>`
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`
const select=(name,values,selected)=>`<select name="${name}">${values.map(([value,label])=>option(value,label,selected)).join('')}</select>`
const opts=values=>values.map(value=>[value,value])
const dateLabel=d=>d.slice(5).replace('-','月')+'日'
const dateRange=(start,end)=>`${dateLabel(start)} – ${dateLabel(end)}`
const plannedStatus={planned:'待付款',partial:'部分付款',paid:'已付清',cancelled:'已取消'}
const fmtDate=d=>d.replaceAll('-','.')
const getBudget=(data,start)=>data.budgets.find(b=>b.startDate===start)
let db,data,tab='home',selected=cycle(today())
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
function home(b) {
  const totals=summarize(b,data)
  const weekly=weeks(b,data)
  const current=weekly.find(w=>today()>=w.start&&today()<=w.end)
  return `<section class="hero"><h1>可用生活费</h1><div class="big">${yen(totals.available)}</div><p class="muted">本期预算 ${yen(b.totalAmount)}</p>
  <div class="figures"><div><span class="muted">实际支出</span><strong>${yen(totals.actual)}</strong></div><div><span class="muted">待付预留</span><strong>${yen(totals.outstanding)}</strong></div></div></section>
  <section class="section"><div class="sectionhead"><h2>每周支出</h2></div><div class="panel">
  ${current?`<div class="row"><div><strong>本周</strong><small>${dateRange(current.start,current.end)}</small></div><strong class="money">${yen(current.actual)}</strong></div>`:''}
  <details ${current?'':'open'}><summary>查看各周统计</summary>${weekly.map(w=>`<div class="row"><div class="week"><strong>${dateRange(w.start,w.end)}</strong>
  <small>${Object.entries(w.categories).filter(([,n])=>n>0).map(([c,n])=>c+' '+yen(n)).join(' · ')||'暂无分类支出'}</small>
  ${w.planned===undefined?'':`<small>计划 ${yen(w.planned)} · 剩余 ${yen(w.remaining)}</small>`}</div><strong class="money">${yen(w.actual)}</strong></div>`).join('')}</details></div></section>
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
function budgetPage(b) {
  const totals=summarize(b,data)
  return `<h1>生活费预算</h1><div class="panel"><div class="row"><div>预算总额 <strong class="money">${yen(b.totalAmount)}</strong></div>${button('修改','edit-budget')}</div><div class="row"><div>预留后预算</div><strong class="money">${yen(b.totalAmount-totals.outstanding)}</strong></div><div class="row"><div>扣除支出后的可用金额</div><strong class="money">${yen(totals.available)}</strong></div></div>
  <section class="section"><div class="sectionhead"><h2>预留项目</h2>${button('添加预留','reservation','','primary')}</div>
  <div class="panel">${totals.reservations.map(r=>`<div class="row"><div><strong>${esc(r.name)}</strong><small>${plannedStatus[r.status]} · 计划 ${yen(r.plannedAmount)} · 已付 ${yen(r.paid)} · 待付 ${yen(r.outstanding)}</small></div>${button('管理','reservation',r.id)}</div>`).join('')||'<p class="empty">暂无预留</p>'}</div></section>
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
  for(const item of nav.querySelectorAll('[data-action=tab]')) {
    if(item.dataset.id===tab) item.setAttribute('aria-current','page')
    else item.removeAttribute('aria-current')
  }
  if(tab==='settings') {app.innerHTML=settings();updateOffline();return}
  const b=selectedBudget()
  app.innerHTML=period()+(!b?`<section class="panel empty"><h1>本期尚未建立预算</h1><div class="actions" style="justify-content:center">${button('建立本期预算','edit-budget','','primary')}${getBudget(data,initial)?button('查看初始账期','initial'):''}</div></section>`:
    tab==='home'?home(b):tab==='records'?records(b):budgetPage(b))
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
    ${r?`<div class="actions">${r.status==='cancelled'?'':button('记一笔关联付款','payment',r.id)}${button('删除预留','delete-reservation',r.id,'danger')}</div>`:''}`,form=>
    save(current=>{
      const old=current.reservations.find(x=>x.id===id)
      if(id&&!old) throw Error('预留已在其他窗口删除')
      const now=stamp()
      const row={...old,id:id||crypto.randomUUID(),budgetId:b.id,name:String(form.get('name')).trim(),plannedAmount:Number(form.get('amount')),status:form.get('status'),createdAt:old?.createdAt||now,updatedAt:now}
      return {...current,reservations:upsert(current.reservations,row)}
    },'预留已保存'))
}
function transactionEditor(id,linked='') {
  const old=data.transactions.find(t=>t.id===id)
  const b=budget(selected)
  const defaultDate=today()>=b.startDate&&today()<=b.endDate?today():b.startDate
  const date=old?.date||defaultDate
  const link=old?.reservationId||linked
  show(old?'编辑交易':linked?'记录预留付款':'记一笔',`<div class="fields"><label>交易类型${select('type',[['expense','支出'],['transfer','转账']],old?.type||'expense')}</label>
    <label>金额（日元）<input name="amount" type="number" step="1" min="1" inputmode="numeric" required value="${old?.amount??''}"></label>
    <label>日期<input name="date" type="date" value="${date}" required></label>
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
      const type=form.get('type')
      const reservationId=type==='expense'?(form.get('reservationId')||''):''
      await save(current=>{
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
      selected=start
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
      show('预览备份恢复',`<p>备份包含 ${incoming.budgets.length} 个账期、${incoming.transactions.length} 笔交易、${incoming.reservations.length} 项预留。</p>
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
      case 'tab': tab=id;render();app.focus();break
      case 'period': selected=shift(selected,Number(id));filters={from:'',to:'',category:'',paymentMethod:''};render();break
      case 'initial': selected=initial;render();break
      case 'edit-budget': budgetEditor();break
      case 'transaction': transactionEditor(id);break
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
  render()
  channel?.addEventListener('message',async ()=>{
    try {data=await access(db);render()} catch(error) {message(error.message,true)}
  })
  void prepareOffline()
} catch(error) {
  app.textContent='账本暂时无法打开。请确认浏览器允许在此网站保存数据，然后重新加载。'
  message(error.message,true)
}
