import {stores, seed, validate} from './ledger.mjs'

export const dbName = 'kurashi-ledger'
export function openLedger() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(dbName,1)
    request.onupgradeneeded=event=>{
      const db=request.result
      for(const name of stores) if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'})
      if(event.oldVersion===0) {
        for(const [name,rows] of Object.entries(seed())) {
          for(const row of rows) request.transaction.objectStore(name).add(row)
        }
      }
    }
    request.onerror=()=>reject(request.error)
    request.onblocked=()=>reject(Error('请关闭其他记账页面后重试'))
    request.onsuccess=()=>{
      const db=request.result
      db.onversionchange=()=>db.close()
      resolve(db)
    }
  })
}

// Keep the read, validation and writes in one transaction so parallel tabs cannot overwrite a stale snapshot.
export function access(db, edit) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,edit?'readwrite':'readonly')
    const data={}
    let pending=stores.length
    let result, failure
    tx.oncomplete=()=>resolve(result)
    tx.onabort=()=>reject(failure||tx.error||Error('存储操作已中止'))
    for(const name of stores) {
      const request=tx.objectStore(name).getAll()
      request.onsuccess=()=>{
        data[name]=request.result
        if(--pending) return
        try {
          result=edit?validate(edit(data)):data
          if(!edit) return
          for(const key of stores) {
            const store=tx.objectStore(key)
            const ids=new Set(result[key].map(row=>row.id))
            for(const row of data[key]) if(!ids.has(row.id)) store.delete(row.id)
            const before=new Map(data[key].map(row=>[row.id,row]))
            for(const row of result[key]) if(row!==before.get(row.id)) store.put(row)
          }
        } catch(error) {
          failure=error
          tx.abort()
        }
      }
    }
  })
}
