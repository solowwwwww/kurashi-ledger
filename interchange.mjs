import {stores, validate} from './ledger.mjs'

export const headers=['ID','Date','Amount','Type','Category','Payment method','Description','Note','Budget ID','Reservation ID']
const keys=['id','date','amount','type','category','paymentMethod','description','note','budgetId','reservationId']
export function exportCSV(rows) {
  const quote = value => '"'+String(value??'').replaceAll('"','""')+'"'
  return '\uFEFF'+[headers,...rows.map(t=>keys.map(k=>t[k]))].map(row=>row.map(quote).join(',')).join('\r\n')
}
function parseCSV(text) {
  const rows=[]
  let row=[], cell='', quoted=false, closed=false
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')+'\n'
  for(let i=0;i<text.length;i++) {
    const ch=text[i]
    if(quoted) {
      if(ch!=='"') cell+=ch
      else if(text[i+1]==='"') {cell+='"';i++}
      else {quoted=false;closed=true}
    } else if(ch===','||ch==='\n') {
      row.push(cell)
      cell=''
      closed=false
      if(ch==='\n') {
        if(row.length>1||row[0]!=='') rows.push(row)
        row=[]
      }
    } else if(closed) throw Error('CSV 引号后存在无效字符')
    else if(ch==='"') {
      if(cell) throw Error('CSV 引号位置无效')
      quoted=true
    } else cell+=ch
  }
  if(quoted) throw Error('CSV 存在未闭合的引号')
  return rows
}
export function previewCSV(text,data) {
  const [header,...rows]=parseCSV(text)
  if(JSON.stringify(header)!==JSON.stringify(headers)) throw Error('CSV 表头不匹配，请使用本应用导出的格式')
  const seen=new Set(data.transactions.map(t=>t.id))
  const accepted=[], rejected=[]
  let candidate=data
  for(const [index,row] of rows.entries()) {
    try {
      if(row.length!==keys.length||!/^\d+$/.test(row[2])) throw Error('字段数量或金额无效')
      if(seen.has(row[0])) throw Error('重复交易 ID')
      const t=Object.fromEntries(keys.map((k,i)=>[k,k==='amount'?Number(row[i]):row[i]]))
      const now=new Date().toISOString()
      const next={...candidate,transactions:[...candidate.transactions,{...t,createdAt:now,updatedAt:now}]}
      validate(next)
      accepted.push(next.transactions.at(-1))
      candidate=next
      seen.add(t.id)
    } catch(error) {rejected.push({row:index+2,reason:error.message})}
  }
  return {accepted,rejected}
}
export function exportBackup(data) {
  return JSON.stringify({format:'kurashi-ledger',version:2,data},null,2)
}
export function mergeBackup(text,current) {
  const incoming=readBackup(text)
  let skipped=0
  const data={}
  for(const name of stores) {
    const ids=new Set(current[name].map(row=>row.id))
    data[name]=[...current[name]]
    for(const row of incoming[name]) {
      if(ids.has(row.id)) {skipped++;continue}
      data[name].push(row)
    }
  }
  return {data:validate(data),added:stores.reduce((n,k)=>n+data[k].length-current[k].length,0),skipped}
}
export function readBackup(text) {
  const file=JSON.parse(text)
  if(file?.format!=='kurashi-ledger'||![1,2].includes(file.version)) throw Error('不支持的备份格式或版本')
  return validate(file.version===1?{...file.data,allocations:[]}:file.data)
}
