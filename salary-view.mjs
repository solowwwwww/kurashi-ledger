import {yen,sectionTotal,fixedPlanSummary,summarize,weeklyAllocation} from './ledger.mjs'
import {unit,defaultRules,calculateSalary,salaryDistribution,detailsTotal} from './salary.mjs'
const shellColors={living:'#22A06B',savings:'#4B8AE8',investment:'#9564D4',fixed:'#E8A44B',special:'#8B949E',left:'#ECEDEF'}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const field=(name,label,value,max=Number.MAX_SAFE_INTEGER)=>`<label>${label}<input type="number" inputmode="numeric" name="${name}" min="0" max="${max}" step="1" value="${escape(value)}" required></label>`
const command=(label,action,attrs='')=>`<button type="button" data-salary-command="${action}" ${attrs}>${label}</button>`
const pct=value=>value===null?'—':value.toFixed(2)+'%'
export const salaryPlan=(b,data)=>data.salaryPlans.find(row=>row.id===b.id)
export function salaryBar(income,parts,compact=false) {
  const {items,over}=salaryDistribution(income,parts)
  return `<div class="salary-breakdown"><div class="salary-track" aria-hidden="true">${items.filter(item=>item.width>0).map(item=>
    `<span style="width:${item.width}%;background:${shellColors[item.key]}"></span>`).join('')}</div>
    <ul class="living-legend ${compact?'compact-legend':''}" aria-label="工资预算分配">${items.map(item=>`<li><span class="legend-mark" aria-hidden="true" style="background:${shellColors[item.key]}"></span><span>${item.label}</span>${compact?'':`<strong>${yen(item.amount)}</strong><span class="legend-percent">${pct(item.ratio)}</span>`}</li>`).join('')}</ul>
    ${over?`<p class="error">超额分配 ${yen(over)}</p>`:''}</div>`
}
export function salaryOverview(b,data) {
  const committed=salaryPlan(b,data)
  const fixed=fixedPlanSummary(b,data).afterPayroll
  const income=committed?.income??sectionTotal(b,'income',data).actual
  const parts={living:b.totalAmount,fixed,special:committed?.special??0,
    investment:committed?detailsTotal(committed.investment):sectionTotal(b,'investment',data).goal?.amount??0,
    savings:committed?detailsTotal(committed.savings):sectionTotal(b,'savings',data).goal?.amount??0}
  return {income,parts,needsConfirmation:Boolean(committed&&committed.fixed!==fixed)}
}
export function fixedChange(b,data) {
  const locked=salaryPlan(b,data)
  const fixed=fixedPlanSummary(b,data).afterPayroll
  if(!locked || locked.fixed===fixed) return ''
  const proposed=calculateSalary({income:locked.income,fixed,special:locked.special,
    investment:detailsTotal(locked.investment),rules:locked.rules,
    manualSavings:locked.mode==='manual'?detailsTotal(locked.savings):undefined})
  return `<p class="available-shortfall">固定支出由 ${yen(locked.fixed)} 变为 ${yen(fixed)}，请重新确认工资分配。按原分配方式，生活费将由 ${yen(locked.living)} 变为 ${yen(proposed.living)}，现金储蓄由 ${yen(detailsTotal(locked.savings))} 变为 ${yen(proposed.savings)}。</p>`
}
function detailRow({name='',amount=0}={}) {
  return `<div class="salary-detail"><label>项目名称<input name="itemName" value="${escape(name)}" maxlength="100" required></label>
    <label>金额（万円）<input name="itemUnits" type="number" inputmode="numeric" value="${amount/unit}" min="0" max="${Math.floor(Number.MAX_SAFE_INTEGER/unit)}" step="1" required></label>
    <div class="actions">${command('−','decrement','aria-label="减少一万日元"')}${command('＋','increment','aria-label="增加一万日元"')}${command('删除','remove')}</div></div>`
}
function regularSalaryPlan(b,data) {
  const earlier=data.budgets.filter(row=>row.startDate<b.startDate).sort((a,c)=>c.startDate.localeCompare(a.startDate))
  return salaryPlan(b,data)??earlier.map(row=>salaryPlan(row,data)).find(Boolean)
}

export function salaryDetails(b,data,key) {
  return b.salaryDetails?.[key]??regularSalaryPlan(b,data)?.[key]??[]
}

export function salaryDetailsEditor(b,data,key) {
  const label=key==='investment'?'投资':'储蓄'
  return `<form id="salary-details-form" class="salary-form" data-section="${key}">
    <fieldset data-items="${key}"><legend>${label}预算明细</legend>
      <div class="salary-items">${salaryDetails(b,data,key).map(detailRow).join('')}</div>
      ${command('＋ 添加'+label+'项目','add')}</fieldset>
    <p class="muted">保存后，设置里的工资分配会读取合计。确认分配才会更新生活费预算。</p>
    <div class="actions"><button type="submit" class="primary">保存${label}明细</button></div>
  </form>`
}
export function salaryForm(b,data,draft={}) {
  const locked=salaryPlan(b,data)
  const regular=regularSalaryPlan(b,data)
  const rules=regular?.rules??defaultRules
  const income=draft.income??locked?.income??sectionTotal(b,'income',data).actual
  const mode=draft.mode??regular?.mode
  const fixed=fixedPlanSummary(b,data)
  return `<div class="overview-card">
    ${locked?'<p class="muted">当前方案已锁定。修改后需重新确认。</p>':''}
    ${fixedChange(b,data)}
    <form id="salary-form" class="salary-form">
      <div class="fields">${field('income','实际到账工资（日元）',income)}${field('special','特别支出（日元）',draft.special??locked?.special??0)}</div>
      <label>特别支出名称<input name="specialName" value="${escape(draft.specialName??locked?.specialName)}" placeholder="例如：专项旅行预算" maxlength="100"></label>
      <p class="muted">特别支出请勿重复列入生活费预留。到账前已经扣除的储蓄或投资也请勿重复填写。</p>
      <div class="row"><span>固定支出（根据项目自动汇总）</span><strong>${yen(fixed.afterPayroll)}</strong></div>
      ${fixed.expected>fixed.afterPayroll?`<p class="muted">到账前已扣 ${yen(fixed.expected-fixed.afterPayroll)}，工资分配中已排除。</p>`:''}
      <details class="ledger-disclosure"><summary>分配规则 <small>最低储蓄 ${yen(rules.minimum)} · 目标 ${rules.rate}% · 生活费保障 ${yen(rules.floor)}</small></summary>
        ${field('minimum','最低现金储蓄（日元）',draft.minimum??rules.minimum)}<p class="muted">希望每期至少存下的现金，独立于投资。</p>
        ${field('rate','资产积累目标比例（%）',draft.rate??rules.rate,100)}<p class="muted">现金储蓄与投资合计占到账工资的目标比例。</p>
        ${field('floor','生活费保障线（日元）',draft.floor??rules.floor)}<p class="muted">推荐储蓄时优先保留的最低生活费。</p>
      </details>
      <div class="row"><span>投资合计</span><strong>${yen(detailsTotal(salaryDetails(b,data,'investment')))}</strong>
        <button type="button" data-action="tab" data-id="investment">前往投资</button></div>
      <div class="row"><span>储蓄合计</span><strong>${yen(detailsTotal(salaryDetails(b,data,'savings')))}</strong>
        <button type="button" data-action="tab" data-id="savings">前往储蓄</button></div>
      <label>现金储蓄方式<select name="mode"><option value="recommended" ${mode!=='manual'?'selected':''}>按推荐金额，由我分配明细</option><option value="manual" ${mode==='manual'?'selected':''}>按我的储蓄明细合计</option></select></label>
      <div class="salary-preview"></div>
      <div class="actions"><button type="submit" class="primary">检查并确认分配</button></div>
    </form></div>`
}
export function formDetails(form,key) {
  return [...form.querySelectorAll('[data-items="'+key+'"] .salary-detail')].map(row=>({
    name:row.querySelector('[name=itemName]').value.trim(),
    amount:Number(row.querySelector('[name=itemUnits]').value)*unit
  }))
}
export function readSalaryForm(form,b,data) {
  const fields=new FormData(form)
  const number=name=>Number(fields.get(name))
  const income=number('income')
  const fixed=fixedPlanSummary(b,data).afterPayroll
  const special=number('special')
  const specialName=String(fields.get('specialName')).trim()
  const savings=salaryDetails(b,data,'savings')
  const investment=salaryDetails(b,data,'investment')
  const rules={minimum:number('minimum'),rate:number('rate'),floor:number('floor')}
  const mode=fields.get('mode')
  const savingsTotal=detailsTotal(savings)
  const calc=calculateSalary({income,fixed,special,investment:detailsTotal(investment),rules,
    manualSavings:mode==='manual'?savingsTotal:undefined})
  return {income,fixed,special,specialName,savings,investment,rules,mode,savingsTotal,calc}
}
export function salaryWarnings(b,data,living) {
  const totals=summarize(b,data)
  const weekly=weeklyAllocation({...b,totalAmount:Math.max(0,living)},data)
  const warnings=[]
  if(totals.actual>living) warnings.push('已有生活消费超过新预算')
  if(totals.outstanding>0&&totals.actual+totals.outstanding>living) warnings.push('已有消费与待付预留合计超过新预算')
  if(weekly.over) warnings.push('现有周预算超出可分配金额 '+yen(weekly.over))
  return warnings
}
function resultMarkup({income,fixed,special,mode,savingsTotal,calc},warnings) {
  return `<h3>分配结果</h3><dl class="budget-facts">
      ${[['推荐现金储蓄',yen(calc.recommended)],['现金储蓄明细合计',yen(savingsTotal)],
        [mode==='manual'?'手动调整后的生活费预算':'推荐生活费预算',yen(calc.living)],['投资',yen(calc.investment)],
        ['固定支出',yen(fixed)],['特别支出',yen(special)],['储蓄与投资合计',yen(calc.assets)],['实际资产积累比例',pct(calc.ratio)]]
        .map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
      ${salaryBar(income,{living:calc.living,fixed,special,investment:calc.investment,savings:calc.savings})}
      ${warnings.length?`<ul class="salary-warnings">${warnings.map(text=>`<li>${text}</li>`).join('')}</ul>`:'<p class="muted">分配满足当前保障条件。</p>'}`
}
export function savedSalaryResult(b,data) {
  const plan=salaryPlan(b,data)
  if(!plan) return `<div class="panel overview-card"><div class="progress-status"><span>已到账 <strong>${yen(sectionTotal(b,'income',data).actual)}</strong></span></div>
    <p class="muted">暂无已确认的分配结果。可在设置中计算并确认本期方案。</p></div>`
  const investment=detailsTotal(plan.investment)
  const savingsTotal=detailsTotal(plan.savings)
  const calc=calculateSalary({...plan,investment,manualSavings:savingsTotal})
  return `<div class="panel overview-card"><p class="muted">已到账 <strong>${yen(plan.income)}</strong> · 已确认方案</p>
    ${fixedChange(b,data)}${resultMarkup({...plan,savingsTotal,calc},[...calc.warnings,...salaryWarnings(b,data,plan.living)])}</div>`
}
export function renderSalaryResult(form,b,data) {
  const output=form.querySelector('.salary-preview')
  const summary=form.querySelector('details summary small')
  const min=form.elements.minimum.value
  const rate=form.elements.rate.value
  const floor=form.elements.floor.value
  summary.textContent='最低储蓄 '+yen(Number(min))+' · 目标 '+rate+'% · 生活费保障 '+yen(Number(floor))
  try {
    const {income,fixed,special,mode,savingsTotal,calc}=readSalaryForm(form,b,data)
    const warnings=[...calc.warnings,...salaryWarnings(b,data,calc.living)]
    if(calc.living<0) warnings.unshift('资金缺口 '+yen(-calc.living)+'，调整后才能应用')
    if(mode==='recommended'&&savingsTotal!==calc.savings) warnings.push('请在储蓄页将明细合计调整到推荐值，或选择手动金额')
    output.innerHTML=resultMarkup({income,fixed,special,mode,savingsTotal,calc},warnings)
  } catch(error) {output.textContent=error.message}
}
export function salaryCommand(button) {
  const mode=button.dataset.salaryCommand
  const row=button.closest('.salary-detail')
  if(mode==='add') {
    const list=button.closest('fieldset').querySelector('.salary-items')
    list.insertAdjacentHTML('beforeend',detailRow())
    list.lastElementChild.querySelector('input').focus()
  } else if(mode==='remove') {
    row.remove()
  } else {
    const input=row.querySelector('[name=itemUnits]')
    input.value=Math.max(0,Math.min(Number(input.max),Number(input.value)+(mode==='increment'?1:-1)))
  }
}
