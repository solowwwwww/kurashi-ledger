export const unit=10000
export const defaultRules={minimum:0,rate:0,floor:0}
const validMoney=n=>Number.isSafeInteger(n)&&n>=0
const checkMoney=n=>{if(!validMoney(n)) throw Error('金额必须为非负整数日元')}
function total(rows) {
  const value=rows.reduce((n,row)=>n+row.amount,0)
  checkMoney(value)
  return value
}
export function validateAllocationDetails(rows) {
  if(!Array.isArray(rows)) throw Error('明细缺失')
  for(const row of rows) {
    checkMoney(row.amount)
    if(row.amount%unit!==0||typeof row.name!=='string'||!row.name.trim()) throw Error('请填写项目名称及万元整数金额')
  }
  total(rows)
}
export function validateSalary(plan) {
  if(typeof plan.id!=='string') throw Error('无效的工资分配账期')
  for(const n of [plan.income,plan.fixed,plan.special,plan.living,plan.rules?.minimum,plan.rules?.floor]) checkMoney(n)
  if(!Number.isInteger(plan.rules?.rate)||plan.rules.rate<0||plan.rules.rate>100||!['recommended','manual'].includes(plan.mode)||
     typeof plan.specialName!=='string'||(plan.special>0&&!plan.specialName.trim())) throw Error('分配规则或特别支出名称无效')
  validateAllocationDetails(plan.savings)
  validateAllocationDetails(plan.investment)
  if(plan.income-plan.fixed-plan.special-total(plan.investment)-total(plan.savings)!==plan.living) throw Error('工资分配金额不平衡')
  return plan
}
export function calculateSalary({income,fixed,special,investment,manualSavings,rules}) {
  for(const n of [income,fixed,special,investment,rules.minimum,rules.floor]) checkMoney(n)
  if(!Number.isInteger(rules.rate)||rules.rate<0||rules.rate>100) throw Error('目标比例须为 0–100 的整数')
  if(manualSavings!==undefined) checkMoney(manualSavings)
  const remaining=income-fixed-special-investment
  if(!Number.isSafeInteger(remaining)) throw Error('金额超出安全范围')
  const targetCents=BigInt(income)*BigInt(rules.rate)-BigInt(investment)*100n
  const target=targetCents>0n?Number(targetCents/100n):0
  const rounded=targetCents>0n?Number((targetCents+500000n)/1000000n)*unit:0
  const maximum=Math.max(0,Math.floor((remaining-rules.floor)/unit)*unit)
  const minimumUnits=Math.ceil(rules.minimum/unit)*unit
  const recommended=Math.min(Math.max(rounded,minimumUnits),maximum)
  const savings=manualSavings??recommended
  const living=remaining-savings
  const assets=savings+investment
  if(!Number.isSafeInteger(living)||!Number.isSafeInteger(assets)) throw Error('金额超出安全范围')
  const ratio=income?assets/income*100:null
  const warnings=[]
  if(savings<rules.minimum) warnings.push('现金储蓄低于最低目标')
  if(living<rules.floor) warnings.push('生活费低于保障线')
  if(ratio!==null&&rules.rate-ratio>=5) warnings.push('资产积累比例比目标低至少 5 个百分点')
  return {target,recommended,savings,investment,living,assets,ratio,warnings}
}
const names={living:'生活费',savings:'现金储蓄',investment:'投资',fixed:'固定支出',special:'特别支出',left:'未分配资金'}
export function salaryDistribution(income,{living,savings,investment,fixed,special}) {
  const parts={living:Math.max(0,living),savings,investment,fixed,special}
  const spent=total(Object.values(parts).map(amount=>({amount})))
  const over=Math.max(0,spent-income)
  let room=100
  const items=Object.entries({...parts,left:Math.max(0,income-spent)}).map(([key,amount])=>{
    const ratio=income?amount/income*100:null
    const width=ratio===null?0:Math.min(room,ratio)
    room=Math.max(0,room-width)
    return {key,label:names[key],amount,ratio,width}
  }).filter(row=>row.amount>0||!['special','left'].includes(row.key))
  return {items,over}
}
export function detailsTotal(rows) {return total(rows)}
