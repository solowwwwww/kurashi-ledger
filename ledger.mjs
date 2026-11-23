export const categories = ['餐饮','交通','娱乐','家居','购物','健身','其他']
export const methods = ['现金','银行卡','Suica','其他']
export const stores = ['budgets','transactions','reservations','weeklyBudgets']
export const initial = '2026-11-25'
export const yen = n => new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(n)
export const today = () => {
  const d = new Date()
  return [d.getFullYear(), d.getMonth()+1, d.getDate()].map(n => String(n).padStart(2,'0')).join('-')
}
export const validDate = d => typeof d === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d
export const amount = (n,min=1) => Number.isSafeInteger(n) && n >= min
const iso = d => d.toISOString().slice(0,10)
export function shift(start,n) {
  const d = new Date(start)
  d.setUTCMonth(d.getUTCMonth()+n)
  return iso(d)
}
export function addDays(date,n) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate()+n)
  return iso(d)
}
export function cycle(date) {
  const start = date.slice(0,7)+'-25'
  return date < start ? shift(start,-1) : start
}
export function budget(date,totalAmount=0) {
  const startDate = cycle(date)
  const now = new Date().toISOString()
  return {id:startDate,name:'生活费',startDate,endDate:addDays(shift(startDate,1),-1),totalAmount,createdAt:now,updatedAt:now}
}
export function seed() {
  return {
    budgets:[budget(initial,54305)],
    transactions:[],
    reservations:[['protein','REYS 乳清蛋白粉',5500],['atami','热海爵士现场',13000]].map(([id,name,plannedAmount]) =>
      ({id,budgetId:initial,name,plannedAmount,status:'planned',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})),
    weeklyBudgets:[]
  }
}
const sum = rows => rows.reduce((total,row) => {
  const next = total + row.amount
  if (!Number.isSafeInteger(next)) throw Error('合计超出可精确计算的范围')
  return next
},0)
export function summarize(b,data) {
  const expenses = data.transactions.filter(t => t.budgetId === b.id && t.type === 'expense')
  const reservations = data.reservations.filter(r => r.budgetId === b.id).map(r => {
    const paid = sum(expenses.filter(t => t.reservationId === r.id))
    const outstanding = r.status === 'cancelled' ? 0 : Math.max(0,r.plannedAmount-paid)
    const status = r.status === 'cancelled' ? 'cancelled' : outstanding === 0 ? 'paid' : paid ? 'partial' : 'planned'
    return {...r,paid,outstanding,status}
  })
  const actual = sum(expenses)
  const outstanding = sum(reservations.map(r => ({amount:r.outstanding})))
  const committed = sum([{amount:actual},{amount:outstanding}])
  return {actual,outstanding,available:b.totalAmount-committed,reservations,expenses}
}
export function weeks(b,data) {
  const {expenses} = summarize(b,data)
  const result = []
  for(let start=b.startDate;start<=b.endDate;start=addDays(start,7)) {
    const end = [addDays(start,6),b.endDate].sort()[0]
    const rows=expenses.filter(t=>t.date>=start && t.date<=end)
    const actual=sum(rows)
    const planned=data.weeklyBudgets.find(w=>w.budgetId===b.id && w.startDate===start)?.plannedAmount
    result.push({start,end,actual,planned,remaining:planned===undefined?undefined:planned-actual,
      categories:Object.fromEntries(categories.map(c=>[c,sum(rows.filter(t=>t.category===c))]))})
  }
  return result
}
export function validate(data) {
  for(const key of stores) {
    if(!Array.isArray(data?.[key])) throw Error('缺少数据表 '+key)
    const ids=new Set()
    for(const row of data[key]) {
      if(typeof row?.id!=='string'||!row.id.trim()||ids.has(row.id)) throw Error('无效或重复 ID '+key)
      ids.add(row.id)
    }
  }
  const starts=new Set()
  const budgets=new Map(data.budgets.map(b=>[b.id,b]))
  const reservations=new Map(data.reservations.map(r=>[r.id,r]))
  for(const b of data.budgets) {
    if(!validDate(b.startDate)||!validDate(b.endDate)||b.startDate!==cycle(b.startDate)||
       b.endDate!==budget(b.startDate).endDate||!amount(b.totalAmount,0)||starts.has(b.startDate)) throw Error('无效或重复账期')
    starts.add(b.startDate)
  }
  for(const r of data.reservations) {
    if(!budgets.has(r.budgetId)||!amount(r.plannedAmount)||typeof r.name!=='string'||!r.name.trim()||
       !['planned','partial','partially paid','paid','cancelled'].includes(r.status)) throw Error('无效的预留')
  }
  const weekKeys=new Set()
  for(const w of data.weeklyBudgets) {
    const b=budgets.get(w.budgetId)
    const key=JSON.stringify([w.budgetId,w.startDate])
    if(!b||weekKeys.has(key)||!amount(w.plannedAmount,0)||
       !weeks(b,{...data,transactions:[]}).some(x=>x.start===w.startDate&&x.end===w.endDate)) throw Error('无效或重复的周预算')
    weekKeys.add(key)
  }
  for(const t of data.transactions) {
    const b=budgets.get(t.budgetId)
    const r=reservations.get(t.reservationId)
    if(!b||!validDate(t.date)||t.date<b.startDate||t.date>b.endDate||!amount(t.amount)||
       !['expense','transfer'].includes(t.type)||!methods.includes(t.paymentMethod)||
       (t.type==='expense'&&!categories.includes(t.category))||
       (t.reservationId&&(!r||r.budgetId!==b.id||t.type!=='expense'))) throw Error('无效交易 '+t.id)
  }
  for(const b of data.budgets) summarize(b,data)
  return data
}
