import {yen,sectionTotal,fixedPlanSummary} from './ledger.mjs'
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
  const incomeRows=sectionTotal(b,'income',data)
  const income=incomeRows.records.length?incomeRows.actual:committed?.income??0
  const parts={living:b.totalAmount,fixed:fixedPlanSummary(b,data).afterPayroll,special:committed?.special??0,
    investment:configuredAsset(b,data,'investment'),savings:configuredAsset(b,data,'savings')}
  return {income,parts}
}
function configuredAsset(b,data,section) {
  const details=salaryDetails(b,data,section)
  const {actual}=sectionTotal(b,section,data)
  return details.length||b.salaryDetails?.[section]!==undefined||
    (section==='investment'&&b.investmentBudget!==undefined)?detailsTotal(details):actual
}
function detailRow({name='',amount=0}={}) {
  return `<div class="salary-detail"><label>项目名称<input name="itemName" value="${escape(name)}" maxlength="100" required></label>
    <label>金额（日元）<input name="itemAmount" type="number" inputmode="numeric" value="${amount}" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1" required></label>
    <div class="actions">${command('−','decrement','aria-label="减少一万日元"')}${command('＋','increment','aria-label="增加一万日元"')}${command('删除','remove')}</div></div>`
}
function regularSalaryPlan(b,data) {
  const earlier=data.budgets.filter(row=>row.startDate<b.startDate).sort((a,c)=>c.startDate.localeCompare(a.startDate))
  return salaryPlan(b,data)??earlier.map(row=>salaryPlan(row,data)).find(Boolean)
}

export function salaryDetails(b,data,key) {
  if(key==='investment'&&b.investmentBudget!==undefined) {
    return b.investmentBudget===0?[]:[{name:'投资总预算',amount:b.investmentBudget}]
  }
  const goal=sectionTotal(b,key,data).goal
  return b.salaryDetails?.[key]??(goal?[{name:key==='investment'?'投资目标':'储蓄目标',amount:goal.amount}]:
    salaryPlan(b,data)?.[key]??[])
}

export function salaryDetailsEditor(b,data,key) {
  const label=key==='investment'?'投资':'储蓄'
  return `<form id="salary-details-form" class="salary-form" data-section="${key}">
    <fieldset data-items="${key}"><legend>${label}预算明细</legend>
      <div class="salary-items">${salaryDetails(b,data,key).map(detailRow).join('')}</div>
      ${command('＋ 添加'+label+'项目','add')}</fieldset>
    <p class="muted">保存后更新本期目标。</p>
    <div class="actions"><button type="submit" class="primary">保存${label}明细</button></div>
  </form>`
}
export function salaryForm(b,data,draft={}) {
  const locked=salaryPlan(b,data)
  const regular=regularSalaryPlan(b,data)
  const rules=regular?.rules??defaultRules
  const {income,parts}=salaryOverview(b,data)
  const minimum=draft.minimum??rules.minimum
  const rate=draft.rate??rules.rate
  const floor=draft.floor??rules.floor
  const fixed=fixedPlanSummary(b,data)
  return `<div class="overview-card">
    <form id="salary-form" class="salary-form">
      <div class="fields">${field('income','实际到账工资（日元）',draft.income??income)}${field('special','特别支出（日元）',draft.special??locked?.special??0)}</div>
      <label>特别支出名称<input name="specialName" value="${escape(draft.specialName??locked?.specialName)}" placeholder="例如：专项旅行预算" maxlength="100"></label>
      <p class="muted">特别支出请勿重复列入生活费预留。到账前已经扣除的储蓄或投资也请勿重复填写。</p>
      <div class="row"><span>固定支出（根据项目自动汇总）</span><strong>${yen(fixed.afterPayroll)}</strong></div>
      ${fixed.expected>fixed.afterPayroll?`<p class="muted">到账前已扣 ${yen(fixed.expected-fixed.afterPayroll)}，工资分配中已排除。</p>`:''}
      <details class="ledger-disclosure"><summary>分配规则 <small>最低储蓄 ${yen(Number(minimum))} · 目标 ${escape(rate)}% · 生活费保障 ${yen(Number(floor))}</small></summary>
        ${field('minimum','最低现金储蓄（日元）',minimum)}<p class="muted">希望每期至少存下的现金，独立于投资。</p>
        ${field('rate','资产积累目标比例（%）',rate,100)}<p class="muted">现金储蓄与投资合计占到账工资的目标比例。</p>
        ${field('floor','生活费保障线（日元）',floor)}<p class="muted">推荐储蓄时优先保留的最低生活费。</p>
      </details>
      <div class="row"><span>现有投资金额</span><strong>${yen(parts.investment)}</strong></div>
      <div class="row"><span>实际资产积累比例</span><strong class="salary-asset-ratio">—</strong></div>
      <div class="salary-preview" aria-live="polite"></div>
    </form></div>`
}
export function formDetails(form,key) {
  return [...form.querySelectorAll('[data-items="'+key+'"] .salary-detail')].map(row=>({
    name:row.querySelector('[name=itemName]').value.trim(),
    amount:Number(row.querySelector('[name=itemAmount]').value)
  }))
}
export function readSalaryForm(fields,b,data) {
  const number=name=>Number(fields.get(name))
  const income=number('income')
  const fixed=fixedPlanSummary(b,data).afterPayroll
  const special=number('special')
  const {parts}=salaryOverview(b,data)
  const rules={minimum:number('minimum'),rate:number('rate'),floor:number('floor')}
  const recommendation=calculateSalary({income,fixed,special,investment:0,rules})
  const assetRatio=income?(parts.savings+parts.investment)/income*100:null
  return {recommendation,assetRatio}
}

export function renderSalaryResult(form,b,data) {
  const output=form.querySelector('.salary-preview')
  const ratio=form.querySelector('.salary-asset-ratio')
  const summary=form.querySelector('details summary small')
  const min=form.elements.minimum.value
  const rate=form.elements.rate.value
  const floor=form.elements.floor.value
  summary.textContent='最低储蓄 '+yen(Number(min))+' · 目标 '+rate+'% · 生活费保障 '+yen(Number(floor))
  try {
    const {recommendation,assetRatio}=readSalaryForm(new FormData(form),b,data)
    ratio.textContent=pct(assetRatio)
    output.innerHTML=`<h3>合理分配建议</h3><dl class="budget-facts">
      <div><dt>推荐生活费</dt><dd>${yen(Math.max(0,recommendation.living))}</dd></div>
      <div><dt>推荐储蓄及投资合计</dt><dd>${yen(recommendation.assets)}</dd></div></dl>
      ${recommendation.warnings.length?`<p class="muted">${recommendation.warnings.join(' · ')}</p>`:''}`
  } catch(error) {
    ratio.textContent='—'
    output.textContent=error.message
  }
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
    const input=row.querySelector('[name=itemAmount]')
    input.value=Math.max(0,Math.min(Number(input.max),Number(input.value)+(mode==='increment'?unit:-unit)))
  }
}
