export const categories = ['餐饮','交通','娱乐','家居','购物','健身','其他']
export const methods = ['现金','银行卡','Suica','其他']
export const stores = ['budgets','transactions','reservations','weeklyBudgets','allocations']
export const sections = {
  income: {label:'工资收入', actual:'已到账', target:'预计收入'},
  fixed: {label:'固定费用', actual:'已支付', target:'费用预算'},
  investment: {label:'投资', actual:'已投入', target:'投入目标'},
  savings: {label:'储蓄', actual:'已划拨', target:'储蓄目标'}
}
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
    weeklyBudgets:[],
    allocations:[]
  }
}
const sum = rows => rows.reduce((total,row) => {
  const next = total + row.amount
  if (!Number.isSafeInteger(next)) throw Error('合计超出可精确计算的范围')
  return next
},0)
export const acceptsPayment = r => Boolean(r && r.status!=='closed' && r.status!=='cancelled')

export function summarize(b,data) {
  const expenses = data.transactions.filter(t => t.budgetId === b.id && t.type === 'expense')
  const reservations = data.reservations.filter(r => r.budgetId === b.id).map(r => {
    const paid = sum(expenses.filter(t => t.reservationId === r.id))
    const outstanding = acceptsPayment(r) ? Math.max(0,r.plannedAmount-paid) : 0
    const status = !acceptsPayment(r) ? r.status : outstanding === 0 ? 'paid' : paid ? 'partial' : 'planned'
    return {...r,paid,outstanding,status,overrun:Math.max(0,paid-r.plannedAmount)}
  })
  const actual = sum(expenses)
  const outstanding = sum(reservations.map(r => ({amount:r.outstanding})))
  const committed = sum([{amount:actual},{amount:outstanding}])
  return {actual,outstanding,available:b.totalAmount-committed,reservations,expenses}
}
export function closeReservation(data,id,expected,closedAt=new Date().toISOString()) {
  const reservation=data.reservations.find(row=>row.id===id)
  if(!acceptsPayment(reservation)) throw Error('此预留已结束、取消或移除')
  const b=data.budgets.find(row=>row.id===reservation.budgetId)
  const latest=summarize(b,data).reservations.find(row=>row.id===id)
  if(latest.name!==expected.name||latest.plannedAmount!==expected.plannedAmount||latest.paid!==expected.paid||latest.outstanding!==expected.outstanding) {
    throw Error('预留或付款金额已变更，请关闭窗口后重新确认')
  }
  return {...data,reservations:data.reservations.map(row=>row.id===id?
    {...row,status:'closed',closedAt,updatedAt:closedAt}:row)}
}

export function livingBreakdown(total, {expenses, outstanding, available, actual}) {
  const byCategory = new Map()
  for (const {category, amount} of expenses) {
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount)
  }
  const spendWidth = total ? Math.min(actual,total) / total * 100 : 0
  const reserveWidth = total ? Math.min(outstanding,Math.max(0,total-actual)) / total * 100 : 0
  const availableWidth = total ? Math.max(0, available) / total * 100 : 0
  const items = categories.filter(category => byCategory.has(category)).map(category => ({
    kind: 'spent',
    category,
    amount: byCategory.get(category),
    width: byCategory.get(category) / actual * spendWidth
  }))
  items.push(
    {kind:'available', amount:Math.max(0, available), width:availableWidth},
    {kind:'reserved', amount:outstanding, width:reserveWidth}
  )
  return {
    items: items.map(item => ({...item, percent:total ? item.amount / total * 100 : null})),
    actualOverrun: Math.max(0,actual-total),
    actualOverrunPercent: total ? Math.max(0,actual-total) / total * 100 : null,
    availableShortfall: actual<=total ? Math.max(0,-available) : 0
  }
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
export function weeklyAllocation(b,data) {
  const {outstanding}=summarize(b,data)
  const limit=Math.max(0,b.totalAmount-outstanding)
  const planned=sum(data.weeklyBudgets.filter(w=>w.budgetId===b.id).map(w=>({amount:w.plannedAmount})))
  return {limit,planned,over:Math.max(0,planned-limit)}
}
export function updateWeeklyBudget(b,data,week,plannedAmount) {
  if(plannedAmount!==undefined&&!amount(plannedAmount,0)) throw Error('请输入整数日元金额')
  const existing=data.weeklyBudgets.find(w=>w.budgetId===b.id&&w.startDate===week.start)
  const rows=data.weeklyBudgets.filter(w=>w!==existing)
  if(plannedAmount!==undefined) rows.push({id:existing?.id??crypto.randomUUID(),budgetId:b.id,startDate:week.start,endDate:week.end,plannedAmount})
  const updated={...data,weeklyBudgets:rows}
  const before=weeklyAllocation(b,data)
  const after=weeklyAllocation(b,updated)
  if(after.over>0&&after.over>=before.over) throw Error('周预算合计超出可分配金额 '+yen(after.over)+'，请调低金额')
  return updated
}
export function sectionTotal(b,section,data) {
  const entries=data.allocations.filter(row=>row.budgetId===b.id&&row.section===section)
  const goal=entries.find(row=>row.kind==='goal')
  const records=entries.filter(row=>row.kind==='record')
  return {goal,records,actual:sum(records)}
}

export function fixedPlanSummary(b,data) {
  const {records}=sectionTotal(b,'fixed',data)
  const payments=new Map(records.filter(row=>row.planId).map(row=>[row.planId,row]))
  const plans=data.allocations.filter(row=>row.budgetId===b.id&&row.section==='fixed'&&row.kind==='plan')
    .map(row=>({...row,payment:payments.get(row.id)}))
  return {plans,expected:sum(plans),pending:sum(plans.filter(row=>!row.payment))}
}

export function recordFixedPayment(data,planId,payment) {
  const plan=data.allocations.find(row=>row.id===planId&&row.kind==='plan'&&row.section==='fixed')
  if(!plan) throw Error('此预计扣款已移除')
  if(data.allocations.some(row=>row.kind==='record'&&row.planId===planId)) throw Error('此项已确认扣款，请编辑已有记录')
  return {...data,allocations:[...data.allocations,{
    ...payment,kind:'record',budgetId:plan.budgetId,section:'fixed',planId,description:plan.description
  }]}
}

export function undoFixedPayment(data,paymentId) {
  const payment=data.allocations.find(row=>row.id===paymentId&&row.kind==='record'&&row.section==='fixed'&&row.planId)
  if(!payment) throw Error('这笔确认付款已撤回或不存在')
  return {...data,allocations:data.allocations.filter(row=>row!==payment)}
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
       !['planned','partial','partially paid','paid','cancelled','closed'].includes(r.status)) throw Error('无效的预留')
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
  const goals=new Set()
  const paidPlans=new Set()
  const plansById=new Map(data.allocations.filter(row=>row.kind==='plan').map(row=>[row.id,row]))
  for(const row of data.allocations) {
    const b=budgets.get(row.budgetId)
    if(!b||!Object.hasOwn(sections,row.section)||!amount(row.amount)||!['goal','record','plan'].includes(row.kind)||(row.kind==='plan'&&row.section!=='fixed')) throw Error('无效的总账记录')
    if(row.planId) {
      const plan=plansById.get(row.planId)
      if(row.kind!=='record'||row.section!=='fixed'||plan?.budgetId!==b.id||paidPlans.has(row.planId)) {
        throw Error('关联的固定费用计划无效或已确认扣款')
      }
      paidPlans.add(row.planId)
    }
    if(row.kind==='goal') {
      const key=JSON.stringify([row.budgetId,row.section])
      if(goals.has(key)) throw Error('同一区块只能有一个当期目标')
      goals.add(key)
    } else if(!validDate(row.date)||row.date<b.startDate||row.date>b.endDate||typeof row.description!=='string'||!row.description.trim()) {
      throw Error('无效的总账日期或说明')
    }
  }
  for(const b of data.budgets) {
    summarize(b,data)
    for(const section of Object.keys(sections)) sectionTotal(b,section,data)
    fixedPlanSummary(b,data)
  }
  return data
}
