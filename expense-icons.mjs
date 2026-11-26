const paths={
  餐饮:'<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M19 3c-3 2-4 6-4 10h4m0-10v18"/>',
  交通:'<rect x="5" y="3" width="14" height="15" rx="3"/><path d="m8 18-2 3m10-3 2 3M5 10h14m-10 4h.01m6 0h.01"/>',
  娱乐:'<path d="M9 18V5l11-2v13M9 7l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  家居:'<path d="m3 10 9-7 9 7v10H3zM10 20v-6h4v6"/>',
  购物:'<path d="M5 7h14l2 14H3zM9 9V6a3 3 0 1 1 6 0v3"/>',
  健身:'<path d="M3 8v8m3-10v12m12-12v12m3-10v8M6 12h12"/>',
  医疗:'<path d="M6 18a4.24 4.24 0 0 1 0-6l6-6a4.24 4.24 0 1 1 6 6l-6 6a4.24 4.24 0 0 1-6 0Zm3-9 6 6"/>',
  其他:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
}
export const expenseIcon=category=>`<svg class="expense-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${Object.hasOwn(paths,category)?paths[category]:paths.其他}</svg>`
